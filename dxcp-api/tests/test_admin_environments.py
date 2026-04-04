import json
import os
import sqlite3
import sys
from contextlib import asynccontextmanager
import importlib.util
from pathlib import Path

import httpx
import pytest
from auth_utils import auth_header, build_token, configure_auth_env, mock_jwks

from test_helpers import seed_defaults

pytestmark = pytest.mark.anyio


def _write_service_registry(path: Path) -> None:
    data = [
        {
            "service_name": "demo-service",
            "allowed_environments": ["sandbox"],
            "allowed_recipes": ["default"],
            "allowed_artifact_sources": ["s3://dxcp-test-bucket/"],
        }
    ]
    path.write_text(json.dumps(data), encoding="utf-8")


def _load_main(tmp_path: Path):
    dxcp_api_dir = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(dxcp_api_dir))
    os.environ["DXCP_DB_PATH"] = str(tmp_path / "dxcp-test.db")
    os.environ["DXCP_SERVICE_REGISTRY_PATH"] = str(tmp_path / "services.json")
    configure_auth_env()
    _write_service_registry(Path(os.environ["DXCP_SERVICE_REGISTRY_PATH"]))

    for module in ["main", "config", "storage", "policy", "idempotency", "rate_limit"]:
        if module in sys.modules:
            del sys.modules[module]

    import importlib

    return importlib.import_module("main")


def _run_migration(module_filename: str, storage) -> None:
    dxcp_api_dir = Path(__file__).resolve().parents[1]
    migration_path = dxcp_api_dir / "migrations" / module_filename
    spec = importlib.util.spec_from_file_location(f"test_migration_{migration_path.stem}", migration_path)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.run(storage)


@asynccontextmanager
async def _client(tmp_path: Path, monkeypatch):
    main = _load_main(tmp_path)
    mock_jwks(monkeypatch)
    main.idempotency = main.IdempotencyStore()
    main.rate_limiter = main.RateLimiter()
    main.storage = main.build_storage()
    seed_defaults(main.storage)
    main.guardrails = main.Guardrails(main.storage)

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=main.app),
        base_url="http://testserver",
    ) as client:
        yield client


@asynccontextmanager
async def _client_and_state(tmp_path: Path, monkeypatch):
    main = _load_main(tmp_path)
    mock_jwks(monkeypatch)
    main.idempotency = main.IdempotencyStore()
    main.rate_limiter = main.RateLimiter()
    main.storage = main.build_storage()
    seed_defaults(main.storage)
    main.guardrails = main.Guardrails(main.storage)

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=main.app),
        base_url="http://testserver",
    ) as client:
        yield client, main


async def test_canonical_environment_writes_require_platform_admin_but_reads_use_read_permissions(tmp_path: Path, monkeypatch):
    async with _client(tmp_path, monkeypatch) as client:
        create_resp = await client.post(
            "/v1/environments",
            headers=auth_header(["dxcp-observers"]),
            json={
                "environment_id": "staging",
                "display_name": "Staging",
                "type": "non_prod",
                "is_enabled": True,
            },
        )
        read_resp = await client.get(
            "/v1/environments",
            headers=auth_header(["dxcp-observers"]),
        )

    assert create_resp.status_code == 403
    assert read_resp.status_code == 200
    assert create_resp.json()["code"] == "ROLE_FORBIDDEN"
    assert isinstance(read_resp.json(), list)


async def test_create_environment_is_deterministic_and_validated(tmp_path: Path, monkeypatch):
    async with _client(tmp_path, monkeypatch) as client:
        bad = await client.post(
            "/v1/environments",
            headers=auth_header(["dxcp-platform-admins"]),
            json={
                "environment_id": "Staging 01",
                "display_name": "Staging 01",
                "type": "non_prod",
                "is_enabled": True,
            },
        )
        created = await client.post(
            "/v1/environments",
            headers=auth_header(["dxcp-platform-admins"]),
            json={
                "environment_id": "staging",
                "display_name": "Staging",
                "type": "non_prod",
                "is_enabled": True,
            },
        )
        duplicate = await client.post(
            "/v1/environments",
            headers=auth_header(["dxcp-platform-admins"]),
            json={
                "environment_id": "staging",
                "display_name": "Staging",
                "type": "non_prod",
                "is_enabled": True,
            },
        )

    assert bad.status_code == 400
    assert bad.json()["code"] == "INVALID_ENVIRONMENT_ID"
    assert created.status_code == 201
    body = created.json()
    assert body["id"] == "staging"
    assert body["name"] == "staging"
    assert body["type"] == "non_prod"
    assert body["is_enabled"] is True
    assert duplicate.status_code == 409
    assert duplicate.json()["code"] == "ENVIRONMENT_EXISTS"


async def test_binding_and_routing_uniqueness_constraints(tmp_path: Path, monkeypatch):
    async with _client(tmp_path, monkeypatch) as client:
        create_env = await client.post(
            "/v1/environments",
            headers=auth_header(["dxcp-platform-admins"]),
            json={
                "environment_id": "prod",
                "display_name": "Production",
                "type": "prod",
                "is_enabled": True,
            },
        )
        assert create_env.status_code == 201

        first_bind = await client.put(
            "/v1/admin/delivery-groups/default/environments/prod",
            headers=auth_header(["dxcp-platform-admins"]),
            json={"is_enabled": True, "order_index": 1},
        )
        second_bind = await client.put(
            "/v1/admin/delivery-groups/default/environments/prod",
            headers=auth_header(["dxcp-platform-admins"]),
            json={"is_enabled": False, "order_index": 2},
        )
        bindings = await client.get(
            "/v1/admin/delivery-groups/default/environments",
            headers=auth_header(["dxcp-platform-admins"]),
        )

        first_route = await client.put(
            "/v1/admin/services/demo-service/environments/prod",
            headers=auth_header(["dxcp-platform-admins"]),
            json={"recipe_id": "default"},
        )
        second_route = await client.put(
            "/v1/admin/services/demo-service/environments/prod",
            headers=auth_header(["dxcp-platform-admins"]),
            json={"recipe_id": "default"},
        )
        routes = await client.get(
            "/v1/admin/services/demo-service/environments",
            headers=auth_header(["dxcp-platform-admins"]),
        )

    assert first_bind.status_code == 200
    assert second_bind.status_code == 200
    assert first_route.status_code == 200
    assert second_route.status_code == 200

    binding_rows = [row for row in bindings.json() if row["environment_id"] == "prod"]
    assert len(binding_rows) == 1
    assert binding_rows[0]["is_enabled"] is False
    assert binding_rows[0]["order_index"] == 2

    routed_rows = [row for row in routes.json() if row["environment_id"] == "prod" and row.get("recipe_id")]
    assert len(routed_rows) == 1
    assert routed_rows[0]["recipe_id"] == "default"


async def test_canonical_environment_crud_and_admin_alias_share_single_store(tmp_path: Path, monkeypatch):
    async with _client(tmp_path, monkeypatch) as client:
        created = await client.post(
            "/v1/environments",
            headers=auth_header(["dxcp-platform-admins"]),
            json={
                "environment_id": "staging",
                "display_name": "Staging",
                "type": "non_prod",
                "is_enabled": True,
            },
        )
        assert created.status_code == 201
        fetched = await client.get(
            "/v1/environments/staging",
            headers=auth_header(["dxcp-platform-admins"]),
        )
        updated = await client.patch(
            "/v1/environments/staging",
            headers=auth_header(["dxcp-platform-admins"]),
            json={"display_name": "Stage", "is_enabled": False},
        )
        canonical_list = await client.get(
            "/v1/environments",
            headers=auth_header(["dxcp-platform-admins"]),
        )
        final_patch = await client.patch(
            "/v1/environments/staging",
            headers=auth_header(["dxcp-platform-admins"]),
            json={"display_name": "Staging Final", "is_enabled": True},
        )

    assert fetched.status_code == 200
    assert fetched.json()["id"] == "staging"
    assert fetched.json()["name"] == "staging"
    assert canonical_list.status_code == 200
    assert any(row["id"] == "staging" for row in canonical_list.json())
    assert updated.status_code == 200
    assert updated.json()["display_name"] == "Stage"
    assert updated.json()["is_enabled"] is False
    assert final_patch.status_code == 200
    assert final_patch.json()["display_name"] == "Staging Final"
    assert final_patch.json()["is_enabled"] is True

    db_path = tmp_path / "dxcp-test.db"
    import sqlite3

    conn = sqlite3.connect(db_path)
    cur = conn.cursor()
    cur.execute("SELECT environment_id, display_name, is_enabled FROM admin_environments WHERE environment_id = ?", ("staging",))
    admin_row = cur.fetchone()
    cur.execute("SELECT id, name, display_name, is_enabled FROM environments WHERE id = ?", ("staging",))
    canonical_row = cur.fetchone()
    conn.close()

    assert admin_row is None
    assert canonical_row == ("staging", "staging", "Staging Final", 1)


async def test_canonical_environment_visibility_delete_and_permissions(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, main):
        group = main.storage.get_delivery_group("default")
        assert group is not None
        group["owner"] = "user@example.com"
        main.storage.update_delivery_group(group)
        observer_headers = {
            "Authorization": f"Bearer {build_token(['dxcp-observers'], email='user@example.com')}"
        }
        create_forbidden = await client.post(
            "/v1/environments",
            headers=observer_headers,
            json={
                "environment_id": "staging",
                "display_name": "Staging",
                "type": "non_prod",
                "is_enabled": True,
            },
        )
        list_observer = await client.get(
            "/v1/environments",
            headers=observer_headers,
        )
        created = await client.post(
            "/v1/environments",
            headers=auth_header(["dxcp-platform-admins"]),
            json={
                "environment_id": "staging",
                "display_name": "Staging",
                "type": "non_prod",
                "is_enabled": True,
            },
        )
        bind = await client.put(
            "/v1/admin/delivery-groups/default/environments/staging",
            headers=auth_header(["dxcp-platform-admins"]),
            json={"is_enabled": True, "order_index": 2},
        )
        visible_after_bind = await client.get(
            "/v1/environments",
            headers=auth_header(["dxcp-platform-admins"]),
        )
        delete_blocked = await client.delete(
            "/v1/environments/staging",
            headers=auth_header(["dxcp-platform-admins"]),
        )
        retired = await client.patch(
            "/v1/environments/staging",
            headers=auth_header(["dxcp-platform-admins"]),
            json={"lifecycle_state": "retired"},
        )
        visible_after_delete = await client.get(
            "/v1/environments",
            headers=auth_header(["dxcp-platform-admins"]),
        )
        visible_after_retire_for_operator = await client.get(
            "/v1/environments",
            headers=observer_headers,
        )

    assert create_forbidden.status_code == 403
    assert create_forbidden.json()["code"] == "ROLE_FORBIDDEN"
    assert list_observer.status_code == 200
    assert all(row["name"] != "staging" for row in list_observer.json())
    assert created.status_code == 201
    assert bind.status_code == 200
    assert any(row["name"] == "staging" for row in visible_after_bind.json())
    assert delete_blocked.status_code == 409
    assert delete_blocked.json()["code"] == "ENVIRONMENT_DELETE_BLOCKED_REFERENCED"
    assert retired.status_code == 200
    assert retired.json()["lifecycle_state"] == "retired"
    assert retired.json()["is_enabled"] is False
    assert any(row["name"] == "staging" and row["lifecycle_state"] == "retired" for row in visible_after_delete.json())
    assert all(row["name"] != "staging" for row in visible_after_retire_for_operator.json())


async def test_unreferenced_environment_can_be_hard_deleted(tmp_path: Path, monkeypatch):
    async with _client(tmp_path, monkeypatch) as client:
        created = await client.post(
            "/v1/environments",
            headers=auth_header(["dxcp-platform-admins"]),
            json={
                "environment_id": "scratch",
                "display_name": "Scratch",
                "type": "non_prod",
                "lifecycle_state": "active",
            },
        )
        assert created.status_code == 201
        delete_resp = await client.delete(
            "/v1/environments/scratch",
            headers=auth_header(["dxcp-platform-admins"]),
        )
        canonical_after_delete = await client.get(
            "/v1/environments",
            headers=auth_header(["dxcp-platform-admins"]),
        )
        operational_after_delete = await client.get(
            "/v1/environments",
            headers=auth_header(["dxcp-observers"]),
        )

    assert delete_resp.status_code == 204
    assert canonical_after_delete.status_code == 200
    assert all(row["id"] != "scratch" for row in canonical_after_delete.json())
    assert operational_after_delete.status_code == 200
    assert all(row["id"] != "scratch" for row in operational_after_delete.json())


async def test_referenced_default_environments_are_not_hard_deleted(tmp_path: Path, monkeypatch):
    async with _client(tmp_path, monkeypatch) as client:
        initial = await client.get(
            "/v1/environments",
            headers=auth_header(["dxcp-platform-admins"]),
        )
        results = {}
        for row in initial.json():
            delete_resp = await client.delete(
                f"/v1/environments/{row['id']}",
                headers=auth_header(["dxcp-platform-admins"]),
            )
            results[row["id"]] = delete_resp

    assert "sandbox" in results
    assert results["sandbox"].status_code == 409
    assert results["sandbox"].json()["code"] == "ENVIRONMENT_DELETE_BLOCKED_REFERENCED"


async def test_migration_normalizes_legacy_composite_environment_identity(tmp_path: Path, monkeypatch):
    main = _load_main(tmp_path)
    main.storage = main.build_storage()
    seed_defaults(main.storage)

    db_path = tmp_path / "dxcp-test.db"
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()
    cur.execute("DELETE FROM service_environment_routing")
    cur.execute("DELETE FROM delivery_group_environment_policy")
    cur.execute("DELETE FROM environments")
    now = main.utc_now()
    cur.execute(
        """
        INSERT INTO environments (
            id, name, display_name, type, lifecycle_state, promotion_order, delivery_group_id, is_enabled, guardrails,
            created_at, created_by, updated_at, updated_by, last_change_reason
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            "default:sandbox",
            "sandbox",
            "Sandbox",
            "non_prod",
            "active",
            1,
            "default",
            1,
            None,
            now,
            "system",
            now,
            "system",
            None,
        ),
    )
    cur.execute(
        """
        INSERT INTO delivery_group_environment_policy (
            delivery_group_id, environment_id, is_enabled, order_index
        ) VALUES (?, ?, ?, ?)
        """,
        ("default", "default:sandbox", 1, 1),
    )
    cur.execute(
        """
        INSERT INTO service_environment_routing (
            service_id, environment_id, recipe_id
        ) VALUES (?, ?, ?)
        """,
        ("demo-service", "default:sandbox", "default"),
    )
    cur.execute(
        """
        INSERT INTO deployments (
            id, service, environment, version, recipe_id, recipe_revision, effective_behavior_summary, state,
            deployment_kind, outcome, intent_correlation_id, superseded_by, change_summary, created_at, updated_at,
            engine_type, spinnaker_execution_id, spinnaker_execution_url, spinnaker_application, spinnaker_pipeline,
            rollback_of, source_environment, delivery_group_id, actor_identity_json, policy_snapshot_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            "dep-1",
            "demo-service",
            "default:sandbox",
            "1.0.0",
            "default",
            None,
            None,
            "SUCCEEDED",
            "ROLL_FORWARD",
            "SUCCEEDED",
            None,
            None,
            "legacy env deploy",
            now,
            now,
            "SPINNAKER",
            "exec-1",
            "http://spinnaker.local/pipelines/exec-1",
            None,
            None,
            None,
            "default:sandbox",
            "default",
            None,
            None,
        ),
    )
    conn.commit()
    conn.close()

    main.storage = main.build_storage()
    _run_migration("202604041000_normalize_legacy_environment_ids.py", main.storage)

    assert main.storage.get_environment("default:sandbox") is None
    normalized = main.storage.get_environment("sandbox")
    assert normalized is not None
    assert normalized["id"] == "sandbox"
    assert normalized["name"] == "sandbox"
    assert normalized["display_name"] == "Sandbox"
    assert normalized["delivery_group_id"] == ""
    assert main.storage.list_delivery_group_environment_policy_for_environment("sandbox") == [
        {
            "delivery_group_id": "default",
            "environment_id": "sandbox",
            "is_enabled": True,
            "order_index": 1,
        }
    ]
    assert main.storage.list_service_environment_routing_for_environment("sandbox") == [
        {
            "service_id": "demo-service",
            "environment_id": "sandbox",
            "recipe_id": "default",
        }
    ]
    deployment = main.storage.get_deployment("dep-1")
    assert deployment is not None
    assert deployment["environment"] == "sandbox"
    assert deployment["sourceEnvironment"] == "sandbox"


async def test_admin_environment_and_routing_reads_surface_canonical_environment_ids_after_migration(tmp_path: Path, monkeypatch):
    main = _load_main(tmp_path)
    mock_jwks(monkeypatch)
    main.idempotency = main.IdempotencyStore()
    main.rate_limiter = main.RateLimiter()
    main.storage = main.build_storage()
    seed_defaults(main.storage)

    db_path = tmp_path / "dxcp-test.db"
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()
    cur.execute("DELETE FROM service_environment_routing")
    cur.execute("DELETE FROM delivery_group_environment_policy")
    cur.execute("DELETE FROM environments")
    now = main.utc_now()
    cur.execute(
        """
        INSERT INTO environments (
            id, name, display_name, type, lifecycle_state, promotion_order, delivery_group_id, is_enabled, guardrails,
            created_at, created_by, updated_at, updated_by, last_change_reason
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            "default:sandbox",
            "sandbox",
            "Sandbox",
            "non_prod",
            "active",
            1,
            "default",
            1,
            None,
            now,
            "system",
            now,
            "system",
            None,
        ),
    )
    cur.execute(
        """
        INSERT INTO service_environment_routing (
            service_id, environment_id, recipe_id
        ) VALUES (?, ?, ?)
        """,
        ("demo-service", "default:sandbox", "default"),
    )
    conn.commit()
    conn.close()

    main.storage = main.build_storage()
    _run_migration("202604041000_normalize_legacy_environment_ids.py", main.storage)
    main.guardrails = main.Guardrails(main.storage)

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=main.app),
        base_url="http://testserver",
    ) as client:
        environments = await client.get(
            "/v1/environments",
            headers=auth_header(["dxcp-platform-admins"]),
        )
        routes = await client.get(
            "/v1/admin/services/demo-service/environments",
            headers=auth_header(["dxcp-platform-admins"]),
        )

    assert environments.status_code == 200
    environment_ids = [row["id"] for row in environments.json()]
    assert "sandbox" in environment_ids
    assert "default:sandbox" not in environment_ids

    assert routes.status_code == 200
    route_ids = [row["environment_id"] for row in routes.json()]
    assert "sandbox" in route_ids
    assert all(":" not in env_id for env_id in route_ids)
