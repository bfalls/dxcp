from __future__ import annotations

import importlib.util
import sys
from pathlib import Path


MODULE_PATH = Path(__file__).resolve().parents[2] / "scripts" / "ci" / "register_build.py"
SPEC = importlib.util.spec_from_file_location("register_build_helper", MODULE_PATH)
assert SPEC and SPEC.loader
register_build_helper = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = register_build_helper
SPEC.loader.exec_module(register_build_helper)


def test_normalize_dxcp_api_base_appends_v1() -> None:
    assert (
        register_build_helper.normalize_dxcp_api_base("https://example.com")
        == "https://example.com/v1"
    )
    assert (
        register_build_helper.normalize_dxcp_api_base("https://example.com/v1/")
        == "https://example.com/v1"
    )


def test_default_idempotency_key_for_github() -> None:
    key = register_build_helper.default_idempotency_key(
        explicit=None,
        ci_provider="github",
        ci_run_id="12345",
        service="demo-service",
        version="1.2.3",
    )
    assert key == "github-12345-demo-service-1.2.3"


def test_register_build_retries_without_commit_run_urls_on_invalid_request(monkeypatch) -> None:
    calls: list[dict] = []

    def fake_request_json(*, method, url, payload=None, headers=None):  # type: ignore[no-untyped-def]
        calls.append({"method": method, "url": url, "payload": payload, "headers": headers})
        if len(calls) == 1:
            return 400, {}, '{"code":"INVALID_REQUEST"}', {"code": "INVALID_REQUEST"}
        return 201, {"Idempotency-Replayed": "false"}, '{"ci_publisher":"publisher"}', {"ci_publisher": "publisher"}

    monkeypatch.setattr(register_build_helper, "_request_json", fake_request_json)

    status, response_headers, response_payload, metadata_mode = register_build_helper._register_build(
        dxcp_api_base="https://dxcp.example.com/v1",
        token="token",
        idempotency_key="github-1-demo-service-1.2.3",
        payload={
            "service": "demo-service",
            "version": "1.2.3",
            "artifactRef": "s3://bucket/demo-service/demo-service-1.2.3.zip",
            "git_sha": "abc",
            "git_branch": "main",
            "ci_provider": "github",
            "ci_run_id": "1",
            "built_at": "2026-01-01T00:00:00Z",
            "commit_url": "https://example.com/commit/abc",
            "run_url": "https://example.com/run/1",
        },
        metadata_fallback_mode="auto",
    )

    assert status == 201
    assert response_headers.get("Idempotency-Replayed") == "false"
    assert response_payload.get("ci_publisher") == "publisher"
    assert metadata_mode == "without_metadata"
    assert len(calls) == 2
    assert "commit_url" in calls[0]["payload"]
    assert "run_url" in calls[0]["payload"]
    assert "commit_url" not in calls[1]["payload"]
    assert "run_url" not in calls[1]["payload"]
