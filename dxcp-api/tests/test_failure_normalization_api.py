from __future__ import annotations

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
            "allowed_environments": ["sandbox"],
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

    main.storage.insert_recipe(
        {
            "id": "standard",
            "name": "Standard Recipe",
            "description": "Default recipe for failure normalization",
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
            "description": "Group for failure normalization",
            "owner": None,
            "services": ["payments"],
            "allowed_recipes": ["standard"],
            "allowed_environments": ["sandbox"],
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

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=main.app),
        base_url="http://testserver",
    ) as client:
        yield client, main


def _deploy_payload() -> dict:
    return {
        "service": "payments",
        "environment": "sandbox",
        "version": "1.2.3",
        "changeSummary": "deploy payments",
        "recipeId": "standard",
    }


def _assert_user_safe_failure(failure: dict) -> None:
    summary = (failure.get("summary") or "").lower()
    action_hint = (failure.get("actionHint") or "").lower()
    detail = failure.get("detail")
    assert summary
    assert action_hint
    assert "spinnaker" not in summary
    assert "spinnaker" not in action_hint
    if isinstance(detail, str):
        assert "spinnaker" not in detail.lower()


async def _deploy_and_fail(
    client: httpx.AsyncClient,
    main,
    failure_payload: dict,
) -> tuple[dict, dict]:
    response = await client.post(
        "/v1/deployments",
        headers={"Idempotency-Key": "deploy-failure-1", **auth_header(["dxcp-platform-admins"])},
        json=_deploy_payload(),
    )
    assert response.status_code == 201
    body = response.json()

    execution_id = body["engineExecutionId"]
    main.spinnaker.executions[execution_id] = {"state": "FAILED", "failures": [failure_payload]}

    refreshed = await client.get(
        f"/v1/deployments/{body['id']}",
        headers=auth_header(["dxcp-platform-admins"]),
    )
    assert refreshed.status_code == 200
    return body, refreshed.json()


async def test_failure_normalized_in_deployment_record_and_endpoint(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, main):
        _, deployment = await _deploy_and_fail(
            client,
            main,
            {
                "category": "artifact",
                "summary": "Build artifact could not be validated.",
                "actionHint": "Register a valid build and retry.",
                "detail": "Artifact metadata did not match.",
                "observedAt": "2024-01-01T00:00:00Z",
            },
        )

        assert deployment["state"] == "FAILED"
        failures = deployment["failures"]
        assert failures
        assert failures[0]["category"] == "ARTIFACT"
        _assert_user_safe_failure(failures[0])

        response = await client.get(
            f"/v1/deployments/{deployment['id']}/failures",
            headers=auth_header(["dxcp-platform-admins"]),
        )
        assert response.status_code == 200
        endpoint_failures = response.json()
        assert endpoint_failures and endpoint_failures[0]["category"] == "ARTIFACT"
        _assert_user_safe_failure(endpoint_failures[0])


async def test_unknown_failure_defaults_to_safe_summary(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, main):
        _, deployment = await _deploy_and_fail(
            client,
            main,
            {
                "category": "new_failure_code",
                "summary": "",
                "actionHint": "",
            },
        )

        failures = deployment["failures"]
        assert failures
        assert failures[0]["category"] == "UNKNOWN"
        assert failures[0]["summary"] == "Deployment failed."
        _assert_user_safe_failure(failures[0])
