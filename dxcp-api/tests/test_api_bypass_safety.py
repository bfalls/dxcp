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

    def trigger_deploy(self, payload: dict, idempotency_key: str) -> dict:
        return {"executionId": "exec-1", "executionUrl": "http://spinnaker.local/pipelines/exec-1"}


def _write_service_registry(path: Path) -> None:
    data = [
        {
            "service_name": "service-a",
            "allowed_environments": ["sandbox"],
            "allowed_recipes": ["recipe-a"],
            "allowed_artifact_sources": ["s3://dxcp-test-bucket/"],
        },
        {
            "service_name": "service-b",
            "allowed_environments": ["sandbox"],
            "allowed_recipes": [],
            "allowed_artifact_sources": ["s3://dxcp-test-bucket/"],
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
                "artifactRef": f"s3://dxcp-test-bucket/{service_name}-1.0.0.zip",
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
            "guardrails": {
                "max_concurrent_deployments": 1,
                "daily_deploy_quota": 1,
                "daily_rollback_quota": 5,
            },
        }
    )

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=main.app),
        base_url="http://testserver",
    ) as client:
        yield client, main


def _deploy_payload(service: str, version: str = "1.0.0", recipe_id: str = "recipe-a") -> dict:
    return {
        "service": service,
        "environment": "sandbox",
        "version": version,
        "changeSummary": f"deploy {service}",
        "recipeId": recipe_id,
    }


def _assert_error(response: httpx.Response, expected_code: str, expected_status: int, expected_cause: str | None = None) -> None:
    payload = response.json()
    assert response.status_code == expected_status
    assert payload["code"] == expected_code
    assert payload["error_code"] == expected_code
    if expected_cause:
        assert payload["failure_cause"] == expected_cause
    assert isinstance(payload.get("message"), str)
    assert payload.get("request_id")


async def test_invalid_version_rejected(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, _):
        response = await client.post(
            "/v1/deployments",
            headers={"Idempotency-Key": "deploy-1", **auth_header(["dxcp-platform-admins"])},
            json=_deploy_payload("service-a", version="9.9.9"),
        )
    _assert_error(response, "VERSION_NOT_FOUND", 400, "USER_ERROR")


async def test_incompatible_service_recipe_rejected(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, main):
        main.storage.insert_delivery_group(
            {
                "id": "group-b",
                "name": "Group B",
                "description": None,
                "owner": None,
                "services": ["service-b"],
                "allowed_recipes": ["recipe-a"],
                "guardrails": {
                    "max_concurrent_deployments": 1,
                    "daily_deploy_quota": 5,
                    "daily_rollback_quota": 5,
                },
            }
        )
        response = await client.post(
            "/v1/deployments/validate",
            headers=auth_header(["dxcp-platform-admins"]),
            json=_deploy_payload("service-b"),
        )
    _assert_error(response, "RECIPE_INCOMPATIBLE", 400, "POLICY_CHANGE")


async def test_unauthorized_delivery_group_rejected(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, _):
        response = await client.post(
            "/v1/deployments/validate",
            headers=auth_header(["dxcp-platform-admins"]),
            json=_deploy_payload("service-b"),
        )
    _assert_error(response, "SERVICE_NOT_IN_DELIVERY_GROUP", 403, "POLICY_CHANGE")


async def test_quota_exceeded_rejected(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, main):
        main.rate_limiter.check_mutate(
            "user-1",
            "deploy",
            quota_scope="group-a",
            quota_limit=1,
        )
        response = await client.post(
            "/v1/deployments/validate",
            headers=auth_header(["dxcp-platform-admins"]),
            json=_deploy_payload("service-a"),
        )
    _assert_error(response, "QUOTA_EXCEEDED", 429, "POLICY_CHANGE")


async def test_concurrency_limit_rejected(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, main):
        main.storage.insert_deployment(
            {
                "id": "deploy-1",
                "service": "service-a",
                "environment": "sandbox",
                "version": "1.0.0",
                "recipeId": "recipe-a",
                "state": "IN_PROGRESS",
                "changeSummary": "active deploy",
                "createdAt": main.utc_now(),
                "updatedAt": main.utc_now(),
                "spinnakerExecutionId": "exec-1",
                "spinnakerExecutionUrl": "http://spinnaker.local/pipelines/exec-1",
                "deliveryGroupId": "group-a",
                "failures": [],
            },
            [],
        )
        response = await client.post(
            "/v1/deployments/validate",
            headers=auth_header(["dxcp-platform-admins"]),
            json=_deploy_payload("service-a"),
        )
    _assert_error(response, "CONCURRENCY_LIMIT_REACHED", 409, "POLICY_CHANGE")


def test_failure_cause_unknown_defaults(tmp_path: Path, monkeypatch):
    main = _load_main(tmp_path)
    assert main.classify_failure_cause("SOMETHING_NEW") == "UNKNOWN"
