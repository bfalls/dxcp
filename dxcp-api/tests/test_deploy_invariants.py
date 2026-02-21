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

pytestmark = [pytest.mark.anyio, pytest.mark.governance_contract]


def _write_service_registry(path: Path) -> None:
    data = [
        {
            "service_name": "payments",
            "allowed_environments": ["sandbox", "staging"],
            "allowed_recipes": ["standard"],
            "allowed_artifact_sources": ["s3://dxcp-test-bucket/"],
        },
        {
            "service_name": "billing",
            "allowed_environments": ["sandbox", "staging"],
            "allowed_recipes": ["beta"],
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

    for service_name in ["payments", "billing"]:
        main.storage.insert_build(
            {
                "service": service_name,
                "version": "1.2.3",
                "artifactRef": f"s3://dxcp-test-bucket/{service_name}-1.2.3.zip",
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
            "description": "Default recipe for deployment invariants",
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
            "description": "Group for deploy invariants",
            "owner": None,
            "services": ["payments", "billing"],
            "allowed_recipes": ["standard"],
            "allowed_environments": ["sandbox", "staging"],
            "guardrails": {
                "max_concurrent_deployments": 1,
                "daily_deploy_quota": 1,
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


def _deploy_payload(
    service: str = "payments",
    version: str = "1.2.3",
    recipe_id: str = "standard",
    change_summary: str = "deploy payments",
) -> dict:
    return {
        "service": service,
        "environment": "sandbox",
        "version": version,
        "changeSummary": change_summary,
        "recipeId": recipe_id,
    }


def _assert_user_safe_error(body: dict) -> None:
    message = (body.get("message") or "").lower()
    operator_hint = (body.get("operator_hint") or "").lower()
    assert "spinnaker" not in message
    assert "spinnaker" not in operator_hint


async def test_deploy_happy_path_creates_roll_forward_record(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, _):
        response = await client.post(
            "/v1/deployments",
            headers={"Idempotency-Key": "deploy-1", **auth_header(["dxcp-platform-admins"])},
            json=_deploy_payload(),
        )
        assert response.status_code == 201
        body = response.json()

        assert body["service"] == "payments"
        assert body["environment"] == "sandbox"
        assert body["version"] == "1.2.3"
        assert body["recipeId"] == "standard"
        assert body["deploymentKind"] == "ROLL_FORWARD"
        assert body["state"] == "IN_PROGRESS"
        assert body["changeSummary"] == "deploy payments"
        assert body["engineExecutionId"].startswith("exec-")
        assert body["engineExecutionUrl"].startswith("http://engine.local/")


async def test_deployment_record_update_methods_are_unsupported(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, _):
        created = await client.post(
            "/v1/deployments",
            headers={"Idempotency-Key": "deploy-immutable-1", **auth_header(["dxcp-platform-admins"])},
            json=_deploy_payload(),
        )
        assert created.status_code == 201
        deployment_id = created.json()["id"]

        patch_attempt = await client.patch(
            f"/v1/deployments/{deployment_id}",
            headers=auth_header(["dxcp-platform-admins"]),
            json={"version": "9.9.9"},
        )
        put_attempt = await client.put(
            f"/v1/deployments/{deployment_id}",
            headers=auth_header(["dxcp-platform-admins"]),
            json={"version": "9.9.9"},
        )
        post_attempt = await client.post(
            f"/v1/deployments/{deployment_id}",
            headers=auth_header(["dxcp-platform-admins"]),
            json={"version": "9.9.9"},
        )
        assert patch_attempt.status_code == 405
        assert put_attempt.status_code == 405
        assert post_attempt.status_code == 405

        read_back = await client.get(
            f"/v1/deployments/{deployment_id}",
            headers=auth_header(["dxcp-platform-admins"]),
        )
        assert read_back.status_code == 200
        assert read_back.json()["version"] == "1.2.3"


async def test_internal_update_preserves_protected_deployment_fields(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, main):
        created = await client.post(
            "/v1/deployments",
            headers={"Idempotency-Key": "deploy-immutable-2", **auth_header(["dxcp-platform-admins"])},
            json=_deploy_payload(),
        )
        assert created.status_code == 201
        deployment_id = created.json()["id"]
        before = main.storage.get_deployment(deployment_id)

        main.storage.update_deployment(deployment_id, "SUCCEEDED", [], outcome="SUCCEEDED")

        after = main.storage.get_deployment(deployment_id)
        for field in ["service", "environment", "recipeId", "version", "deploymentKind", "rollbackOf", "intentCorrelationId"]:
            assert after[field] == before[field]


async def test_internal_update_rejects_terminal_state_rewrite(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, main):
        created = await client.post(
            "/v1/deployments",
            headers={"Idempotency-Key": "deploy-immutable-3", **auth_header(["dxcp-platform-admins"])},
            json=_deploy_payload(),
        )
        assert created.status_code == 201
        deployment_id = created.json()["id"]

        main.storage.update_deployment(deployment_id, "SUCCEEDED", [], outcome="SUCCEEDED")
        with pytest.raises(main.ImmutableDeploymentError):
            main.storage.update_deployment(deployment_id, "FAILED", [], outcome="FAILED")

        record = main.storage.get_deployment(deployment_id)
        assert record["state"] == "SUCCEEDED"
        assert record["outcome"] == "SUCCEEDED"


async def test_deploy_requires_idempotency_key(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, _):
        missing = await client.post(
            "/v1/deployments",
            headers=auth_header(["dxcp-platform-admins"]),
            json=_deploy_payload(),
        )
        empty = await client.post(
            "/v1/deployments",
            headers={"Idempotency-Key": "", **auth_header(["dxcp-platform-admins"])},
            json=_deploy_payload(),
        )
    assert missing.status_code == 400
    assert missing.json()["code"] == "IDMP_KEY_REQUIRED"
    assert empty.status_code == 400
    assert empty.json()["code"] == "IDMP_KEY_REQUIRED"


async def test_deploy_rejects_version_not_found(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, _):
        payload = _deploy_payload(version="9.9.9")
        response = await client.post(
            "/v1/deployments",
            headers={"Idempotency-Key": "deploy-missing-version", **auth_header(["dxcp-platform-admins"])},
            json=payload,
        )
    assert response.status_code == 400
    body = response.json()
    assert body["code"] == "VERSION_NOT_FOUND"
    _assert_user_safe_error(body)


async def test_deploy_maps_missing_artifact_to_artifact_not_found(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, main):
        def _raise_missing_artifact(payload: dict, idempotency_key: str) -> dict:
            raise RuntimeError(
                "Spinnaker HTTP 404: artifact fetch failed: NoSuchKey for s3://dxcp-test-bucket/payments-1.2.3.zip"
            )

        monkeypatch.setattr(main.spinnaker, "trigger_deploy", _raise_missing_artifact)
        response = await client.post(
            "/v1/deployments",
            headers={"Idempotency-Key": "deploy-artifact-missing", **auth_header(["dxcp-platform-admins"])},
            json=_deploy_payload(),
        )

    assert response.status_code == 409
    body = response.json()
    assert body["code"] == "ARTIFACT_NOT_FOUND"
    assert body["error_code"] == "ARTIFACT_NOT_FOUND"
    assert body["failure_cause"] == "POLICY_CHANGE"
    assert body["message"] == (
        "Artifact is no longer available in the artifact store. "
        "Rebuild and publish again, then deploy the new version."
    )
    assert body.get("request_id")
    assert body.get("operator_hint") == "If using demo artifact retention, older artifacts may expire."


async def test_deploy_unknown_engine_error_uses_existing_fallback(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, main):
        def _raise_unknown(payload: dict, idempotency_key: str) -> dict:
            raise RuntimeError("unexpected engine failure signature")

        monkeypatch.setattr(main.spinnaker, "trigger_deploy", _raise_unknown)
        response = await client.post(
            "/v1/deployments",
            headers={"Idempotency-Key": "deploy-engine-unknown", **auth_header(["dxcp-platform-admins"])},
            json=_deploy_payload(),
        )

    assert response.status_code == 502
    body = response.json()
    assert body["code"] == "ENGINE_CALL_FAILED"
    assert body["error_code"] == "ENGINE_CALL_FAILED"
    assert body["message"] == "Unable to start deployment"
    assert body.get("request_id")


async def test_deploy_malformed_engine_response_returns_structured_error(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, main):
        def _malformed_response(payload: dict, idempotency_key: str) -> dict:
            return {"id": "exec-1"}

        monkeypatch.setattr(main.spinnaker, "trigger_deploy", _malformed_response)
        response = await client.post(
            "/v1/deployments",
            headers={"Idempotency-Key": "deploy-engine-malformed", **auth_header(["dxcp-platform-admins"])},
            json=_deploy_payload(),
        )

    assert response.status_code == 502
    body = response.json()
    assert body["code"] == "ENGINE_CALL_FAILED"
    assert body["error_code"] == "ENGINE_CALL_FAILED"
    assert body["message"] == "Unable to start deployment"
    assert body.get("request_id")


async def test_deploy_engine_down_includes_unavailable_discriminator_and_sanitized_diagnostics(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, main):
        main.SETTINGS.spinnaker_base_url = "https://gate.internal.example/api"

        def _raise_unavailable(payload: dict, idempotency_key: str) -> dict:
            raise RuntimeError("Spinnaker HTTP 503: ngrok tunnel unavailable")

        monkeypatch.setattr(main.spinnaker, "trigger_deploy", _raise_unavailable)
        response = await client.post(
            "/v1/deployments",
            headers={"Idempotency-Key": "deploy-engine-down", **auth_header(["dxcp-platform-admins"])},
            json=_deploy_payload(),
        )

    assert response.status_code == 502
    body = response.json()
    assert body["code"] == "ENGINE_CALL_FAILED"
    assert body["message"] == "Unable to start deployment"
    assert body.get("details", {}).get("engine_unavailable") is True
    diagnostics = body.get("details", {}).get("diagnostics") or {}
    assert diagnostics.get("engine") == "spinnaker"
    assert diagnostics.get("upstream_status") == 503
    assert diagnostics.get("engine_host") == "gate.internal.example"
    assert diagnostics.get("request_id")


async def test_deploy_rejects_incompatible_recipe(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, _):
        response = await client.post(
            "/v1/deployments",
            headers={"Idempotency-Key": "deploy-incompatible", **auth_header(["dxcp-platform-admins"])},
            json=_deploy_payload(service="billing"),
        )
    assert response.status_code == 400
    body = response.json()
    assert body["code"] == "RECIPE_INCOMPATIBLE"
    _assert_user_safe_error(body)


async def test_deploy_rejects_when_quota_exceeded(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, _):
        first = await client.post(
            "/v1/deployments",
            headers={"Idempotency-Key": "deploy-quota-1", **auth_header(["dxcp-platform-admins"])},
            json=_deploy_payload(),
        )
        assert first.status_code == 201

        second = await client.post(
            "/v1/deployments",
            headers={"Idempotency-Key": "deploy-quota-2", **auth_header(["dxcp-platform-admins"])},
            json=_deploy_payload(),
        )
    assert second.status_code == 429
    body = second.json()
    assert body["code"] == "QUOTA_EXCEEDED"
    _assert_user_safe_error(body)


async def test_deploy_rejects_when_concurrency_exceeded(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, main):
        main.storage.insert_deployment(
            {
                "id": "dep-active",
                "service": "payments",
                "environment": "sandbox",
                "version": "1.2.3",
                "recipeId": "standard",
                "recipeRevision": 1,
                "effectiveBehaviorSummary": "Standard deploy behavior.",
                "state": "IN_PROGRESS",
                "deploymentKind": "ROLL_FORWARD",
                "outcome": None,
                "intentCorrelationId": "seed",
                "supersededBy": None,
                "changeSummary": "seed deploy",
                "createdAt": main.utc_now(),
                "updatedAt": main.utc_now(),
                "engine_type": "SPINNAKER",
                "spinnakerExecutionId": "exec-seed",
                "spinnakerExecutionUrl": "http://engine.local/pipelines/exec-seed",
                "deliveryGroupId": "group-1",
                "failures": [],
            },
            [],
        )

        response = await client.post(
            "/v1/deployments",
            headers={"Idempotency-Key": "deploy-concurrency", **auth_header(["dxcp-platform-admins"])},
            json=_deploy_payload(),
        )
    assert response.status_code == 409
    body = response.json()
    assert body["code"] == "CONCURRENCY_LIMIT_REACHED"
    _assert_user_safe_error(body)


async def test_deploy_requires_environment(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, _):
        payload = _deploy_payload()
        payload.pop("environment", None)
        response = await client.post(
            "/v1/deployments",
            headers={"Idempotency-Key": "deploy-missing-env", **auth_header(["dxcp-platform-admins"])},
            json=payload,
        )
    assert response.status_code == 400
    assert response.json()["code"] == "INVALID_REQUEST"


async def test_deploy_rejects_disabled_environment(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, main):
        main.storage.update_environment(
            {
                "id": "group-1:staging",
                "name": "staging",
                "type": "non_prod",
                "delivery_group_id": "group-1",
                "is_enabled": False,
                "guardrails": None,
                "created_at": main.utc_now(),
                "created_by": "system",
                "updated_at": main.utc_now(),
                "updated_by": "system",
            }
        )
        payload = _deploy_payload()
        payload["environment"] = "staging"
        response = await client.post(
            "/v1/deployments",
            headers={"Idempotency-Key": "deploy-disabled-env", **auth_header(["dxcp-platform-admins"])},
            json=payload,
        )
    assert response.status_code == 403
    assert response.json()["code"] == "ENVIRONMENT_DISABLED"
