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


def _build_payload(
    artifact_ref: str,
    git_sha: str = "f" * 40,
    commit_url: str | None = None,
    run_url: str | None = None,
) -> dict:
    payload = {
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
    if commit_url is not None:
        payload["commit_url"] = commit_url
    if run_url is not None:
        payload["run_url"] = run_url
    return payload


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
            headers={"Idempotency-Key": "build-missing-1", **auth_header_for_subject(["dxcp-ci-publishers"], "ci-publisher-1")},
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
            headers={"Idempotency-Key": "build-idem-1", **auth_header_for_subject(["dxcp-ci-publishers"], "ci-publisher-1")},
            json=payload,
        )
        second = await client.post(
            "/v1/builds",
            headers={"Idempotency-Key": "build-idem-2", **auth_header_for_subject(["dxcp-ci-publishers"], "ci-publisher-1")},
            json=payload,
        )

    assert first.status_code == 201
    assert first.json()["ci_publisher"] == "ci-publisher-1"
    assert second.status_code == 200
    assert second.json()["id"] == first.json()["id"]
    assert second.json()["ci_publisher"] == "ci-publisher-1"


async def test_build_registration_idempotency_replayed_header(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, main):
        _insert_upload_capability(main)
        payload = _build_payload("s3://dxcp-test-bucket/demo-service-1.0.0.zip")
        first = await client.post(
            "/v1/builds",
            headers={"Idempotency-Key": "build-replay-1", **auth_header_for_subject(["dxcp-ci-publishers"], "ci-publisher-1")},
            json=payload,
        )
        second = await client.post(
            "/v1/builds",
            headers={"Idempotency-Key": "build-replay-1", **auth_header_for_subject(["dxcp-ci-publishers"], "ci-publisher-1")},
            json=payload,
        )

    assert first.status_code == 201
    assert first.headers["Idempotency-Replayed"] == "false"
    assert second.status_code == 201
    assert second.headers["Idempotency-Replayed"] == "true"


async def test_build_registration_conflicting_reregister_returns_409(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, main):
        _insert_upload_capability(main)
        first = await client.post(
            "/v1/builds",
            headers={"Idempotency-Key": "build-conflict-1", **auth_header_for_subject(["dxcp-ci-publishers"], "ci-publisher-1")},
            json=_build_payload("s3://dxcp-test-bucket/demo-service-1.0.0.zip", git_sha="a" * 40),
        )
        second = await client.post(
            "/v1/builds",
            headers={"Idempotency-Key": "build-conflict-2", **auth_header_for_subject(["dxcp-ci-publishers"], "ci-publisher-1")},
            json=_build_payload("s3://dxcp-test-bucket/demo-service-1.0.0-hotfix.zip", git_sha="b" * 40),
        )

    assert first.status_code == 201
    assert second.status_code == 409
    assert second.json()["code"] == "BUILD_REGISTRATION_CONFLICT"


async def test_get_build_returns_registered_record_with_ci_publisher(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, main):
        _insert_upload_capability(main)
        register_response = await client.post(
            "/v1/builds",
            headers={"Idempotency-Key": "build-read-1", **auth_header_for_subject(["dxcp-ci-publishers"], "ci-publisher-1")},
            json=_build_payload("s3://dxcp-test-bucket/demo-service-1.0.0.zip"),
        )
        read_response = await client.get(
            "/v1/builds",
            params={"service": "demo-service", "version": "1.0.0"},
            headers=auth_header_for_subject(["dxcp-observers"], "observer-1"),
        )

    assert register_response.status_code == 201
    assert read_response.status_code == 200
    assert read_response.json() == register_response.json()
    assert read_response.json()["ci_publisher"] == "ci-publisher-1"


async def test_get_build_unknown_service_version_returns_404(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, _):
        response = await client.get(
            "/v1/builds",
            params={"service": "demo-service", "version": "9.9.9"},
            headers=auth_header_for_subject(["dxcp-observers"], "observer-1"),
        )

    assert response.status_code == 404
    assert response.json()["code"] == "NOT_FOUND"


async def test_get_build_missing_query_params_returns_400(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, _):
        response = await client.get(
            "/v1/builds",
            params={"service": "demo-service"},
            headers=auth_header_for_subject(["dxcp-observers"], "observer-1"),
        )

    assert response.status_code == 400
    body = response.json()
    assert body["code"] == "INVALID_REQUEST"
    assert body["message"] == "service and version are required"


async def test_build_registration_rejects_invalid_commit_url(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, main):
        monkeypatch.setattr(
            main,
            "read_ui_exposure_policy",
            lambda: {"artifactRef": {"display": False}, "externalLinks": {"display": True}},
        )
        _insert_upload_capability(main)
        response = await client.post(
            "/v1/builds",
            headers={"Idempotency-Key": "build-invalid-url-1", **auth_header_for_subject(["dxcp-ci-publishers"], "ci-publisher-1")},
            json=_build_payload(
                "s3://dxcp-test-bucket/demo-service-1.0.0.zip",
                commit_url="ftp://github.com/org/repo/commit/abc",
            ),
        )

    assert response.status_code == 400
    body = response.json()
    assert body["code"] == "INVALID_URL"
    assert "commit_url" in body["message"]


async def test_build_registration_persists_urls_and_hides_them_when_policy_off(tmp_path: Path, monkeypatch):
    commit_url = "https://github.com/example/repo/commit/abc123"
    run_url = "https://github.com/example/repo/actions/runs/123"
    async with _client_and_state(tmp_path, monkeypatch) as (client, main):
        monkeypatch.setattr(
            main,
            "read_ui_exposure_policy",
            lambda: {"artifactRef": {"display": False}, "externalLinks": {"display": False}},
        )
        _insert_upload_capability(main)
        register_response = await client.post(
            "/v1/builds",
            headers={"Idempotency-Key": "build-url-policy-off-1", **auth_header_for_subject(["dxcp-ci-publishers"], "ci-publisher-1")},
            json=_build_payload(
                "s3://dxcp-test-bucket/demo-service-1.0.0.zip",
                commit_url=commit_url,
                run_url=run_url,
            ),
        )
        stored = main.storage.find_latest_build("demo-service", "1.0.0")

    assert register_response.status_code == 201
    body = register_response.json()
    assert body["commit_url"] is None
    assert body["run_url"] is None
    assert stored is not None
    assert stored["commit_url"] == commit_url
    assert stored["run_url"] == run_url


async def test_build_registration_exposes_urls_when_policy_on(tmp_path: Path, monkeypatch):
    commit_url = "https://github.com/example/repo/commit/def456"
    run_url = "https://github.com/example/repo/actions/runs/456"
    async with _client_and_state(tmp_path, monkeypatch) as (client, main):
        monkeypatch.setattr(
            main,
            "read_ui_exposure_policy",
            lambda: {"artifactRef": {"display": False}, "externalLinks": {"display": True}},
        )
        _insert_upload_capability(main)
        register_response = await client.post(
            "/v1/builds",
            headers={"Idempotency-Key": "build-url-policy-on-1", **auth_header_for_subject(["dxcp-ci-publishers"], "ci-publisher-1")},
            json=_build_payload(
                "s3://dxcp-test-bucket/demo-service-1.0.0.zip",
                commit_url=commit_url,
                run_url=run_url,
            ),
        )
        read_response = await client.get(
            "/v1/builds",
            params={"service": "demo-service", "version": "1.0.0"},
            headers=auth_header_for_subject(["dxcp-observers"], "observer-1"),
        )

    assert register_response.status_code == 201
    assert register_response.json()["commit_url"] == commit_url
    assert register_response.json()["run_url"] == run_url
    assert read_response.status_code == 200
    assert read_response.json()["commit_url"] == commit_url
    assert read_response.json()["run_url"] == run_url
