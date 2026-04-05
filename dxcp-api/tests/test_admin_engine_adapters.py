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


class _FakeSSMClient:
    def __init__(self, store: dict[str, str]) -> None:
        self.store = store

    def get_parameter(self, Name: str, WithDecryption: bool = True) -> dict:
        if Name not in self.store:
            raise RuntimeError(f"Missing SSM parameter: {Name}")
        return {"Parameter": {"Value": self.store[Name]}}

    def put_parameter(self, Name: str, Value: str, Type: str = "String", Overwrite: bool = True) -> dict:
        self.store[Name] = Value
        return {}

    def delete_parameter(self, Name: str) -> dict:
        self.store.pop(Name, None)
        return {}


class _FakeBoto3:
    def __init__(self, store: dict[str, str]) -> None:
        self.client_impl = _FakeSSMClient(store)

    def client(self, service_name: str, **_kwargs):
        if service_name != "ssm":
            raise RuntimeError(f"Unexpected boto3 client request: {service_name}")
        return self.client_impl


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
    os.environ["DXCP_SPINNAKER_MODE"] = "http"
    os.environ["DXCP_SPINNAKER_GATE_URL"] = "https://gate.example.test"
    os.environ["DXCP_SPINNAKER_GATE_HEADER_NAME"] = "X-Gate-Token"
    os.environ["DXCP_SPINNAKER_GATE_HEADER_VALUE"] = "super-secret-header"
    os.environ["DXCP_SPINNAKER_AUTH0_DOMAIN"] = "tenant.example.test"
    os.environ["DXCP_SPINNAKER_AUTH0_CLIENT_ID"] = "client-123"
    os.environ["DXCP_SPINNAKER_AUTH0_CLIENT_SECRET"] = "client-secret"
    os.environ["DXCP_SPINNAKER_AUTH0_AUDIENCE"] = "https://gate.example.test/api"
    os.environ["DXCP_SPINNAKER_AUTH0_SCOPE"] = "openid profile"
    os.environ["DXCP_SPINNAKER_AUTH0_REFRESH_SKEW_SECONDS"] = "90"
    os.environ["DXCP_ENGINE_LAMBDA_URL"] = "https://lambda.example.test"
    os.environ["DXCP_ENGINE_LAMBDA_TOKEN"] = "lambda-secret"
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
    main.idempotency = main.IdempotencyStore()
    main.rate_limiter = main.RateLimiter()
    main.storage = main.build_storage()
    seed_defaults(main.storage)
    main.guardrails = main.Guardrails(main.storage)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=main.app),
        base_url="http://testserver",
    ) as client:
        yield client, main


async def test_engine_adapter_settings_load_current_runtime_config(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, _):
        response = await client.get(
            "/v1/admin/system/engine-adapters/main",
            headers=auth_header(["dxcp-platform-admins"]),
        )

    assert response.status_code == 200
    body = response.json()
    assert body["adapter_id"] == "main"
    assert body["engine_type"] == "SPINNAKER"
    assert body["config"]["mode"] == "http"
    assert body["config"]["gate_url"] == "https://gate.example.test"
    assert body["config"]["gate_header_name"] == "X-Gate-Token"
    assert body["config"]["gate_header_value_configured"] is True
    assert body["config"]["auth0_client_secret_configured"] is True
    assert body["config"]["engine_lambda_token_configured"] is True
    assert body["source"] == "runtime"


async def test_engine_adapter_settings_forbid_non_admin(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, _):
        response = await client.get(
            "/v1/admin/system/engine-adapters/main",
            headers=auth_header(["dxcp-observers"]),
        )

    assert response.status_code == 403
    assert response.json()["code"] == "ROLE_FORBIDDEN"


async def test_engine_adapter_settings_save_updates_runtime_and_preserves_secret_values(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, main):
        response = await client.put(
            "/v1/admin/system/engine-adapters/main",
            headers=auth_header(["dxcp-platform-admins"]),
            json={
                "engine_type": "SPINNAKER",
                "config": {
                    "mode": "mtls",
                    "gate_url": "https://mtls-gate.example.test",
                    "gate_header_name": "X-Gate-Token",
                    "auth0_domain": "",
                    "auth0_client_id": "",
                    "auth0_audience": "",
                    "auth0_scope": "",
                    "auth0_refresh_skew_seconds": 30,
                    "mtls_cert_path": "/tmp/client.pem",
                    "mtls_key_path": "/tmp/client-key.pem",
                    "mtls_ca_path": "/tmp/ca.pem",
                    "mtls_server_name": "gate.internal.example.test",
                    "engine_lambda_url": "https://lambda-v2.example.test",
                },
            },
        )

    assert response.status_code == 200
    body = response.json()
    assert body["config"]["mode"] == "mtls"
    assert body["config"]["gate_url"] == "https://mtls-gate.example.test"
    assert body["config"]["gate_header_value_configured"] is True
    assert body["config"]["auth0_client_secret_configured"] is True
    assert body["config"]["engine_lambda_token_configured"] is True
    assert main.SETTINGS.spinnaker_mode == "mtls"
    assert main.SETTINGS.spinnaker_base_url == "https://mtls-gate.example.test"
    assert main.SETTINGS.spinnaker_mtls_server_name == "gate.internal.example.test"
    assert main.SETTINGS.engine_lambda_url == "https://lambda-v2.example.test"
    assert main.SETTINGS.spinnaker_header_value == "super-secret-header"
    assert main.SETTINGS.spinnaker_auth0_client_secret == "client-secret"
    assert main.SETTINGS.engine_lambda_token == "lambda-secret"
    assert main.spinnaker.header_value == "super-secret-header"


async def test_engine_adapter_validation_reports_valid_connection(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, main):
        monkeypatch.setattr(main.SpinnakerAdapter, "check_health", lambda self, **kwargs: {"status": "UP"})
        response = await client.post(
            "/v1/admin/system/engine-adapters/main/validate",
            headers=auth_header(["dxcp-platform-admins"]),
            json={
                "engine_type": "SPINNAKER",
                "config": {
                    "mode": "http",
                    "gate_url": "https://gate.example.test",
                    "auth0_domain": "tenant.example.test",
                    "auth0_client_id": "client-123",
                    "auth0_client_secret": "client-secret",
                    "auth0_audience": "https://gate.example.test/api",
                    "auth0_scope": "openid profile",
                    "auth0_refresh_skew_seconds": 60,
                },
            },
        )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "VALID"
    assert body["errors"] == []


async def test_engine_adapter_validation_uses_configured_secret_when_masked_field_is_left_blank(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, main):
        captured = {}

        def _check_health(self, **kwargs):
            captured["auth0_client_secret"] = self.auth0_client_secret
            return {"status": "UP"}

        monkeypatch.setattr(main.SpinnakerAdapter, "check_health", _check_health)
        response = await client.post(
            "/v1/admin/system/engine-adapters/main/validate",
            headers=auth_header(["dxcp-platform-admins"]),
            json={
                "engine_type": "SPINNAKER",
                "config": {
                    "mode": "http",
                    "gate_url": "https://gate.example.test",
                    "auth0_domain": "tenant.example.test",
                    "auth0_client_id": "client-123",
                    "auth0_client_secret": "",
                    "auth0_audience": "https://gate.example.test/api",
                    "auth0_scope": "openid profile",
                    "auth0_refresh_skew_seconds": 60,
                },
            },
        )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "VALID"
    assert body["errors"] == []
    assert captured["auth0_client_secret"] == "client-secret"


async def test_engine_adapter_validation_omits_mtls_feedback_in_http_mode(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, main):
        monkeypatch.setattr(main.SpinnakerAdapter, "check_health", lambda self, **kwargs: {"status": "UP"})
        response = await client.post(
            "/v1/admin/system/engine-adapters/main/validate",
            headers=auth_header(["dxcp-platform-admins"]),
            json={
                "engine_type": "SPINNAKER",
                "config": {
                    "mode": "http",
                    "gate_url": "https://gate.example.test",
                    "mtls_cert_path": "/tmp/client.pem",
                },
            },
        )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "VALID"
    assert body["warnings"] == []
    assert body["errors"] == []


async def test_engine_adapter_validation_reports_invalid_result_for_mode_specific_errors(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, _):
        response = await client.post(
            "/v1/admin/system/engine-adapters/main/validate",
            headers=auth_header(["dxcp-platform-admins"]),
            json={
                "engine_type": "SPINNAKER",
                "config": {
                    "mode": "mtls",
                    "gate_url": "http://gate.example.test",
                    "mtls_cert_path": "/tmp/client.pem",
                },
            },
        )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "INVALID"
    messages = [item["message"] for item in body["errors"]]
    assert any("https Gate URL" in message for message in messages)
    assert any("client certificate and client key" in message for message in messages)


async def test_engine_adapter_validation_reports_connection_failure(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, main):
        def _boom(self, **kwargs):
            raise RuntimeError("Spinnaker HTTP 503: upstream unavailable")

        monkeypatch.setattr(main.SpinnakerAdapter, "check_health", _boom)
        response = await client.post(
            "/v1/admin/system/engine-adapters/main/validate",
            headers=auth_header(["dxcp-platform-admins"]),
            json={
                "engine_type": "SPINNAKER",
                "config": {
                    "mode": "http",
                    "gate_url": "https://gate.example.test",
                },
            },
        )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "INVALID"
    assert "could not validate" in body["summary"].lower()
    assert any("503" in item["message"] for item in body["errors"])


async def test_engine_adapter_settings_save_clears_blank_ssm_parameters(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, main):
        store = {
            "/dxcp/config/spinnaker/mode": "http",
            "/dxcp/config/spinnaker/gate_url": "https://gate.example.test",
            "/dxcp/config/spinnaker/auth0_domain": "tenant.example.test",
            "/dxcp/config/spinnaker/auth0_client_id": "client-123",
            "/dxcp/config/spinnaker/auth0_audience": "https://gate.example.test/api",
            "/dxcp/config/spinnaker/auth0_scope": "openid profile",
            "/dxcp/config/spinnaker/auth0_client_secret": "client-secret",
            "/dxcp/config/spinnaker/mtls_ca_path": "/tmp/ca.pem",
        }
        main.SETTINGS.ssm_prefix = "/dxcp/config"
        monkeypatch.setattr(main, "boto3", _FakeBoto3(store))

        response = await client.put(
            "/v1/admin/system/engine-adapters/main",
            headers=auth_header(["dxcp-platform-admins"]),
            json={
                "engine_type": "SPINNAKER",
                "config": {
                    "mode": "mtls",
                    "gate_url": "https://mtls-gate.example.test",
                    "auth0_domain": "",
                    "auth0_client_id": "",
                    "auth0_audience": "",
                    "auth0_scope": "",
                    "mtls_cert_path": "/tmp/client.pem",
                    "mtls_key_path": "/tmp/client-key.pem",
                    "mtls_ca_path": "",
                },
            },
        )

    assert response.status_code == 200
    assert store["/dxcp/config/spinnaker/mode"] == "mtls"
    assert store["/dxcp/config/spinnaker/gate_url"] == "https://mtls-gate.example.test"
    assert "/dxcp/config/spinnaker/auth0_domain" not in store
    assert "/dxcp/config/spinnaker/auth0_client_id" not in store
    assert "/dxcp/config/spinnaker/auth0_audience" not in store
    assert "/dxcp/config/spinnaker/auth0_scope" not in store
    assert store["/dxcp/config/spinnaker/auth0_client_secret"] == "client-secret"
    assert "/dxcp/config/spinnaker/mtls_ca_path" not in store


async def test_engine_adapter_settings_read_prefers_ssm_values_over_conflicting_runtime_mode(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, main):
        store = {
            "/dxcp/config/spinnaker/mode": "mtls",
            "/dxcp/config/spinnaker/gate_url": "https://gate.example.test:9443",
            "/dxcp/config/spinnaker/mtls_cert_path": "/var/task/certs/dxcp-client.crt",
            "/dxcp/config/spinnaker/mtls_key_path": "/var/task/certs/dxcp-client.key",
            "/dxcp/config/engine/lambda/url": "https://lambda.example.test",
        }
        main.SETTINGS.ssm_prefix = "/dxcp/config"
        main.SETTINGS.spinnaker_mode = "http"
        monkeypatch.setattr(main, "boto3", _FakeBoto3(store))

        response = await client.get(
            "/v1/admin/system/engine-adapters/main",
            headers=auth_header(["dxcp-platform-admins"]),
        )

    assert response.status_code == 200
    body = response.json()
    assert body["source"] == "ssm"
    assert body["config"]["mode"] == "mtls"
    assert body["config"]["mtls_cert_path"] == "/var/task/certs/dxcp-client.crt"
