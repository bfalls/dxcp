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
    configure_auth_env()
    _write_service_registry(Path(os.environ["DXCP_SERVICE_REGISTRY_PATH"]))

    for module in ["main", "config", "storage", "policy", "idempotency", "rate_limit", "observability"]:
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
        yield client, main


async def test_request_id_is_added_when_missing(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, _):
        response = await client.get("/v1/recipes")
    assert response.status_code == 401
    assert response.headers.get("X-Request-Id")
    body = response.json()
    assert body.get("request_id") == response.headers.get("X-Request-Id")


async def test_request_id_echoes_when_provided(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, _):
        response = await client.get("/v1/recipes", headers={"X-Request-Id": "req-123"})
    assert response.status_code == 401
    assert response.headers.get("X-Request-Id") == "req-123"
    body = response.json()
    assert body.get("request_id") == "req-123"


async def test_deploy_submit_logs_event(tmp_path: Path, monkeypatch, caplog):
    caplog.set_level("INFO")
    async with _client_and_state(tmp_path, monkeypatch) as (client, _):
        response = await client.post(
            "/v1/deployments",
            headers={"Idempotency-Key": "deploy-1", **auth_header(["dxcp-platform-admins"])},
            json={
                "service": "demo-service",
                "environment": "sandbox",
                "version": "1.0.0",
                "changeSummary": "test",
                "recipeId": "default",
            },
        )
    assert response.status_code == 201
    combined = "\n".join([record.message for record in caplog.records])
    assert "event=deploy_intent_submitted" in combined
