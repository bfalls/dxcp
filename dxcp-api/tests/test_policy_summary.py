import json
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
import pytest
from auth_utils import auth_header, configure_auth_env, mock_jwks
from fake_engine import FakeEngineAdapter


from test_helpers import seed_defaults

pytestmark = pytest.mark.anyio


def _write_service_registry(path: Path) -> None:
    data = [
        {
            "service_name": "service-a",
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

    main = importlib.import_module("main")
    return main


@asynccontextmanager
async def _client_and_state(tmp_path: Path, monkeypatch):
    main = _load_main(tmp_path)
    mock_jwks(monkeypatch)
    main.spinnaker = FakeEngineAdapter()
    main.idempotency = main.IdempotencyStore()
    main.rate_limiter = main.RateLimiter()
    main.storage = main.build_storage()
    seed_defaults(main.storage)
    main.guardrails = main.Guardrails(main.storage)

    default_group = main.storage.get_delivery_group("default")
    if default_group:
        default_group["services"] = []
        main.storage.update_delivery_group(default_group)

    if not main.storage.get_recipe("default"):
        main.storage.insert_recipe(
            {
                "id": "default",
                "name": "Default Recipe",
                "description": "Default recipe for policy summary tests",
                "spinnaker_application": None,
                "deploy_pipeline": "deploy-default",
                "rollback_pipeline": "rollback-default",
                "effective_behavior_summary": "Default deploy behavior.",
                "status": "active",
            }
        )

    main.storage.insert_delivery_group(
        {
            "id": "group-a",
            "name": "Group A",
            "description": "Primary group for policy summary tests",
            "owner": None,
            "services": ["service-a"],
            "allowed_recipes": ["default"],
            "allowed_environments": ["sandbox"],
            "guardrails": {
                "max_concurrent_deployments": 2,
                "daily_deploy_quota": 5,
                "daily_rollback_quota": 5,
            },
        }
    )
    main.storage.insert_environment(
        {
            "id": "group-a:sandbox",
            "name": "sandbox",
            "type": "non_prod",
            "delivery_group_id": "group-a",
            "is_enabled": True,
            "guardrails": None,
            "created_at": main.utc_now(),
            "created_by": "system",
            "updated_at": main.utc_now(),
            "updated_by": "system",
        }
    )

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=main.app),
        base_url="http://testserver",
    ) as client:
        yield client, main


async def test_policy_summary_returns_policy_snapshot(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, _):
        response = await client.post(
            "/v1/policy/summary",
            headers=auth_header(["dxcp-platform-admins"]),
            json={"service": "service-a", "environment": "sandbox", "recipeId": "default"},
        )

    assert response.status_code == 200
    body = response.json()
    assert body["service"] == "service-a"
    assert body["deliveryGroupId"] == "group-a"
    policy = body["policy"]
    assert policy["max_concurrent_deployments"] == 2
    assert policy["current_concurrent_deployments"] == 0
    assert policy["daily_deploy_quota"] == 5
    assert policy["deployments_used"] == 0
    assert policy["deployments_remaining"] == 5
    assert body["generatedAt"]
