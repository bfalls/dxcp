import json
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
import pytest
from auth_utils import auth_header, auth_header_for_subject, build_token, configure_auth_env, mock_jwks


from test_helpers import seed_defaults

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

    def trigger_rollback(self, payload: dict, idempotency_key: str) -> dict:
        execution_id = f"exec-{len(self.executions) + 1}"
        self.executions[execution_id] = {"state": "IN_PROGRESS", "failures": []}
        self.triggered.append({"kind": "rollback", "payload": payload, "idempotency_key": idempotency_key})
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
    os.environ["DXCP_CI_PUBLISHERS"] = json.dumps(
        [
            {
                "name": "ci-publisher-1",
                "provider": "custom",
                "subjects": ["ci-publisher-1"],
            }
        ]
    )
    configure_auth_env()
    _write_service_registry(Path(os.environ["DXCP_SERVICE_REGISTRY_PATH"]))

    for module in ["main", "config", "storage", "policy", "idempotency", "rate_limit"]:
        if module in sys.modules:
            del sys.modules[module]

    import importlib

    main = importlib.import_module("main")
    return main


pytestmark = pytest.mark.anyio


@asynccontextmanager
async def _client_and_state(tmp_path: Path, monkeypatch):
    main = _load_main(tmp_path)
    mock_jwks(monkeypatch)
    fake = FakeSpinnaker()
    main.spinnaker = fake
    main.idempotency = main.IdempotencyStore()
    main.rate_limiter = main.RateLimiter()
    main.storage = main.build_storage()
    seed_defaults(main.storage)
    main.guardrails = main.Guardrails(main.storage)
    main.storage.insert_build(
        {
            "service": "demo-service",
            "version": "1.0.0",
            "artifactRef": "s3://dxcp-test-bucket/demo-service-1.0.0.zip",
            "sha256": "a" * 64,
            "sizeBytes": 1024,
            "contentType": "application/zip",
            "registeredAt": main.utc_now(),
        }
    )
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=main.app),
        base_url="http://testserver",
    ) as client:
        yield client, main, fake


def _deployment_payload() -> dict:
    return {
        "service": "demo-service",
        "environment": "sandbox",
        "version": "1.0.0",
        "changeSummary": "test deploy",
        "recipeId": "default",
    }


def _insert_deployment(storage, deployment_id: str, version: str, created_at: str):
    record = {
        "id": deployment_id,
        "service": "demo-service",
        "environment": "sandbox",
        "version": version,
        "state": "SUCCEEDED",
        "changeSummary": f"deploy {version}",
        "createdAt": created_at,
        "updatedAt": created_at,
        "spinnakerExecutionId": f"exec-{deployment_id}",
        "spinnakerExecutionUrl": f"http://spinnaker.local/pipelines/exec-{deployment_id}",
        "spinnakerApplication": "demo-app",
        "spinnakerPipeline": "demo-pipeline",
        "deliveryGroupId": "default",
        "failures": [],
    }
    storage.insert_deployment(record, [])


def _build_payload(version: str = "1.0.0") -> dict:
    return {
        "service": "demo-service",
        "version": version,
        "artifactRef": f"s3://dxcp-test-bucket/demo-service-{version}.zip",
        "git_sha": "f" * 40,
        "git_branch": "main",
        "ci_provider": "github_actions",
        "ci_run_id": "run-1",
        "built_at": "2026-02-16T00:00:00Z",
        "sha256": "a" * 64,
        "sizeBytes": 1024,
        "contentType": "application/zip",
    }


def _build_register_existing_payload() -> dict:
    return {
        "service": "demo-service",
        "version": "1.0.0",
        "artifactRef": "s3://dxcp-test-bucket/demo-service-1.0.0.zip",
        "git_sha": "f" * 40,
        "git_branch": "main",
        "ci_provider": "github_actions",
        "ci_run_id": "run-1",
        "built_at": "2026-02-16T00:00:00Z",
    }


def _auth_header_for_email(roles: list[str], email: str, subject: str = "user-1") -> dict:
    return {"Authorization": f"Bearer {build_token(roles, subject=subject, email=email)}"}


async def test_observer_denied_deploy(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, _, _):
        response = await client.post(
            "/v1/deployments",
            headers={"Idempotency-Key": "deploy-1", **auth_header(["dxcp-observers"])},
            json=_deployment_payload(),
        )
    assert response.status_code == 403
    assert response.json()["code"] == "ROLE_FORBIDDEN"


async def test_observer_denied_deploy_validate(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, _, _):
        response = await client.post(
            "/v1/deployments/validate",
            headers=auth_header(["dxcp-observers"]),
            json=_deployment_payload(),
        )
    assert response.status_code == 403
    assert response.json()["code"] == "ROLE_FORBIDDEN"


async def test_observer_denied_rollback(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, main, _):
        _insert_deployment(main.storage, "dep-a", "1.0.0", "2024-01-01T00:00:00Z")
        _insert_deployment(main.storage, "dep-b", "1.0.1", "2024-01-02T00:00:00Z")
        response = await client.post(
            "/v1/deployments/dep-b/rollback",
            headers={"Idempotency-Key": "rollback-1", **auth_header(["dxcp-observers"])},
            json={},
        )
    assert response.status_code == 403
    assert response.json()["code"] == "ROLE_FORBIDDEN"


async def test_observer_denied_admin_endpoint(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, _, _):
        response = await client.get(
            "/v1/admin/system/ci-publishers",
            headers=auth_header(["dxcp-observers"]),
        )
    assert response.status_code == 403
    assert response.json()["code"] == "ROLE_FORBIDDEN"


async def test_observer_denied_build_register(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, _, _):
        response = await client.post(
            "/v1/builds",
            headers={"Idempotency-Key": "build-1", **auth_header(["dxcp-observers"])},
            json=_build_payload(),
        )
    assert response.status_code == 403
    assert response.json()["code"] == "CI_ONLY"


async def test_ci_gate_runs_before_build_payload_validation(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, _, _):
        response = await client.post(
            "/v1/builds",
            headers={"Idempotency-Key": "build-invalid-ci-gate-first", **auth_header(["dxcp-observers"])},
            json={
                "service": "demo-service",
                "version": "not-semver",
                "artifactRef": "s3://dxcp-test-bucket/demo-service-not-semver.zip",
                "git_sha": "f" * 40,
                "git_branch": "main",
                "ci_provider": "github_actions",
                "ci_run_id": "run-invalid",
                "built_at": "2026-02-16T00:00:00Z",
                "sha256": "a" * 64,
                "sizeBytes": 1024,
                "contentType": "application/zip",
            },
        )
    assert response.status_code == 403
    assert response.json()["code"] == "CI_ONLY"


async def test_observer_denied_build_register_existing(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, _, _):
        response = await client.post(
            "/v1/builds/register",
            headers={"Idempotency-Key": "build-register-existing-1", **auth_header(["dxcp-observers"])},
            json=_build_register_existing_payload(),
        )
    assert response.status_code == 403
    assert response.json()["code"] == "CI_ONLY"


async def test_platform_admin_allowed_deploy(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, _, _):
        response = await client.post(
            "/v1/deployments",
            headers={"Idempotency-Key": "deploy-2", **auth_header(["dxcp-platform-admins"])},
            json=_deployment_payload(),
        )
    assert response.status_code == 201


async def test_platform_admin_allowed_rollback(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, main, _):
        _insert_deployment(main.storage, "dep-a", "1.0.0", "2024-01-01T00:00:00Z")
        _insert_deployment(main.storage, "dep-b", "1.0.1", "2024-01-02T00:00:00Z")
        response = await client.post(
            "/v1/deployments/dep-b/rollback",
            headers={"Idempotency-Key": "rollback-2", **auth_header(["dxcp-platform-admins"])},
            json={},
        )
    assert response.status_code == 201


async def test_non_member_owner_denied_get_deployment_status(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, main, _):
        default = main.storage.get_delivery_group("default")
        assert default is not None
        default["owner"] = "owner@example.com"
        main.storage.update_delivery_group(default)

        _insert_deployment(main.storage, "dep-a", "1.0.0", "2024-01-01T00:00:00Z")

        non_member = await client.get(
            "/v1/deployments/dep-a",
            headers=_auth_header_for_email(["dxcp-delivery-owners"], "nonmember@example.com"),
        )
        member = await client.get(
            "/v1/deployments/dep-a",
            headers=_auth_header_for_email(["dxcp-delivery-owners"], "owner@example.com"),
        )
        admin = await client.get("/v1/deployments/dep-a", headers=auth_header(["dxcp-platform-admins"]))

    assert non_member.status_code == 403
    assert non_member.json()["code"] == "DELIVERY_GROUP_SCOPE_REQUIRED"
    assert member.status_code == 200
    assert admin.status_code == 200


async def test_owner_in_scope_allowed_get_deployment_status(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, main, _):
        default = main.storage.get_delivery_group("default")
        assert default is not None
        default["owner"] = "owner@example.com"
        main.storage.update_delivery_group(default)
        _insert_deployment(main.storage, "dep-a", "1.0.0", "2024-01-01T00:00:00Z")

        owner = await client.get(
            "/v1/deployments/dep-a",
            headers=_auth_header_for_email(["dxcp-delivery-owners"], "owner@example.com"),
        )

    assert owner.status_code == 200


async def test_observer_allowed_get_deployment_status(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, main, _):
        default = main.storage.get_delivery_group("default")
        assert default is not None
        default["owner"] = "owner@example.com"
        main.storage.update_delivery_group(default)
        _insert_deployment(main.storage, "dep-a", "1.0.0", "2024-01-01T00:00:00Z")

        observer = await client.get("/v1/deployments/dep-a", headers=auth_header(["dxcp-observers"]))

    assert observer.status_code == 200


async def test_observer_allowed_read_only_endpoints(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, main, _):
        default = main.storage.get_delivery_group("default")
        assert default is not None
        default["owner"] = "owner@example.com"
        main.storage.update_delivery_group(default)
        _insert_deployment(main.storage, "dep-a", "1.0.0", "2024-01-01T00:00:00Z")

        deployments = await client.get("/v1/deployments", headers=auth_header(["dxcp-observers"]))
        delivery_status = await client.get(
            "/v1/services/demo-service/delivery-status?environment=sandbox",
            headers=auth_header(["dxcp-observers"]),
        )

    assert deployments.status_code == 200
    assert delivery_status.status_code == 200


async def test_non_member_owner_denied_get_deployment_details_endpoints(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, main, _):
        default = main.storage.get_delivery_group("default")
        assert default is not None
        default["owner"] = "owner@example.com"
        main.storage.update_delivery_group(default)
        _insert_deployment(main.storage, "dep-a", "1.0.0", "2024-01-01T00:00:00Z")

        failures = await client.get(
            "/v1/deployments/dep-a/failures",
            headers=_auth_header_for_email(["dxcp-delivery-owners"], "nonmember@example.com"),
        )
        timeline = await client.get(
            "/v1/deployments/dep-a/timeline",
            headers=_auth_header_for_email(["dxcp-delivery-owners"], "nonmember@example.com"),
        )

    assert failures.status_code == 403
    assert failures.json()["code"] == "DELIVERY_GROUP_SCOPE_REQUIRED"
    assert timeline.status_code == 403
    assert timeline.json()["code"] == "DELIVERY_GROUP_SCOPE_REQUIRED"


async def test_platform_admin_denied_build_register_when_not_ci(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, _, _):
        cap_request = {
            "service": "demo-service",
            "version": "1.0.0",
            "expectedSizeBytes": 1024,
            "expectedSha256": "a" * 64,
            "contentType": "application/zip",
        }
        cap_response = await client.post(
            "/v1/builds/upload-capability",
            headers={"Idempotency-Key": "cap-1", **auth_header(["dxcp-platform-admins"])},
            json=cap_request,
        )
        response = await client.post(
            "/v1/builds",
            headers={"Idempotency-Key": "build-2", **auth_header(["dxcp-platform-admins"])},
            json=_build_payload(),
        )
        existing_response = await client.post(
            "/v1/builds/register",
            headers={"Idempotency-Key": "build-register-existing-2", **auth_header(["dxcp-platform-admins"])},
            json=_build_register_existing_payload(),
        )
    assert cap_response.status_code == 403
    assert cap_response.json()["code"] == "CI_ONLY"
    assert response.status_code == 403
    assert response.json()["code"] == "CI_ONLY"
    assert existing_response.status_code == 403
    assert existing_response.json()["code"] == "CI_ONLY"


async def test_ci_publisher_can_register_build_without_admin_role(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, _, _):
        cap_request = {
            "service": "demo-service",
            "version": "1.0.1",
            "expectedSizeBytes": 1024,
            "expectedSha256": "a" * 64,
            "contentType": "application/zip",
        }
        cap_response = await client.post(
            "/v1/builds/upload-capability",
            headers={"Idempotency-Key": "cap-ci-1", **auth_header_for_subject(["dxcp-ci-publishers"], "ci-publisher-1")},
            json=cap_request,
        )
        response = await client.post(
            "/v1/builds",
            headers={"Idempotency-Key": "build-ci-1", **auth_header_for_subject(["dxcp-ci-publishers"], "ci-publisher-1")},
            json=_build_payload("1.0.1"),
        )
    assert cap_response.status_code == 201
    assert response.status_code == 201
    assert response.json()["ci_publisher"] == "ci-publisher-1"


async def test_ci_publisher_object_rules_match_subject(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, main, _):
        main.SETTINGS.ci_publishers = [
            {
                "name": "github-ci",
                "provider": "github",
                "issuers": ["https://dxcp.example/"],
                "audiences": ["https://dxcp-api"],
                "subjects": ["repo-ci-bot"],
            }
        ]
        cap_request = {
            "service": "demo-service",
            "version": "1.0.2",
            "expectedSizeBytes": 1024,
            "expectedSha256": "a" * 64,
            "contentType": "application/zip",
        }
        allowed = await client.post(
            "/v1/builds/upload-capability",
            headers={"Idempotency-Key": "cap-ci-obj-1", **auth_header_for_subject(["dxcp-ci-publishers"], "repo-ci-bot")},
            json=cap_request,
        )
        denied = await client.post(
            "/v1/builds/upload-capability",
            headers={"Idempotency-Key": "cap-ci-obj-2", **auth_header_for_subject(["dxcp-ci-publishers"], "someone-else")},
            json=cap_request,
        )
    assert allowed.status_code == 201
    assert denied.status_code == 403
    assert denied.json()["code"] == "CI_ONLY"


async def test_ci_role_without_allowlist_match_denied(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, _, _):
        cap_request = {
            "service": "demo-service",
            "version": "1.0.3",
            "expectedSizeBytes": 1024,
            "expectedSha256": "a" * 64,
            "contentType": "application/zip",
        }
        response = await client.post(
            "/v1/builds/upload-capability",
            headers={"Idempotency-Key": "cap-ci-obj-3", **auth_header_for_subject(["dxcp-ci-publishers"], "not-allowlisted")},
            json=cap_request,
        )
    assert response.status_code == 403
    assert response.json()["code"] == "CI_ONLY"


async def test_ci_role_without_allowlist_match_denied_for_build_register(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, _, _):
        response = await client.post(
            "/v1/builds/register",
            headers={"Idempotency-Key": "build-register-existing-ci-allowlist-miss", **auth_header_for_subject(["dxcp-ci-publishers"], "not-allowlisted")},
            json=_build_register_existing_payload(),
        )
    assert response.status_code == 403
    assert response.json()["code"] == "CI_ONLY"
