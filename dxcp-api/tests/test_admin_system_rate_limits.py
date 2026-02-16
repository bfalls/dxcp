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
async def _client(tmp_path: Path, monkeypatch, store: dict[str, str] | None = None):
    main = _load_main(tmp_path)
    mock_jwks(monkeypatch)
    # Keep SSM behavior scoped to this test module without global env leakage.
    main.SETTINGS.ssm_prefix = "/dxcp/config"
    main.SETTINGS.read_rpm = 60
    main.SETTINGS.mutate_rpm = 10
    if store is not None:
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
        yield client, main


async def test_get_system_rate_limits_admin_only(tmp_path: Path, monkeypatch):
    store = {
        "/dxcp/config/read_rpm": "77",
        "/dxcp/config/mutate_rpm": "12",
    }
    async with _client(tmp_path, monkeypatch, store=store) as (client, _):
        admin = await client.get(
            "/v1/admin/system/rate-limits",
            headers=auth_header(["dxcp-platform-admins"]),
        )
        observer = await client.get(
            "/v1/admin/system/rate-limits",
            headers=auth_header(["dxcp-observers"]),
        )

    assert admin.status_code == 200
    assert admin.json() == {"read_rpm": 77, "mutate_rpm": 12, "source": "ssm"}
    assert observer.status_code == 403


@pytest.mark.parametrize(
    "payload",
    [
        {"read_rpm": 0, "mutate_rpm": 10},
        {"read_rpm": 1, "mutate_rpm": 0},
        {"read_rpm": -1, "mutate_rpm": 10},
        {"read_rpm": 10, "mutate_rpm": 5001},
        {"read_rpm": "10", "mutate_rpm": 10},
        {"read_rpm": 10.5, "mutate_rpm": 10},
        {"read_rpm": True, "mutate_rpm": 10},
    ],
)
async def test_put_system_rate_limits_validation_bounds(tmp_path: Path, monkeypatch, payload: dict):
    store = {
        "/dxcp/config/read_rpm": "60",
        "/dxcp/config/mutate_rpm": "10",
    }
    async with _client(tmp_path, monkeypatch, store=store) as (client, _):
        response = await client.put(
            "/v1/admin/system/rate-limits",
            headers=auth_header(["dxcp-platform-admins"]),
            json=payload,
        )

    assert response.status_code == 400
    body = response.json()
    assert body["code"] == "INVALID_REQUEST"
    assert body["request_id"]


async def test_put_system_rate_limits_writes_ssm_and_logs(tmp_path: Path, monkeypatch):
    store = {
        "/dxcp/config/read_rpm": "60",
        "/dxcp/config/mutate_rpm": "10",
    }
    captured = {}
    async with _client(tmp_path, monkeypatch, store=store) as (client, _):
        import admin_system_routes

        def _capture_log(message: str, *args):
            rendered = message % args
            captured["line"] = rendered

        monkeypatch.setattr(admin_system_routes.logger, "info", _capture_log)
        response = await client.put(
            "/v1/admin/system/rate-limits",
            headers=auth_header(["dxcp-platform-admins"]),
            json={"read_rpm": 123, "mutate_rpm": 45},
        )

    assert response.status_code == 200
    assert response.json() == {"read_rpm": 123, "mutate_rpm": 45, "source": "ssm"}
    assert store["/dxcp/config/read_rpm"] == "123"
    assert store["/dxcp/config/mutate_rpm"] == "45"
    line = captured["line"]
    assert "event=admin.system_rate_limits.updated" in line
    assert "actor_id=user-1" in line
    assert "old_read_rpm=60" in line
    assert "old_mutate_rpm=10" in line
    assert "new_read_rpm=123" in line
    assert "new_mutate_rpm=45" in line


async def test_put_updates_live_read_limit_enforcement(tmp_path: Path, monkeypatch):
    store = {
        "/dxcp/config/read_rpm": "5",
        "/dxcp/config/mutate_rpm": "10",
    }
    async with _client(tmp_path, monkeypatch, store=store) as (client, _):
        for _ in range(2):
            ok = await client.get("/v1/deployments", headers=auth_header(["dxcp-platform-admins"]))
            assert ok.status_code == 200

        update = await client.put(
            "/v1/admin/system/rate-limits",
            headers=auth_header(["dxcp-platform-admins"]),
            json={"read_rpm": 1, "mutate_rpm": 10},
        )
        assert update.status_code == 200

        first_under_new_limit = await client.get("/v1/deployments", headers=auth_header(["dxcp-platform-admins"]))
        second_under_new_limit = await client.get("/v1/deployments", headers=auth_header(["dxcp-platform-admins"]))

    assert first_under_new_limit.status_code == 200
    assert second_under_new_limit.status_code == 429
    assert second_under_new_limit.json()["code"] == "RATE_LIMITED"
