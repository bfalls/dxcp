import json
import os
import sys
from pathlib import Path

import httpx
import pytest

from auth_utils import AUDIENCE, ISSUER, build_token, configure_auth_env, mock_jwks


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

    return importlib.import_module("main")


pytestmark = pytest.mark.anyio


async def test_whoami_returns_identity_fields(tmp_path: Path, monkeypatch):
    main = _load_main(tmp_path)
    mock_jwks(monkeypatch)
    token = build_token(
        ["dxcp-platform-admins"],
        subject="auth0|abc123",
        email="ci@example.com",
        audience=[AUDIENCE, "https://example.com/userinfo"],
        extra_claims={"azp": "client-app-1"},
    )
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=main.app),
        base_url="http://testserver",
    ) as client:
        response = await client.get("/v1/whoami", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200
    assert response.json() == {
        "actor_id": "auth0|abc123",
        "sub": "auth0|abc123",
        "email": "ci@example.com",
        "iss": ISSUER,
        "aud": [AUDIENCE, "https://example.com/userinfo"],
        "azp": "client-app-1",
    }


async def test_whoami_requires_authorization_header(tmp_path: Path, monkeypatch):
    main = _load_main(tmp_path)
    mock_jwks(monkeypatch)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=main.app),
        base_url="http://testserver",
    ) as client:
        response = await client.get("/v1/whoami")
    assert response.status_code == 401
    assert response.json()["code"] == "UNAUTHORIZED"


async def test_whoami_accepts_ci_publisher_role(tmp_path: Path, monkeypatch):
    main = _load_main(tmp_path)
    mock_jwks(monkeypatch)
    token = build_token(["dxcp-ci-publishers"], subject="auth0|ci-bot-1")
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=main.app),
        base_url="http://testserver",
    ) as client:
        response = await client.get("/v1/whoami", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200
    assert response.json()["actor_id"] == "auth0|ci-bot-1"


async def test_whoami_rejects_missing_roles_claim(tmp_path: Path, monkeypatch):
    main = _load_main(tmp_path)
    mock_jwks(monkeypatch)
    token = build_token(["dxcp-platform-admins"], include_roles=False)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=main.app),
        base_url="http://testserver",
    ) as client:
        response = await client.get("/v1/whoami", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 403
    assert response.json()["code"] == "AUTHZ_ROLE_REQUIRED"


async def test_whoami_rejects_unknown_role(tmp_path: Path, monkeypatch):
    main = _load_main(tmp_path)
    mock_jwks(monkeypatch)
    token = build_token(["dxcp-unknown-role"])
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=main.app),
        base_url="http://testserver",
    ) as client:
        response = await client.get("/v1/whoami", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 403
    assert response.json()["code"] == "AUTHZ_ROLE_REQUIRED"


async def test_whoami_recovers_when_oidc_settings_are_missing_at_runtime(tmp_path: Path, monkeypatch):
    main = _load_main(tmp_path)
    mock_jwks(monkeypatch)
    token = build_token(["dxcp-platform-admins"], subject="auth0|recover")

    monkeypatch.delenv("DXCP_OIDC_ISSUER", raising=False)
    monkeypatch.delenv("DXCP_OIDC_AUDIENCE", raising=False)
    monkeypatch.delenv("DXCP_OIDC_JWKS_URL", raising=False)
    monkeypatch.delenv("DXCP_OIDC_ROLES_CLAIM", raising=False)

    main.SETTINGS.ssm_prefix = "/dxcp/config"
    main.SETTINGS.oidc_issuer = ""
    main.SETTINGS.oidc_audience = ""
    main.SETTINGS.oidc_jwks_url = ""
    main.SETTINGS.oidc_roles_claim = ""

    values = {
        "/dxcp/config/oidc/issuer": ISSUER,
        "/dxcp/config/oidc/audience": AUDIENCE,
        "/dxcp/config/oidc/jwks_url": "https://dxcp.example/.well-known/jwks.json",
        "/dxcp/config/oidc/roles_claim": "https://dxcp.example/claims/roles",
    }

    monkeypatch.setattr(main.SETTINGS, "_read_ssm", lambda name: values.get(name))

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=main.app),
        base_url="http://testserver",
    ) as client:
        response = await client.get("/v1/whoami", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 200
    assert response.json()["actor_id"] == "auth0|recover"
