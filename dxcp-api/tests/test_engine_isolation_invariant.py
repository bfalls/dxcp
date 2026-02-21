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
            "service_name": "payments",
            "allowed_environments": ["sandbox", "staging"],
            "allowed_recipes": ["standard"],
            "allowed_artifact_sources": ["s3://dxcp-test-bucket/"],
        }
    ]
    path.write_text(json.dumps(data), encoding="utf-8")


def _load_main(tmp_path: Path):
    dxcp_api_dir = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(dxcp_api_dir))
    os.environ["DXCP_DB_PATH"] = str(tmp_path / "dxcp-test.db")
    os.environ["DXCP_SERVICE_REGISTRY_PATH"] = str(tmp_path / "services.json")
    os.environ["DXCP_TEST_MODE"] = "1"
    configure_auth_env()
    _write_service_registry(Path(os.environ["DXCP_SERVICE_REGISTRY_PATH"]))

    for module in ["main", "config", "storage", "policy", "idempotency", "rate_limit"]:
        if module in sys.modules:
            del sys.modules[module]

    import importlib

    return importlib.import_module("main")


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

    main.storage.insert_recipe(
        {
            "id": "standard",
            "name": "Standard Recipe",
            "description": "Default recipe for engine isolation invariant tests",
            "spinnaker_application": None,
            "deploy_pipeline": "deploy-payments",
            "rollback_pipeline": "rollback-payments",
            "effective_behavior_summary": "Standard deploy behavior.",
            "status": "active",
        }
    )
    main.storage.insert_delivery_group(
        {
            "id": "group-1",
            "name": "Primary Delivery Group",
            "description": "Group for engine isolation invariant tests",
            "owner": None,
            "services": ["payments"],
            "allowed_recipes": ["standard"],
            "allowed_environments": ["sandbox", "staging"],
            "guardrails": {
                "max_concurrent_deployments": 1,
                "daily_deploy_quota": 5,
                "daily_rollback_quota": 5,
            },
        }
    )
    main.storage.insert_environment(
        {
            "id": "group-1:sandbox",
            "name": "sandbox",
            "type": "non_prod",
            "delivery_group_id": "group-1",
            "is_enabled": True,
            "guardrails": None,
            "created_at": main.utc_now(),
            "created_by": "system",
            "updated_at": main.utc_now(),
            "updated_by": "system",
        }
    )
    main._reset_engine_invocation_counter()

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=main.app),
        base_url="http://testserver",
    ) as client:
        yield client, main


def _deploy_payload(version: str = "1.2.3") -> dict:
    return {
        "service": "payments",
        "environment": "sandbox",
        "version": version,
        "changeSummary": "deploy payments",
        "recipeId": "standard",
    }


async def test_engine_not_invoked_when_role_forbidden(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, main):
        response = await client.post(
            "/v1/deployments",
            headers={"Idempotency-Key": "deploy-forbidden", **auth_header(["dxcp-observers"])},
            json=_deploy_payload(),
        )
        assert response.status_code == 403
        assert response.json()["code"] == "ROLE_FORBIDDEN"
        assert main._get_engine_invocation_counter() == 0


async def test_engine_not_invoked_when_version_not_found(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, main):
        response = await client.post(
            "/v1/deployments",
            headers={"Idempotency-Key": "deploy-missing-version", **auth_header(["dxcp-platform-admins"])},
            json=_deploy_payload(version="9.9.9"),
        )
        assert response.status_code == 400
        assert response.json()["code"] == "VERSION_NOT_FOUND"
        assert main._get_engine_invocation_counter() == 0


async def test_engine_invoked_once_for_successful_deploy(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, main):
        main.storage.insert_build(
            {
                "service": "payments",
                "version": "1.2.3",
                "artifactRef": "s3://dxcp-test-bucket/payments-1.2.3.zip",
                "sha256": "a" * 64,
                "sizeBytes": 1024,
                "contentType": "application/zip",
                "registeredAt": main.utc_now(),
            }
        )
        response = await client.post(
            "/v1/deployments",
            headers={"Idempotency-Key": "deploy-success", **auth_header(["dxcp-platform-admins"])},
            json=_deploy_payload(),
        )
        assert response.status_code == 201
        assert main._get_engine_invocation_counter() == 1
