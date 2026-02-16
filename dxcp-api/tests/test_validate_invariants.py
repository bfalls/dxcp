import json
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
import pytest
from auth_utils import auth_header, configure_auth_env, mock_jwks
from botocore.exceptions import ClientError, NoCredentialsError


from test_helpers import seed_defaults

pytestmark = pytest.mark.anyio


def _write_service_registry(path: Path) -> None:
    data = [
        {
            "service_name": "payments",
            "allowed_environments": ["sandbox"],
            "allowed_recipes": ["standard"],
            "allowed_artifact_sources": ["s3://dxcp-test-bucket/"],
        },
        {
            "service_name": "billing",
            "allowed_environments": ["sandbox"],
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
            "description": "Default recipe for validation tests",
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
            "description": "Group for validation invariants",
            "owner": None,
            "services": ["payments", "billing"],
            "allowed_recipes": ["standard"],
            "allowed_environments": ["sandbox"],
            "guardrails": {
                "max_concurrent_deployments": 2,
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


def _assert_error_schema(payload: dict) -> None:
    assert payload.get("code")
    assert payload.get("error_code") == payload.get("code")
    assert isinstance(payload.get("message"), str)
    assert payload.get("request_id")
    if "operator_hint" in payload:
        assert isinstance(payload.get("operator_hint"), str)


class _FakeS3Client:
    def __init__(self, behavior: str):
        self.behavior = behavior
        self.calls = []

    def head_object(self, Bucket: str, Key: str):
        self.calls.append((Bucket, Key))
        if self.behavior == "found":
            return {"ResponseMetadata": {"HTTPStatusCode": 200}}
        if self.behavior == "not_found":
            raise ClientError(
                {
                    "Error": {"Code": "NoSuchKey", "Message": "missing"},
                    "ResponseMetadata": {"HTTPStatusCode": 404},
                },
                "HeadObject",
            )
        if self.behavior == "no_credentials":
            raise NoCredentialsError()
        raise RuntimeError("unexpected behavior")


class _FakeBoto3:
    def __init__(self, client):
        self._client = client

    def client(self, service_name: str, config=None):
        assert service_name == "s3"
        return self._client


async def test_validate_returns_contract_fields(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, _):
        response = await client.post(
            "/v1/deployments/validate",
            headers=auth_header(["dxcp-platform-admins"]),
            json=_deploy_payload(),
        )
    assert response.status_code == 200
    body = response.json()
    assert body["service"] == "payments"
    assert body["environment"] == "sandbox"
    assert body["version"] == "1.2.3"
    assert body["recipeId"] == "standard"
    assert body["deliveryGroupId"] == "group-1"
    assert body["versionRegistered"] is True
    assert body["validatedAt"]

    policy = body["policy"]
    assert policy["max_concurrent_deployments"] == 2
    assert policy["current_concurrent_deployments"] == 0
    assert policy["daily_deploy_quota"] == 5
    assert policy["deployments_used"] == 0
    assert policy["deployments_remaining"] == 5


async def test_validate_preflight_artifact_found_passes(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, main):
        fake_client = _FakeS3Client("found")
        monkeypatch.setattr(main, "boto3", _FakeBoto3(fake_client))
        response = await client.post(
            "/v1/deployments/validate",
            headers=auth_header(["dxcp-platform-admins"]),
            json=_deploy_payload(),
        )
    assert response.status_code == 200
    assert fake_client.calls == [("dxcp-test-bucket", "payments-1.2.3.zip")]


async def test_validate_preflight_artifact_missing_returns_artifact_not_found(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, main):
        fake_client = _FakeS3Client("not_found")
        monkeypatch.setattr(main, "boto3", _FakeBoto3(fake_client))
        response = await client.post(
            "/v1/deployments/validate",
            headers=auth_header(["dxcp-platform-admins"]),
            json=_deploy_payload(),
        )
    assert response.status_code == 409
    body = response.json()
    assert body["code"] == "ARTIFACT_NOT_FOUND"
    assert body["failure_cause"] == "POLICY_CHANGE"
    assert (
        body["message"]
        == "Artifact is no longer available in the artifact store. Rebuild and publish again, then deploy the new version."
    )
    _assert_error_schema(body)


async def test_validate_preflight_no_credentials_skips_check(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, main):
        fake_client = _FakeS3Client("no_credentials")
        monkeypatch.setattr(main, "boto3", _FakeBoto3(fake_client))
        response = await client.post(
            "/v1/deployments/validate",
            headers=auth_header(["dxcp-platform-admins"]),
            json=_deploy_payload(),
        )
    assert response.status_code == 200
    assert fake_client.calls == [("dxcp-test-bucket", "payments-1.2.3.zip")]


async def test_validate_missing_recipe_id_returns_error_schema(tmp_path: Path, monkeypatch):
    payload = _deploy_payload()
    payload.pop("recipeId")
    async with _client_and_state(tmp_path, monkeypatch) as (client, _):
        response = await client.post(
            "/v1/deployments/validate",
            headers=auth_header(["dxcp-platform-admins"]),
            json=payload,
        )
    assert response.status_code == 400
    body = response.json()
    assert body["code"] == "RECIPE_ID_REQUIRED"
    assert body["failure_cause"] == "USER_ERROR"
    _assert_error_schema(body)


async def test_validate_missing_change_summary_returns_error_schema(tmp_path: Path, monkeypatch):
    payload = _deploy_payload()
    payload.pop("changeSummary")
    async with _client_and_state(tmp_path, monkeypatch) as (client, _):
        response = await client.post(
            "/v1/deployments/validate",
            headers=auth_header(["dxcp-platform-admins"]),
            json=payload,
        )
    assert response.status_code == 400
    body = response.json()
    assert body["code"] == "INVALID_REQUEST"
    assert body["failure_cause"] == "USER_ERROR"
    _assert_error_schema(body)


@pytest.mark.parametrize("change_summary", ["", "   "])
async def test_validate_allows_blank_change_summary(tmp_path: Path, monkeypatch, change_summary: str):
    payload = _deploy_payload(change_summary=change_summary)
    async with _client_and_state(tmp_path, monkeypatch) as (client, _):
        response = await client.post(
            "/v1/deployments/validate",
            headers=auth_header(["dxcp-platform-admins"]),
            json=payload,
        )
    assert response.status_code == 200
    body = response.json()
    assert body["service"] == "payments"
    assert body["versionRegistered"] is True


async def test_validate_incompatible_recipe_explains_rejection(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, _):
        response = await client.post(
            "/v1/deployments/validate",
            headers=auth_header(["dxcp-platform-admins"]),
            json=_deploy_payload(service="billing"),
        )
    assert response.status_code == 400
    body = response.json()
    assert body["code"] == "RECIPE_INCOMPATIBLE"
    assert body["failure_cause"] == "POLICY_CHANGE"
    assert "incompatible" in body["message"].lower()
    _assert_error_schema(body)


async def test_validate_rate_limit_rejects_after_limit(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, main):
        main.SETTINGS.read_rpm = 2

        for _ in range(2):
            ok = await client.post(
                "/v1/deployments/validate",
                headers=auth_header(["dxcp-platform-admins"]),
                json=_deploy_payload(),
            )
            assert ok.status_code == 200

        throttled = await client.post(
            "/v1/deployments/validate",
            headers=auth_header(["dxcp-platform-admins"]),
            json=_deploy_payload(),
        )
    assert throttled.status_code == 429
    body = throttled.json()
    assert body["code"] == "RATE_LIMITED"
    assert body["failure_cause"] == "POLICY_CHANGE"
    _assert_error_schema(body)
