import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
import pytest
from auth_utils import auth_header, configure_auth_env, mock_jwks


def _load_main(tmp_path: Path):
    dxcp_api_dir = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(dxcp_api_dir))
    os.environ["DXCP_DB_PATH"] = str(tmp_path / "dxcp-test.db")
    os.environ["DXCP_SERVICE_REGISTRY_PATH"] = str(tmp_path / "services.json")
    configure_auth_env()
    (tmp_path / "services.json").write_text("[]", encoding="utf-8")

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
    main.storage = main.build_storage()
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=main.app),
        base_url="http://testserver",
    ) as client:
        yield client, main


async def test_admin_guardrail_preview_warning(tmp_path: Path, monkeypatch):
    async with _client(tmp_path, monkeypatch) as (client, _):
        response = await client.post(
            "/v1/admin/guardrails/validate",
            headers=auth_header(["dxcp-platform-admins"]),
            json={"id": "preview", "name": "Preview Group", "services": [], "allowed_recipes": []},
        )
    assert response.status_code == 200
    payload = response.json()
    assert payload["validation_status"] == "WARNING"
    assert any(item["field"] == "services" for item in payload["messages"])


async def test_admin_guardrail_preview_does_not_persist(tmp_path: Path, monkeypatch):
    async with _client(tmp_path, monkeypatch) as (client, main):
        response = await client.post(
            "/v1/admin/guardrails/validate",
            headers=auth_header(["dxcp-platform-admins"]),
            json={"id": "preview", "name": "Preview Group", "services": [], "allowed_recipes": []},
        )
        assert response.status_code == 200
        assert main.storage.get_delivery_group("preview") is None


async def test_non_admin_guardrail_preview_forbidden(tmp_path: Path, monkeypatch):
    async with _client(tmp_path, monkeypatch) as (client, _):
        response = await client.post(
            "/v1/admin/guardrails/validate",
            headers=auth_header(["dxcp-observers"]),
            json={"id": "preview", "name": "Preview Group"},
        )
    assert response.status_code == 403


async def test_recipe_preview_warning(tmp_path: Path, monkeypatch):
    async with _client(tmp_path, monkeypatch) as (client, _):
        response = await client.post(
            "/v1/admin/guardrails/validate",
            headers=auth_header(["dxcp-platform-admins"]),
            json={"id": "recipe-preview", "name": "Recipe Preview"},
        )
    assert response.status_code == 200
    payload = response.json()
    assert payload["validation_status"] == "ERROR"
    assert any(item["field"] == "deploy_pipeline" for item in payload["messages"])
