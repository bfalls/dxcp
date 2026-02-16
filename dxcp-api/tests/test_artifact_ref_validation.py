import json
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from auth_utils import auth_header_for_subject, configure_auth_env, mock_jwks


from test_helpers import seed_defaults

pytestmark = pytest.mark.anyio


class FakeSpinnaker:
    def __init__(self) -> None:
        self.mode = "lambda"


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


def _build_payload(artifact_ref: str) -> dict:
    return {
        "service": "demo-service",
        "version": "1.0.0",
        "artifactRef": artifact_ref,
        "git_sha": "f" * 40,
        "git_branch": "main",
        "ci_provider": "github_actions",
        "ci_run_id": "run-1",
        "built_at": "2026-02-16T00:00:00Z",
        "sha256": "a" * 64,
        "sizeBytes": 1024,
        "contentType": "application/zip",
    }


def _load_main(tmp_path: Path):
    dxcp_api_dir = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(dxcp_api_dir))
    os.environ["DXCP_DB_PATH"] = str(tmp_path / "dxcp-test.db")
    os.environ["DXCP_SERVICE_REGISTRY_PATH"] = str(tmp_path / "services.json")
    os.environ["DXCP_CI_PUBLISHERS"] = "ci-publisher-1"
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
    expires_at = (datetime.now(timezone.utc) + timedelta(minutes=15)).isoformat().replace("+00:00", "Z")
    main.storage.insert_upload_capability(
        "demo-service",
        "1.0.0",
        1024,
        "a" * 64,
        "application/zip",
        expires_at,
        "token-1",
    )
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=main.app),
        base_url="http://testserver",
    ) as client:
        yield client, main


async def test_s3_artifact_ref_accepted(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, _):
        response = await client.post(
            "/v1/builds",
            headers={"Idempotency-Key": "build-1", **auth_header_for_subject(["dxcp-observers"], "ci-publisher-1")},
            json=_build_payload("s3://dxcp-test-bucket/demo-service-1.0.0.zip"),
        )
    assert response.status_code == 201
    assert response.json()["artifactRef"].startswith("s3://")


async def test_non_s3_artifact_ref_rejected(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, _):
        response = await client.post(
            "/v1/builds",
            headers={"Idempotency-Key": "build-2", **auth_header_for_subject(["dxcp-observers"], "ci-publisher-1")},
            json=_build_payload("gcs://dxcp-test-bucket/demo-service-1.0.0.zip"),
        )
    body = response.json()
    assert response.status_code == 400
    assert body["code"] == "INVALID_ARTIFACT"


async def test_malformed_artifact_ref_rejected(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, _):
        response = await client.post(
            "/v1/builds",
            headers={"Idempotency-Key": "build-3", **auth_header_for_subject(["dxcp-observers"], "ci-publisher-1")},
            json=_build_payload("s3:/dxcp-test-bucket/demo-service-1.0.0.zip"),
        )
    body = response.json()
    assert response.status_code == 400
    assert body["code"] == "INVALID_ARTIFACT"
    assert "artifactRef" in body["message"]
