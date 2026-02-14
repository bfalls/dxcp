import json
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
import pytest
from auth_utils import build_token, configure_auth_env, mock_jwks

from test_helpers import seed_defaults

pytestmark = pytest.mark.anyio


def _write_service_registry(path: Path) -> None:
    data = [
        {
            "service_name": "payments",
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
    main.rate_limiter = main.RateLimiter()
    main.storage = main.build_storage()
    seed_defaults(main.storage)
    main.guardrails = main.Guardrails(main.storage)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=main.app),
        base_url="http://testserver",
    ) as client:
        yield client, main


async def test_environments_endpoint_includes_environment_contract_fields(tmp_path: Path, monkeypatch):
    async with _client(tmp_path, monkeypatch) as (client, main):
        group = main.storage.get_delivery_group("default")
        assert group is not None
        group["owner"] = "user-1"
        group["allowed_environments"] = ["sandbox", "staging"]
        main.storage.update_delivery_group(group)
        staging = main.storage.get_environment_for_group("staging", "default")
        assert staging is not None
        staging["display_name"] = "Staging"
        staging["promotion_order"] = 2
        main.storage.update_environment(staging)

        response = await client.get(
            "/v1/environments",
            headers={"Authorization": f"Bearer {build_token(['dxcp-observers'], subject='user-1')}"},
        )
    assert response.status_code == 200
    body = response.json()
    staging_env = next((env for env in body if env.get("name") == "staging"), None)
    assert staging_env is not None
    assert staging_env["display_name"] == "Staging"
    assert staging_env["promotion_order"] == 2
    assert staging_env["is_enabled"] is True
    assert staging_env["delivery_group_id"] == "default"


async def test_environments_endpoint_is_scoped_to_actor_delivery_groups(tmp_path: Path, monkeypatch):
    async with _client(tmp_path, monkeypatch) as (client, main):
        default_group = main.storage.get_delivery_group("default")
        assert default_group is not None
        default_group["services"] = []
        default_group["owner"] = "user-2"
        main.storage.update_delivery_group(default_group)
        main.storage.insert_delivery_group(
            {
                "id": "group-user-1",
                "name": "Group User 1",
                "description": None,
                "owner": "user-1",
                "services": [],
                "allowed_environments": ["sandbox"],
                "allowed_recipes": ["default"],
                "guardrails": None,
                "created_at": main.utc_now(),
                "created_by": "system",
                "updated_at": main.utc_now(),
                "updated_by": "system",
            }
        )

        response = await client.get(
            "/v1/environments",
            headers={"Authorization": f"Bearer {build_token(['dxcp-observers'], subject='user-1')}"},
        )
    assert response.status_code == 200
    body = response.json()
    assert body
    assert all(env.get("delivery_group_id") == "group-user-1" for env in body)
