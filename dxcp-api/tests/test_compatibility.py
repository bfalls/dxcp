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
            "service_name": "service-a",
            "allowed_environments": ["sandbox"],
            "allowed_recipes": ["recipe-a"],
            "allowed_artifact_sources": ["s3://dxcp-test-bucket/"],
        },
        {
            "service_name": "service-b",
            "allowed_environments": ["sandbox"],
            "allowed_recipes": ["recipe-b"],
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
    seed_defaults(main.storage)
    main.guardrails = main.Guardrails(main.storage)

    default_group = main.storage.get_delivery_group("default")
    if default_group:
        default_group["services"] = []
        main.storage.update_delivery_group(default_group)

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

    for recipe_id in ["recipe-a", "recipe-b"]:
        main.storage.insert_recipe(
            {
                "id": recipe_id,
                "name": f"Recipe {recipe_id[-1].upper()}",
                "description": None,
                "spinnaker_application": None,
                "deploy_pipeline": "demo-deploy",
                "rollback_pipeline": "demo-rollback",
                "effective_behavior_summary": "Test recipe behavior summary.",
                "status": "active",
            }
        )

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=main.app),
        base_url="http://testserver",
    ) as client:
        yield client, main


def _deploy_payload(service: str, recipe_id: str) -> dict:
    return {
        "service": service,
        "environment": "sandbox",
        "version": "1.0.0",
        "changeSummary": "compatibility test",
        "recipeId": recipe_id,
    }


def _assert_error_schema(payload: dict) -> None:
    assert payload.get("code")
    assert payload.get("error_code") == payload.get("code")
    assert isinstance(payload.get("message"), str)
    assert payload.get("request_id")


def _assert_safe_message(payload: dict, expected_keyword: str) -> None:
    message = payload.get("message", "").lower()
    assert expected_keyword in message
    assert "spinnaker" not in message


async def test_deploy_rejects_recipe_not_allowed_by_delivery_group(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, main):
        main.storage.insert_delivery_group(
            {
                "id": "group-a",
                "name": "Group A",
                "description": None,
                "owner": None,
                "services": ["service-a"],
                "allowed_recipes": ["recipe-a"],
                "allowed_environments": ["sandbox"],
                "guardrails": None,
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
        response = await client.post(
            "/v1/deployments",
            headers={"Idempotency-Key": "deploy-compat-1", **auth_header(["dxcp-platform-admins"])},
            json=_deploy_payload(service="service-a", recipe_id="recipe-b"),
        )
    assert response.status_code == 403
    body = response.json()
    assert body["code"] == "RECIPE_NOT_ALLOWED"
    _assert_error_schema(body)
    _assert_safe_message(body, "policy")


async def test_deploy_rejects_recipe_incompatible_with_service(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, main):
        main.storage.insert_delivery_group(
            {
                "id": "group-b",
                "name": "Group B",
                "description": None,
                "owner": None,
                "services": ["service-a"],
                "allowed_recipes": ["recipe-b"],
                "allowed_environments": ["sandbox"],
                "guardrails": None,
            }
        )
        main.storage.insert_environment(
            {
                "id": "group-b:sandbox",
                "name": "sandbox",
                "type": "non_prod",
                "delivery_group_id": "group-b",
                "is_enabled": True,
                "guardrails": None,
                "created_at": main.utc_now(),
                "created_by": "system",
                "updated_at": main.utc_now(),
                "updated_by": "system",
            }
        )
        response = await client.post(
            "/v1/deployments",
            headers={"Idempotency-Key": "deploy-compat-2", **auth_header(["dxcp-platform-admins"])},
            json=_deploy_payload(service="service-a", recipe_id="recipe-b"),
        )
    assert response.status_code == 400
    body = response.json()
    assert body["code"] == "RECIPE_INCOMPATIBLE"
    _assert_error_schema(body)
    _assert_safe_message(body, "incompatible")


async def test_validate_rejects_recipe_not_allowed_by_delivery_group(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, main):
        main.storage.insert_delivery_group(
            {
                "id": "group-c",
                "name": "Group C",
                "description": None,
                "owner": None,
                "services": ["service-a"],
                "allowed_recipes": ["recipe-a"],
                "allowed_environments": ["sandbox"],
                "guardrails": None,
            }
        )
        main.storage.insert_environment(
            {
                "id": "group-c:sandbox",
                "name": "sandbox",
                "type": "non_prod",
                "delivery_group_id": "group-c",
                "is_enabled": True,
                "guardrails": None,
                "created_at": main.utc_now(),
                "created_by": "system",
                "updated_at": main.utc_now(),
                "updated_by": "system",
            }
        )
        response = await client.post(
            "/v1/deployments/validate",
            headers=auth_header(["dxcp-platform-admins"]),
            json=_deploy_payload(service="service-a", recipe_id="recipe-b"),
        )
    assert response.status_code == 403
    body = response.json()
    assert body["code"] == "RECIPE_NOT_ALLOWED"
    _assert_error_schema(body)
    _assert_safe_message(body, "policy")


async def test_validate_rejects_recipe_incompatible_with_service(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, main):
        main.storage.insert_delivery_group(
            {
                "id": "group-d",
                "name": "Group D",
                "description": None,
                "owner": None,
                "services": ["service-a"],
                "allowed_recipes": ["recipe-b"],
                "allowed_environments": ["sandbox"],
                "guardrails": None,
            }
        )
        main.storage.insert_environment(
            {
                "id": "group-d:sandbox",
                "name": "sandbox",
                "type": "non_prod",
                "delivery_group_id": "group-d",
                "is_enabled": True,
                "guardrails": None,
                "created_at": main.utc_now(),
                "created_by": "system",
                "updated_at": main.utc_now(),
                "updated_by": "system",
            }
        )
        response = await client.post(
            "/v1/deployments/validate",
            headers=auth_header(["dxcp-platform-admins"]),
            json=_deploy_payload(service="service-a", recipe_id="recipe-b"),
        )
    assert response.status_code == 400
    body = response.json()
    assert body["code"] == "RECIPE_INCOMPATIBLE"
    _assert_error_schema(body)
    _assert_safe_message(body, "incompatible")
