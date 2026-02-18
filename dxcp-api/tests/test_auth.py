import json
import os
import sys
from pathlib import Path

import httpx
import pytest

from auth_utils import (
    AUDIENCE,
    ISSUER,
    auth_header,
    build_token,
    configure_auth_env,
    mock_jwks,
)


def _write_service_registry(path: Path) -> None:
    data = [
        {
            "service_name": "demo-service",
            "allowed_environments": ["sandbox"],
            "allowed_recipes": ["default"],
            "allowed_artifact_sources": [],
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

    for module in ["main", "config", "storage", "policy", "idempotency", "rate_limit", "auth"]:
        if module in sys.modules:
            del sys.modules[module]

    import importlib

    main = importlib.import_module("main")
    return main


pytestmark = pytest.mark.anyio


async def test_valid_token_allows_services(tmp_path: Path, monkeypatch):
    main = _load_main(tmp_path)
    mock_jwks(monkeypatch)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=main.app),
        base_url="http://testserver",
    ) as client:
        response = await client.get("/v1/services", headers=auth_header(["dxcp-platform-admins"]))
    assert response.status_code == 200


async def test_delivery_owner_token_allows_services(tmp_path: Path, monkeypatch):
    main = _load_main(tmp_path)
    mock_jwks(monkeypatch)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=main.app),
        base_url="http://testserver",
    ) as client:
        response = await client.get("/v1/services", headers=auth_header(["dxcp-delivery-owners"]))
    assert response.status_code == 200


async def test_wrong_issuer_rejected(tmp_path: Path, monkeypatch):
    main = _load_main(tmp_path)
    mock_jwks(monkeypatch)
    bad_token = build_token(["dxcp-platform-admins"], issuer=f"{ISSUER}wrong")
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=main.app),
        base_url="http://testserver",
    ) as client:
        response = await client.get("/v1/services", headers={"Authorization": f"Bearer {bad_token}"})
    assert response.status_code == 401


async def test_wrong_audience_rejected(tmp_path: Path, monkeypatch):
    main = _load_main(tmp_path)
    mock_jwks(monkeypatch)
    bad_token = build_token(["dxcp-platform-admins"], audience=f"{AUDIENCE}/wrong")
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=main.app),
        base_url="http://testserver",
    ) as client:
        response = await client.get("/v1/recipes", headers={"Authorization": f"Bearer {bad_token}"})
    assert response.status_code == 401


async def test_missing_roles_claim_forbidden(tmp_path: Path, monkeypatch):
    main = _load_main(tmp_path)
    mock_jwks(monkeypatch)
    token = build_token(["dxcp-platform-admins"], include_roles=False)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=main.app),
        base_url="http://testserver",
    ) as client:
        response = await client.get("/v1/services", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 403
    assert response.json()["code"] == "AUTHZ_ROLE_REQUIRED"
