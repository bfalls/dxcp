from pathlib import Path
import sys
import importlib.util


class _FakeDdbTable:
    def __init__(self) -> None:
        self.items: dict[tuple[str, str], dict] = {}

    def get_item(self, Key: dict) -> dict:
        item = self.items.get((Key["pk"], Key["sk"]))
        return {"Item": dict(item)} if item else {}

    def put_item(self, Item: dict, ConditionExpression: str | None = None) -> None:
        key = (Item["pk"], Item["sk"])
        if ConditionExpression and key in self.items:
            raise AssertionError("conditional put attempted on existing item")
        self.items[key] = dict(Item)

    def delete_item(self, Key: dict) -> None:
        self.items.pop((Key["pk"], Key["sk"]), None)


def _load_storage_module():
    dxcp_api_dir = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(dxcp_api_dir))
    if "storage" in sys.modules:
        del sys.modules["storage"]
    import importlib

    return importlib.import_module("storage")


def _build_storage(storage_module, fake_table: _FakeDdbTable):
    instance = storage_module.DynamoStorage.__new__(storage_module.DynamoStorage)
    instance.table = fake_table
    return instance


def _load_migration_module(filename: str):
    dxcp_api_dir = Path(__file__).resolve().parents[1]
    migration_path = dxcp_api_dir / "migrations" / filename
    spec = importlib.util.spec_from_file_location(f"test_migration_{migration_path.stem}", migration_path)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_dynamo_list_and_get_environments_use_only_canonical_records():
    storage_module = _load_storage_module()
    table = _FakeDdbTable()
    table.items[("ENVIRONMENT", "sandbox")] = {
        "pk": "ENVIRONMENT",
        "sk": "sandbox",
        "id": "sandbox",
        "name": "sandbox",
        "display_name": "Sandbox",
        "type": "non_prod",
        "is_enabled": True,
        "created_at": "2026-03-30T00:00:00Z",
        "updated_at": "2026-03-30T00:00:00Z",
    }
    table.items[("ADMIN_ENVIRONMENT", "sandbox")] = {
        "pk": "ADMIN_ENVIRONMENT",
        "sk": "sandbox",
        "environment_id": "sandbox",
        "display_name": "Sandbox Legacy",
        "type": "prod",
        "is_enabled": False,
        "created_at": "2026-03-29T00:00:00Z",
        "updated_at": "2026-03-29T00:00:00Z",
    }
    dynamo = _build_storage(storage_module, table)
    dynamo._scan_environments = lambda limit=None: [
        item for (pk, _), item in table.items.items() if pk == "ENVIRONMENT"
    ]

    rows = dynamo.list_environments()
    sandbox = dynamo.get_environment("sandbox")
    staging = dynamo.get_environment("staging")

    assert [row["id"] for row in rows] == ["sandbox"]
    assert sandbox["display_name"] == "Sandbox"
    assert sandbox["type"] == "non_prod"
    assert sandbox["is_enabled"] is True
    assert staging is None


def test_dynamo_admin_environment_writes_use_canonical_environment_records():
    storage_module = _load_storage_module()
    table = _FakeDdbTable()
    dynamo = _build_storage(storage_module, table)
    dynamo.list_delivery_groups = lambda: []
    dynamo.list_services = lambda: []

    created = dynamo.insert_admin_environment(
        {
            "environment_id": "sandbox",
            "display_name": "Sandbox",
            "type": "non_prod",
            "is_enabled": True,
            "created_at": "2026-03-30T00:00:00Z",
            "updated_at": "2026-03-30T00:00:00Z",
        }
    )
    created_item = dict(table.items[("ENVIRONMENT", "sandbox")])
    updated = dynamo.update_admin_environment(
        {
            "environment_id": "sandbox",
            "display_name": "Sandbox Updated",
            "type": "non_prod",
            "is_enabled": False,
            "created_at": "2026-03-30T00:00:00Z",
            "updated_at": "2026-03-30T01:00:00Z",
        }
    )
    assert created["environment_id"] == "sandbox"
    assert created_item["name"] == "sandbox"
    assert created_item["display_name"] == "Sandbox"
    assert ("ADMIN_ENVIRONMENT", "sandbox") not in table.items

    updated_item = table.items.get(("ENVIRONMENT", "sandbox"))
    assert updated["environment_id"] == "sandbox"
    assert updated_item is not None
    assert updated_item["display_name"] == "Sandbox Updated"
    assert updated_item["is_enabled"] is False

    deleted = dynamo.delete_environment("sandbox")
    assert deleted is True
    assert ("ENVIRONMENT", "sandbox") not in table.items


def test_dynamo_migration_normalizes_legacy_composite_environment_identity():
    storage_module = _load_storage_module()
    migration = _load_migration_module("202604041000_normalize_legacy_environment_ids.py")
    table = _FakeDdbTable()
    table.items[("ENVIRONMENT", "default:sandbox")] = {
        "pk": "ENVIRONMENT",
        "sk": "default:sandbox",
        "id": "default:sandbox",
        "name": "sandbox",
        "display_name": "Sandbox",
        "type": "non_prod",
        "delivery_group_id": "default",
        "is_enabled": True,
        "created_at": "2026-04-04T00:00:00Z",
        "updated_at": "2026-04-04T00:00:00Z",
    }
    table.items[("DG_ENV_POLICY", "default#default:sandbox")] = {
        "pk": "DG_ENV_POLICY",
        "sk": "default#default:sandbox",
        "delivery_group_id": "default",
        "environment_id": "default:sandbox",
        "is_enabled": True,
        "order_index": 1,
    }
    table.items[("SERVICE_ENV_ROUTING", "demo-service#default:sandbox")] = {
        "pk": "SERVICE_ENV_ROUTING",
        "sk": "demo-service#default:sandbox",
        "service_id": "demo-service",
        "environment_id": "default:sandbox",
        "recipe_id": "default",
    }
    table.items[("DEPLOYMENT", "dep-1")] = {
        "pk": "DEPLOYMENT",
        "sk": "dep-1",
        "id": "dep-1",
        "service": "demo-service",
        "environment": "default:sandbox",
        "sourceEnvironment": "default:sandbox",
        "version": "1.0.0",
        "state": "SUCCEEDED",
        "changeSummary": "legacy env deploy",
        "createdAt": "2026-04-04T00:00:00Z",
        "updatedAt": "2026-04-04T00:00:00Z",
    }
    dynamo = _build_storage(storage_module, table)
    dynamo._scan_environments = lambda limit=None: [
        item for (pk, _), item in table.items.items() if pk == "ENVIRONMENT"
    ]
    dynamo.list_delivery_group_environment_policy_for_environment = lambda environment_id: [
        {
            "delivery_group_id": item["delivery_group_id"],
            "environment_id": item["environment_id"],
            "is_enabled": item["is_enabled"],
            "order_index": item["order_index"],
        }
        for (pk, _), item in table.items.items()
        if pk == "DG_ENV_POLICY" and item.get("environment_id") == environment_id
    ]
    dynamo.list_delivery_group_environment_policy = lambda delivery_group_id: [
        {
            "delivery_group_id": item["delivery_group_id"],
            "environment_id": item["environment_id"],
            "is_enabled": item["is_enabled"],
            "order_index": item["order_index"],
        }
        for (pk, _), item in table.items.items()
        if pk == "DG_ENV_POLICY" and item.get("delivery_group_id") == delivery_group_id
    ]
    dynamo.list_service_environment_routing_for_environment = lambda environment_id: [
        {
            "service_id": item["service_id"],
            "environment_id": item["environment_id"],
            "recipe_id": item["recipe_id"],
        }
        for (pk, _), item in table.items.items()
        if pk == "SERVICE_ENV_ROUTING" and item.get("environment_id") == environment_id
    ]
    dynamo.get_service_environment_routing = lambda service_id, environment_id: next(
        (
            {
                "service_id": item["service_id"],
                "environment_id": item["environment_id"],
                "recipe_id": item["recipe_id"],
            }
            for (pk, _), item in table.items.items()
            if pk == "SERVICE_ENV_ROUTING"
            and item.get("service_id") == service_id
            and item.get("environment_id") == environment_id
        ),
        None,
    )
    dynamo.table.scan = lambda **kwargs: {
        "Items": [
            item
            for (pk, _), item in table.items.items()
            if pk == "DEPLOYMENT"
            and (
                item.get("environment") == "default:sandbox"
                or item.get("sourceEnvironment") == "default:sandbox"
            )
        ]
    }

    migration.run(dynamo)

    assert ("ENVIRONMENT", "default:sandbox") not in table.items
    assert table.items[("ENVIRONMENT", "sandbox")]["id"] == "sandbox"
    assert table.items[("ENVIRONMENT", "sandbox")]["name"] == "sandbox"
    assert ("DG_ENV_POLICY", "default#default:sandbox") not in table.items
    assert table.items[("DG_ENV_POLICY", "default#sandbox")]["environment_id"] == "sandbox"
    assert ("SERVICE_ENV_ROUTING", "demo-service#default:sandbox") not in table.items
    assert table.items[("SERVICE_ENV_ROUTING", "demo-service#sandbox")]["environment_id"] == "sandbox"
    assert table.items[("DEPLOYMENT", "dep-1")]["environment"] == "sandbox"
    assert table.items[("DEPLOYMENT", "dep-1")]["sourceEnvironment"] == "sandbox"
