import json
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
import pytest
from auth_utils import auth_header, configure_auth_env, mock_jwks

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


async def test_admin_endpoints_require_platform_admin(tmp_path: Path, monkeypatch):
    async with _client(tmp_path, monkeypatch) as client:
        create_resp = await client.post(
            "/v1/admin/environments",
            headers=auth_header(["dxcp-observers"]),
            json={
                "environment_id": "staging",
                "display_name": "Staging",
                "type": "non_prod",
                "is_enabled": True,
            },
        )
        read_resp = await client.get(
            "/v1/admin/environments",
            headers=auth_header(["dxcp-observers"]),
        )

    assert create_resp.status_code == 403
    assert read_resp.status_code == 403
    assert create_resp.json()["code"] == "ROLE_FORBIDDEN"
    assert read_resp.json()["code"] == "ROLE_FORBIDDEN"


async def test_create_environment_is_deterministic_and_validated(tmp_path: Path, monkeypatch):
    async with _client(tmp_path, monkeypatch) as client:
        bad = await client.post(
            "/v1/admin/environments",
            headers=auth_header(["dxcp-platform-admins"]),
            json={
                "environment_id": "Staging 01",
                "display_name": "Staging 01",
                "type": "non_prod",
                "is_enabled": True,
            },
        )
        created = await client.post(
            "/v1/admin/environments",
            headers=auth_header(["dxcp-platform-admins"]),
            json={
                "environment_id": "staging",
                "display_name": "Staging",
                "type": "non_prod",
                "is_enabled": True,
            },
        )
        duplicate = await client.post(
            "/v1/admin/environments",
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
    assert body["environment_id"] == "staging"
    assert body["type"] == "non_prod"
    assert body["is_enabled"] is True
    assert duplicate.status_code == 409
    assert duplicate.json()["code"] == "ENVIRONMENT_EXISTS"


async def test_binding_and_routing_uniqueness_constraints(tmp_path: Path, monkeypatch):
    async with _client(tmp_path, monkeypatch) as client:
        create_env = await client.post(
            "/v1/admin/environments",
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
