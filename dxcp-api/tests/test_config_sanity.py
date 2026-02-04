import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
import pytest
from auth_utils import configure_auth_env, mock_jwks

from models import Actor, Role


pytestmark = pytest.mark.anyio


def _load_main(tmp_path: Path):
    dxcp_api_dir = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(dxcp_api_dir))
    os.environ["DXCP_DB_PATH"] = str(tmp_path / "dxcp-test.db")
    configure_auth_env()

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
    main.storage = main.build_storage()
    main.guardrails = main.Guardrails(main.storage)
    monkeypatch.setattr(main, "get_actor", lambda _auth: Actor(actor_id="test", role=Role.OBSERVER))
    client = httpx.AsyncClient(
        transport=httpx.ASGITransport(app=main.app),
        base_url="http://testserver",
    )
    try:
        yield client, main
    finally:
        await client.aclose()


async def test_config_sanity_flags(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, main):
        monkeypatch.setattr(main.SETTINGS, "oidc_issuer", "https://issuer.example/")
        monkeypatch.setattr(main.SETTINGS, "oidc_audience", "https://dxcp-api")
        monkeypatch.setattr(main.SETTINGS, "oidc_roles_claim", "https://dxcp.example/claims/roles")
        monkeypatch.setattr(main.SETTINGS, "oidc_jwks_url", "")
        monkeypatch.setattr(main.SETTINGS, "spinnaker_base_url", "")
        monkeypatch.setattr(main.SETTINGS, "runtime_artifact_bucket", "")

        response = await client.get("/v1/config/sanity")
        assert response.status_code == 200
        body = response.json()
        assert body["oidc_configured"] is True
        assert body["spinnaker_configured"] is False
        assert body["artifact_discovery_configured"] is False

        monkeypatch.setattr(main.SETTINGS, "spinnaker_base_url", "https://spinnaker.example")
        monkeypatch.setattr(main.SETTINGS, "runtime_artifact_bucket", "dxcp-bucket")
        response = await client.get("/v1/config/sanity")
        body = response.json()
        assert body["spinnaker_configured"] is True
        assert body["artifact_discovery_configured"] is True

