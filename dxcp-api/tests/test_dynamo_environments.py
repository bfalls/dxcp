from pathlib import Path
import sys


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
