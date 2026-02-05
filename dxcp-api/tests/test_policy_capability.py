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

    def trigger_deploy(self, payload: dict, idempotency_key: str) -> dict:
        return {"executionId": "exec-1", "executionUrl": "http://spinnaker.local/pipelines/exec-1"}


def _write_service_registry(path: Path) -> None:
    data = [
        {
            "service_name": "service-a",
            "allowed_environments": ["sandbox"],
            "allowed_recipes": ["recipe-a"],
            "allowed_artifact_sources": ["local:"],
        },
        {
            "service_name": "service-b",
            "allowed_environments": ["sandbox"],
            "allowed_recipes": [],
            "allowed_artifact_sources": ["local:"],
        },
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
    main.spinnaker = FakeSpinnaker()
    main.idempotency = main.IdempotencyStore()
    main.rate_limiter = main.RateLimiter()
    main.storage = main.build_storage()
    main.guardrails = main.Guardrails(main.storage)
    for service_name in ["service-a", "service-b"]:
        main.storage.insert_build(
            {
                "service": service_name,
                "version": "1.0.0",
                "artifactRef": f"local:{service_name}-1.0.0.zip",
                "sha256": "a" * 64,
                "sizeBytes": 1024,
                "contentType": "application/zip",
                "registeredAt": main.utc_now(),
            }
        )
    default_group = main.storage.get_delivery_group("default")
    if default_group:
        default_group["services"] = []
        main.storage.update_delivery_group(default_group)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=main.app),
        base_url="http://testserver",
    ) as client:
        yield client, main


async def test_service_compatible_but_not_permitted(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, main):
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
        response = await client.post(
            "/v1/deployments",
            headers={"Idempotency-Key": "deploy-1", **auth_header(["dxcp-platform-admins"])},
            json={
                "service": "service-b",
                "environment": "sandbox",
                "version": "1.0.0",
                "changeSummary": "test",
                "recipeId": "recipe-a",
            },
        )
    assert response.status_code == 403
    assert response.json()["code"] == "SERVICE_NOT_IN_DELIVERY_GROUP"


async def test_service_permitted_but_not_compatible(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, main):
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
        main.storage.insert_delivery_group(
            {
                "id": "group-a",
                "name": "Group A",
                "description": None,
                "owner": None,
                "services": ["service-a"],
                "allowed_recipes": ["recipe-a"],
                "guardrails": None,
            }
        )
        response = await client.post(
            "/v1/deployments",
            headers={"Idempotency-Key": "deploy-2", **auth_header(["dxcp-platform-admins"])},
            json={
                "service": "service-a",
                "environment": "prod",
                "version": "1.0.0",
                "changeSummary": "test",
                "recipeId": "recipe-a",
            },
        )
    assert response.status_code == 400


async def test_permitted_and_compatible(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, main):
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
        main.storage.insert_delivery_group(
            {
                "id": "group-a",
                "name": "Group A",
                "description": None,
                "owner": None,
                "services": ["service-a"],
                "allowed_recipes": ["recipe-a"],
                "guardrails": None,
            }
        )
        response = await client.post(
            "/v1/deployments",
            headers={"Idempotency-Key": "deploy-3", **auth_header(["dxcp-platform-admins"])},
            json={
                "service": "service-a",
                "environment": "sandbox",
                "version": "1.0.0",
                "changeSummary": "test",
                "recipeId": "recipe-a",
            },
        )
    assert response.status_code == 201


async def test_recipe_allowed_by_service_not_delivery_group(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, main):
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
        main.storage.insert_delivery_group(
            {
                "id": "group-a",
                "name": "Group A",
                "description": None,
                "owner": None,
                "services": ["service-a"],
                "allowed_recipes": [],
                "guardrails": None,
            }
        )
        response = await client.post(
            "/v1/deployments",
            headers={"Idempotency-Key": "deploy-4", **auth_header(["dxcp-platform-admins"])},
            json={
                "service": "service-a",
                "environment": "sandbox",
                "version": "1.0.0",
                "changeSummary": "test",
                "recipeId": "recipe-a",
            },
        )
    assert response.status_code == 403
    assert response.json()["code"] == "RECIPE_NOT_ALLOWED"


async def test_group_allows_recipe_but_service_incompatible(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, main):
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
        main.storage.insert_delivery_group(
            {
                "id": "group-b",
                "name": "Group B",
                "description": None,
                "owner": None,
                "services": ["service-b"],
                "allowed_recipes": ["recipe-a"],
                "guardrails": None,
            }
        )
        response = await client.post(
            "/v1/deployments",
            headers={"Idempotency-Key": "deploy-5", **auth_header(["dxcp-platform-admins"])},
            json={
                "service": "service-b",
                "environment": "sandbox",
                "version": "1.0.0",
                "changeSummary": "test",
                "recipeId": "recipe-a",
            },
        )
    assert response.status_code == 400
