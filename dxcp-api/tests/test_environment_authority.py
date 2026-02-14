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


class FakeSpinnaker:
    def __init__(self) -> None:
        self.mode = "lambda"

    def trigger_deploy(self, payload: dict, idempotency_key: str) -> dict:
        return {"executionId": "exec-1", "executionUrl": "http://spinnaker.local/pipelines/exec-1"}


def _write_service_registry(path: Path) -> None:
    data = [
        {
            "service_name": "payments",
            "allowed_environments": ["sandbox"],
            "allowed_recipes": ["recipe-a"],
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


def _insert_group_environment(main, group_id: str, name: str, enabled: bool = True) -> None:
    main.storage.insert_environment(
        {
            "id": f"{group_id}:{name}",
            "name": name,
            "type": "prod" if name == "prod" else "non_prod",
            "delivery_group_id": group_id,
            "is_enabled": enabled,
            "guardrails": None,
            "created_at": main.utc_now(),
            "created_by": "system",
            "updated_at": main.utc_now(),
            "updated_by": "system",
        }
    )


@asynccontextmanager
async def _client_and_state(tmp_path: Path, monkeypatch):
    main = _load_main(tmp_path)
    mock_jwks(monkeypatch)
    main.spinnaker = FakeSpinnaker()
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
            "id": "recipe-a",
            "name": "Recipe A",
            "description": None,
            "spinnaker_application": None,
            "deploy_pipeline": "demo-deploy",
            "rollback_pipeline": "rollback-demo-service",
            "status": "active",
        }
    )
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
    main.storage.insert_delivery_group(
        {
            "id": "group-a",
            "name": "Group A",
            "description": None,
            "owner": None,
            "services": ["payments"],
            "allowed_environments": ["sandbox", "staging"],
            "allowed_recipes": ["recipe-a"],
            "guardrails": None,
        }
    )
    _insert_group_environment(main, "group-a", "sandbox", enabled=True)
    _insert_group_environment(main, "group-a", "staging", enabled=True)

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=main.app),
        base_url="http://testserver",
    ) as client:
        yield client, main


def _deploy_payload(environment: str) -> dict:
    return {
        "service": "payments",
        "environment": environment,
        "version": "1.2.3",
        "changeSummary": f"deploy to {environment}",
        "recipeId": "recipe-a",
    }


async def test_delivery_group_environment_allows_deploy_without_service_registry_change(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, _):
        response = await client.post(
            "/v1/deployments",
            headers={"Idempotency-Key": "deploy-staging-1", **auth_header(["dxcp-platform-admins"])},
            json=_deploy_payload("staging"),
        )
    assert response.status_code == 201
    assert response.json()["environment"] == "staging"


@pytest.mark.parametrize("environment", ["sandbox", "staging"])
async def test_service_can_deploy_to_any_delivery_group_allowed_environment(tmp_path: Path, monkeypatch, environment: str):
    async with _client_and_state(tmp_path, monkeypatch) as (client, _):
        response = await client.post(
            "/v1/deployments",
            headers={"Idempotency-Key": f"deploy-{environment}-2", **auth_header(["dxcp-platform-admins"])},
            json=_deploy_payload(environment),
        )
    assert response.status_code == 201
    assert response.json()["environment"] == environment


async def test_disallowed_environment_rejected_server_side(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, _):
        response = await client.post(
            "/v1/deployments",
            headers={"Idempotency-Key": "deploy-prod-3", **auth_header(["dxcp-platform-admins"])},
            json=_deploy_payload("prod"),
        )
    assert response.status_code == 403
    assert response.json()["code"] == "ENVIRONMENT_NOT_ALLOWED"
