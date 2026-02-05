import json
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
import pytest
from auth_utils import auth_header, configure_auth_env, mock_jwks


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
    os.environ["DXCP_UI_DEFAULT_REFRESH_SECONDS"] = "300"
    os.environ["DXCP_UI_MIN_REFRESH_SECONDS"] = "60"
    os.environ["DXCP_UI_MAX_REFRESH_SECONDS"] = "3600"
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
async def _client(tmp_path: Path, monkeypatch):
    main = _load_main(tmp_path)
    mock_jwks(monkeypatch)
    main.idempotency = main.IdempotencyStore()
    main.rate_limiter = main.RateLimiter()
    main.storage = main.build_storage()
    main.guardrails = main.Guardrails(main.storage)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=main.app),
        base_url="http://testserver",
    ) as client:
        yield client


async def test_public_settings_returns_defaults(tmp_path: Path, monkeypatch):
    async with _client(tmp_path, monkeypatch) as client:
        response = await client.get("/v1/settings/public", headers=auth_header(["dxcp-observers"]))
    assert response.status_code == 200
    payload = response.json()
    assert payload["default_refresh_interval_seconds"] == 300
    assert payload["min_refresh_interval_seconds"] == 60
    assert payload["max_refresh_interval_seconds"] == 3600


async def test_admin_settings_denied_for_non_admin(tmp_path: Path, monkeypatch):
    async with _client(tmp_path, monkeypatch) as client:
        response = await client.get("/v1/settings/admin", headers=auth_header(["dxcp-observers"]))
    assert response.status_code == 403
    assert response.json()["code"] == "ROLE_FORBIDDEN"
