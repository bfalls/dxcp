import json
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
import pytest
from auth_utils import auth_header, configure_auth_env, mock_jwks


pytestmark = pytest.mark.anyio


class FakeSpinnaker:
    def __init__(self) -> None:
        self.mode = "lambda"
        self.executions = {}
        self.triggered = []

    def trigger_deploy(self, payload: dict, idempotency_key: str) -> dict:
        execution_id = f"exec-{len(self.executions) + 1}"
        self.executions[execution_id] = {"state": "IN_PROGRESS", "failures": []}
        self.triggered.append({"kind": "deploy", "payload": payload, "idempotency_key": idempotency_key})
        return {"executionId": execution_id, "executionUrl": f"http://spinnaker.local/pipelines/{execution_id}"}

    def get_execution(self, execution_id: str) -> dict:
        execution = self.executions.get(execution_id, {"state": "UNKNOWN", "failures": []})
        return {
            "state": execution["state"],
            "failures": execution["failures"],
            "executionUrl": f"http://spinnaker.local/pipelines/{execution_id}",
        }


def _write_service_registry(path: Path) -> None:
    data = [
        {
            "service_name": "demo-service",
            "allowed_environments": ["sandbox"],
            "allowed_recipes": ["default", "extra"],
            "allowed_artifact_sources": ["local:"],
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
    fake = FakeSpinnaker()
    main.spinnaker = fake
    main.idempotency = main.IdempotencyStore()
    main.rate_limiter = main.RateLimiter()
    main.storage = main.build_storage()
    main.guardrails = main.Guardrails(main.storage)
    if not main.storage.get_delivery_group("default"):
        main.storage.insert_delivery_group(
            {
                "id": "default",
                "name": "Default Delivery Group",
                "description": "Default group for allowlisted services",
                "owner": None,
                "services": ["demo-service"],
                "allowed_recipes": ["default"],
                "guardrails": None,
            }
        )
    main.storage.insert_recipe(
        {
            "id": "extra",
            "name": "Extra Recipe",
            "description": "Extra recipe for tests",
            "allowed_parameters": [],
            "spinnaker_application": None,
            "deploy_pipeline": "demo-deploy",
            "rollback_pipeline": "rollback-demo-service",
        }
    )
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=main.app),
        base_url="http://testserver",
    ) as client:
        yield client, main, fake


def _deployment_payload(recipe_id: str | None = None) -> dict:
    payload = {
        "service": "demo-service",
        "environment": "sandbox",
        "version": "1.0.0",
        "changeSummary": "test deploy",
    }
    if recipe_id:
        payload["recipeId"] = recipe_id
    return payload


async def test_deploy_rejects_unknown_recipe(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, _, _):
        response = await client.post(
            "/v1/deployments",
            headers={"Idempotency-Key": "deploy-unknown", **auth_header(["dxcp-platform-admins"])},
            json=_deployment_payload("missing"),
        )
    assert response.status_code == 404
    assert response.json()["code"] == "RECIPE_NOT_FOUND"


async def test_deploy_rejects_not_allowed_recipe(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, _, _):
        response = await client.post(
            "/v1/deployments",
            headers={"Idempotency-Key": "deploy-disallowed", **auth_header(["dxcp-platform-admins"])},
            json=_deployment_payload("extra"),
        )
    assert response.status_code == 403
    assert response.json()["code"] == "RECIPE_NOT_ALLOWED"


async def test_deploy_requires_recipe_id(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, _, _):
        response = await client.post(
            "/v1/deployments",
            headers={"Idempotency-Key": "deploy-default", **auth_header(["dxcp-platform-admins"])},
            json=_deployment_payload(),
        )
    assert response.status_code == 400
    assert response.json()["code"] == "RECIPE_ID_REQUIRED"
