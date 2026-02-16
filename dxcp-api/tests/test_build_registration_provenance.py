import json
import os
import sys
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

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


def _build_payload(artifact_ref: str, git_sha: str = "f" * 40) -> dict:
    return {
        "service": "demo-service",
        "version": "1.0.0",
        "artifactRef": artifact_ref,
        "git_sha": git_sha,
        "git_branch": "main",
        "ci_provider": "github_actions",
        "ci_run_id": "run-123",
        "built_at": "2026-02-16T12:00:00Z",
        "sha256": "a" * 64,
        "sizeBytes": 1024,
        "contentType": "application/zip",
    }


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
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=main.app),
        base_url="http://testserver",
    ) as client:
        yield client, main


def _insert_upload_capability(main) -> None:
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


async def test_build_registration_missing_required_fields_returns_400(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, _):
        response = await client.post(
            "/v1/builds",
            headers={"Idempotency-Key": "build-missing-1", **auth_header_for_subject(["dxcp-observers"], "ci-publisher-1")},
            json={
                "service": "demo-service",
                "version": "1.0.0",
                "artifactRef": "s3://dxcp-test-bucket/demo-service-1.0.0.zip",
                "sha256": "a" * 64,
                "sizeBytes": 1024,
                "contentType": "application/zip",
            },
        )

    assert response.status_code == 400
    body = response.json()
    assert body["code"] == "INVALID_BUILD_REGISTRATION"
    assert "git_sha" in body["details"]["missing_fields"]


async def test_build_registration_idempotent_reregister_returns_existing(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, main):
        _insert_upload_capability(main)
        payload = _build_payload("s3://dxcp-test-bucket/demo-service-1.0.0.zip")
        first = await client.post(
            "/v1/builds",
            headers={"Idempotency-Key": "build-idem-1", **auth_header_for_subject(["dxcp-observers"], "ci-publisher-1")},
            json=payload,
        )
        second = await client.post(
            "/v1/builds",
            headers={"Idempotency-Key": "build-idem-2", **auth_header_for_subject(["dxcp-observers"], "ci-publisher-1")},
            json=payload,
        )

    assert first.status_code == 201
    assert second.status_code == 200
    assert second.json()["id"] == first.json()["id"]


async def test_build_registration_conflicting_reregister_returns_409(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, main):
        _insert_upload_capability(main)
        first = await client.post(
            "/v1/builds",
            headers={"Idempotency-Key": "build-conflict-1", **auth_header_for_subject(["dxcp-observers"], "ci-publisher-1")},
            json=_build_payload("s3://dxcp-test-bucket/demo-service-1.0.0.zip", git_sha="a" * 40),
        )
        second = await client.post(
            "/v1/builds",
            headers={"Idempotency-Key": "build-conflict-2", **auth_header_for_subject(["dxcp-observers"], "ci-publisher-1")},
            json=_build_payload("s3://dxcp-test-bucket/demo-service-1.0.0-hotfix.zip", git_sha="b" * 40),
        )

    assert first.status_code == 201
    assert second.status_code == 409
    assert second.json()["code"] == "BUILD_REGISTRATION_CONFLICT"
