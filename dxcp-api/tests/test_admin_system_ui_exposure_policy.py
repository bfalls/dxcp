import json
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
import pytest
from auth_utils import auth_header, configure_auth_env, mock_jwks

from test_helpers import seed_defaults


pytestmark = pytest.mark.anyio


class _FakeSSMClient:
    def __init__(self, store: dict[str, str]) -> None:
        self.store = store

    def get_parameter(self, Name: str, WithDecryption: bool = True) -> dict:
        if Name not in self.store:
            raise RuntimeError(f"Missing SSM parameter: {Name}")
        return {"Parameter": {"Value": self.store[Name]}}

    def put_parameter(self, Name: str, Value: str, Type: str = "String", Overwrite: bool = True) -> dict:
        self.store[Name] = Value
        return {}


class _FakeBoto3:
    def __init__(self, store: dict[str, str]) -> None:
        self.client_impl = _FakeSSMClient(store)

    def client(self, service_name: str):
        if service_name != "ssm":
            raise RuntimeError(f"Unexpected boto3 client request: {service_name}")
        return self.client_impl


def _load_main(tmp_path: Path):
    dxcp_api_dir = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(dxcp_api_dir))
    os.environ["DXCP_DB_PATH"] = str(tmp_path / "dxcp-test.db")
    os.environ["DXCP_SERVICE_REGISTRY_PATH"] = str(tmp_path / "services.json")
    configure_auth_env()
    (tmp_path / "services.json").write_text("[]", encoding="utf-8")

    for module in [
        "main",
        "config",
        "storage",
        "policy",
        "idempotency",
        "rate_limit",
        "admin_system_routes",
    ]:
        if module in sys.modules:
            del sys.modules[module]

    import importlib

    return importlib.import_module("main")


@asynccontextmanager
async def _client(tmp_path: Path, monkeypatch, store: dict[str, str]):
    main = _load_main(tmp_path)
    mock_jwks(monkeypatch)
    main.SETTINGS.ssm_prefix = "/dxcp/config"
    import admin_system_routes
    import rate_limit

    fake = _FakeBoto3(store)
    monkeypatch.setattr(admin_system_routes, "boto3", fake)
    monkeypatch.setattr(rate_limit, "boto3", fake)
    main.storage = main.build_storage()
    seed_defaults(main.storage)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=main.app),
        base_url="http://testserver",
    ) as client:
        yield client


async def test_get_defaults_to_hidden_when_policy_missing(tmp_path: Path, monkeypatch):
    async with _client(tmp_path, monkeypatch, store={}) as client:
        response = await client.get(
            "/v1/admin/system/ui-exposure-policy",
            headers=auth_header(["dxcp-platform-admins"]),
        )
    assert response.status_code == 200
    assert response.json() == {
        "policy": {"artifactRef": {"display": False}, "externalLinks": {"display": False}},
        "source": "ssm",
    }


async def test_put_requires_platform_admin(tmp_path: Path, monkeypatch):
    async with _client(tmp_path, monkeypatch, store={}) as client:
        response = await client.put(
            "/v1/admin/system/ui-exposure-policy",
            headers=auth_header(["dxcp-observers"]),
            json={"artifactRef": {"display": True}},
        )
    assert response.status_code == 403


async def test_put_persists_valid_boolean(tmp_path: Path, monkeypatch):
    store: dict[str, str] = {}
    async with _client(tmp_path, monkeypatch, store=store) as client:
        response = await client.put(
            "/v1/admin/system/ui-exposure-policy",
            headers=auth_header(["dxcp-platform-admins"]),
            json={"artifactRef": {"display": True}, "externalLinks": {"display": True}, "unknown": {"ignored": 1}},
        )
    assert response.status_code == 200
    assert response.json() == {
        "policy": {"artifactRef": {"display": True}, "externalLinks": {"display": True}},
        "source": "ssm",
    }
    assert json.loads(store["/dxcp/config/policy/ui/exposure"]) == {
        "artifactRef": {"display": True},
        "externalLinks": {"display": True},
    }


@pytest.mark.parametrize(
    "payload",
    [
        {"artifactRef": {"display": "true"}},
        {"artifactRef": {"display": 1}},
        {"artifactRef": {"display": None}},
        {"artifactRef": "invalid"},
        {"artifactRef": {"display": []}},
        {"externalLinks": {"display": "yes"}},
        {"externalLinks": {"display": 1}},
        {"externalLinks": {"display": None}},
        {"externalLinks": "invalid"},
    ],
)
async def test_put_rejects_invalid_types(tmp_path: Path, monkeypatch, payload: dict):
    async with _client(tmp_path, monkeypatch, store={}) as client:
        response = await client.put(
            "/v1/admin/system/ui-exposure-policy",
            headers=auth_header(["dxcp-platform-admins"]),
            json=payload,
        )
    assert response.status_code == 400
    assert response.json()["code"] == "INVALID_REQUEST"


async def test_get_returns_persisted_policy(tmp_path: Path, monkeypatch):
    store = {
        "/dxcp/config/policy/ui/exposure": json.dumps(
            {
                "artifactRef": {"display": True},
                "externalLinks": {"display": True},
                "future": {"foo": "bar"},
            }
        )
    }
    async with _client(tmp_path, monkeypatch, store=store) as client:
        response = await client.get(
            "/v1/admin/system/ui-exposure-policy",
            headers=auth_header(["dxcp-platform-admins"]),
        )
    assert response.status_code == 200
    assert response.json() == {
        "policy": {"artifactRef": {"display": True}, "externalLinks": {"display": True}},
        "source": "ssm",
    }


async def test_ui_read_endpoint_allows_standard_roles(tmp_path: Path, monkeypatch):
    store = {"/dxcp/config/policy/ui/exposure": json.dumps({"artifactRef": {"display": True}})}
    async with _client(tmp_path, monkeypatch, store=store) as client:
        response = await client.get(
            "/v1/ui/policy/ui-exposure",
            headers=auth_header(["dxcp-observers"]),
        )
    assert response.status_code == 200
    assert response.json() == {
        "policy": {"artifactRef": {"display": True}, "externalLinks": {"display": False}},
        "source": "ssm",
    }
