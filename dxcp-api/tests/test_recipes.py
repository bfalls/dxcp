import json
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
import pytest
from auth_utils import auth_header, build_token, configure_auth_env, mock_jwks


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
    main.storage.insert_build(
        {
            "service": "demo-service",
            "version": "1.0.0",
            "artifactRef": "local:demo-service-1.0.0.zip",
            "sha256": "a" * 64,
            "sizeBytes": 1024,
            "contentType": "application/zip",
            "registeredAt": main.utc_now(),
        }
    )
    default_group = main.storage.get_delivery_group("default")
    if not default_group:
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
    extra_recipe = {
        "id": "extra",
        "name": "Extra Recipe",
        "description": "Extra recipe for tests",
        "spinnaker_application": None,
        "deploy_pipeline": "demo-deploy",
        "rollback_pipeline": "rollback-demo-service",
        "status": "active",
    }
    if main.storage.get_recipe("extra"):
        main.storage.update_recipe(extra_recipe)
    else:
        main.storage.insert_recipe(extra_recipe)
    deprecated_recipe = {
        "id": "deprecated",
        "name": "Deprecated Recipe",
        "description": "Deprecated recipe for tests",
        "spinnaker_application": None,
        "deploy_pipeline": "demo-deploy",
        "rollback_pipeline": "rollback-demo-service",
        "status": "deprecated",
    }
    if main.storage.get_recipe("deprecated"):
        main.storage.update_recipe(deprecated_recipe)
    else:
        main.storage.insert_recipe(deprecated_recipe)
    updated_default = main.storage.get_delivery_group("default") or {
        "id": "default",
        "name": "Default Delivery Group",
        "description": "Default group for allowlisted services",
        "owner": None,
        "services": ["demo-service"],
        "allowed_recipes": ["default"],
        "guardrails": None,
    }
    updated_default["services"] = ["demo-service"]
    updated_default["allowed_recipes"] = ["default", "deprecated"]
    if hasattr(main.storage, "update_delivery_group"):
        main.storage.update_delivery_group(updated_default)
    else:
        main.storage.insert_delivery_group(updated_default)
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


async def test_deploy_rejects_deprecated_recipe(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, _, _):
        response = await client.post(
            "/v1/deployments",
            headers={"Idempotency-Key": "deploy-deprecated", **auth_header(["dxcp-platform-admins"])},
            json=_deployment_payload("deprecated"),
        )
    assert response.status_code == 403
    assert response.json()["code"] == "RECIPE_DEPRECATED"


async def test_deploy_preflight_returns_policy_snapshot(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, _, _):
        response = await client.post(
            "/v1/deployments/validate",
            headers=auth_header(["dxcp-platform-admins"]),
            json=_deployment_payload("default"),
        )
    assert response.status_code == 200
    body = response.json()
    assert body["service"] == "demo-service"
    assert body["deliveryGroupId"] == "default"
    assert body["versionRegistered"] is True
    assert body["policy"]["max_concurrent_deployments"] >= 1
    assert "deployments_remaining" in body["policy"]


async def test_deploy_rejects_unregistered_version(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, _, _):
        payload = _deployment_payload("default")
        payload["version"] = "9.9.9"
        response = await client.post(
            "/v1/deployments",
            headers={"Idempotency-Key": "deploy-missing-version", **auth_header(["dxcp-platform-admins"])},
            json=payload,
        )
    assert response.status_code == 400
    assert response.json()["code"] == "VERSION_NOT_FOUND"


async def test_recipe_audit_fields_on_create_and_update(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, _, _):
        create_token = build_token(["dxcp-platform-admins"], subject="admin-1")
        response = await client.post(
            "/v1/recipes",
            headers={"Authorization": f"Bearer {create_token}"},
            json={
                "id": "audit-recipe",
                "name": "Audit Recipe",
                "description": "Audit test",
                "spinnaker_application": "app-a",
                "deploy_pipeline": "deploy-a",
                "rollback_pipeline": "rollback-a",
                "status": "active",
            },
        )
    assert response.status_code == 200
    created = response.json()
    assert created["created_by"] == "admin-1"
    assert created["updated_by"] == "admin-1"
    assert created["created_at"]
    assert created["updated_at"]
    assert created.get("last_change_reason") in (None, "")

    async with _client_and_state(tmp_path, monkeypatch) as (client, _, _):
        update_token = build_token(["dxcp-platform-admins"], subject="admin-2")
        response = await client.put(
            "/v1/recipes/audit-recipe",
            headers={"Authorization": f"Bearer {update_token}"},
            json={
                "id": "audit-recipe",
                "name": "Audit Recipe Updated",
                "description": "Audit test",
                "spinnaker_application": "app-a",
                "deploy_pipeline": "deploy-a",
                "rollback_pipeline": "rollback-a",
                "status": "active",
                "change_reason": "Refine metadata",
            },
        )
    assert response.status_code == 200
    updated = response.json()
    assert updated["created_by"] == "admin-1"
    assert updated["updated_by"] == "admin-2"
    assert updated["created_at"] == created["created_at"]
    assert updated["updated_at"] != created["updated_at"]
    assert updated["last_change_reason"] == "Refine metadata"
