import os
import sys
import json
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
import pytest
from auth_utils import auth_header, configure_auth_env, mock_jwks

from test_helpers import seed_defaults


pytestmark = [pytest.mark.anyio, pytest.mark.governance_contract]


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
    main.SETTINGS.daily_quota_build_register = 50
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
        "/dxcp/config/daily_quota_build_register": "33",
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
    assert admin.json() == {"read_rpm": 77, "mutate_rpm": 12, "daily_quota_build_register": 33, "source": "ssm"}
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
        {"read_rpm": 10, "mutate_rpm": 10},
        {"read_rpm": 10, "mutate_rpm": 10, "daily_quota_build_register": -1},
        {"read_rpm": 10, "mutate_rpm": 10, "daily_quota_build_register": 5001},
        {"read_rpm": 10, "mutate_rpm": 10, "daily_quota_build_register": 10.5},
        {"read_rpm": 10, "mutate_rpm": 10, "daily_quota_build_register": True},
    ],
)
async def test_put_system_rate_limits_validation_bounds(tmp_path: Path, monkeypatch, payload: dict):
    store = {
        "/dxcp/config/read_rpm": "60",
        "/dxcp/config/mutate_rpm": "10",
        "/dxcp/config/daily_quota_build_register": "50",
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


async def test_put_system_rate_limits_writes_ssm_and_audit_events(tmp_path: Path, monkeypatch):
    store = {
        "/dxcp/config/read_rpm": "60",
        "/dxcp/config/mutate_rpm": "10",
        "/dxcp/config/daily_quota_build_register": "50",
    }
    async with _client(tmp_path, monkeypatch, store=store) as (client, _):
        response = await client.put(
            "/v1/admin/system/rate-limits",
            headers={"X-Request-Id": "req-rate-1", **auth_header(["dxcp-platform-admins"])},
            json={"read_rpm": 123, "mutate_rpm": 45, "daily_quota_build_register": 88},
        )
        events = await client.get(
            "/v1/audit/events?event_type=ADMIN_CONFIG_CHANGE",
            headers=auth_header(["dxcp-platform-admins"]),
        )

    assert response.status_code == 200
    assert response.json() == {"read_rpm": 123, "mutate_rpm": 45, "daily_quota_build_register": 88, "source": "ssm"}
    assert store["/dxcp/config/read_rpm"] == "123"
    assert store["/dxcp/config/mutate_rpm"] == "45"
    assert store["/dxcp/config/daily_quota_build_register"] == "88"
    assert events.status_code == 200
    payload = events.json()
    relevant = [item for item in payload if item.get("target_id") in {"read_rpm", "mutate_rpm", "daily_quota_build_register"}]
    assert len(relevant) == 3
    for event in relevant:
        assert event["event_type"] == "ADMIN_CONFIG_CHANGE"
        assert event["target_type"] == "AdminSetting"
        assert event["actor_id"] == "user-1"
        summary = json.loads(event["summary"])
        assert summary["request_id"] == "req-rate-1"
        assert summary["actor_sub"] == "user-1"
        assert summary["actor_email"] == "user@example.com"
        assert summary["setting_key"] == event["target_id"]
        assert "old_value" in summary
        assert "new_value" in summary


async def test_put_updates_live_read_limit_enforcement(tmp_path: Path, monkeypatch):
    store = {
        "/dxcp/config/read_rpm": "5",
        "/dxcp/config/mutate_rpm": "10",
        "/dxcp/config/daily_quota_build_register": "50",
    }
    async with _client(tmp_path, monkeypatch, store=store) as (client, _):
        for _ in range(2):
            ok = await client.get("/v1/deployments", headers=auth_header(["dxcp-platform-admins"]))
            assert ok.status_code == 200

        update = await client.put(
            "/v1/admin/system/rate-limits",
            headers=auth_header(["dxcp-platform-admins"]),
            json={"read_rpm": 1, "mutate_rpm": 10, "daily_quota_build_register": 50},
        )
        assert update.status_code == 200

        first_under_new_limit = await client.get("/v1/deployments", headers=auth_header(["dxcp-platform-admins"]))
        second_under_new_limit = await client.get("/v1/deployments", headers=auth_header(["dxcp-platform-admins"]))

    assert first_under_new_limit.status_code == 200
    assert second_under_new_limit.status_code == 429
    assert second_under_new_limit.json()["code"] == "RATE_LIMITED"


async def test_put_recovers_from_invalid_existing_ssm_values(tmp_path: Path, monkeypatch):
    store = {
        "/dxcp/config/read_rpm": "60",
        "/dxcp/config/mutate_rpm": "0",
        "/dxcp/config/daily_quota_build_register": "not-a-number",
    }
    async with _client(tmp_path, monkeypatch, store=store) as (client, _):
        response = await client.put(
            "/v1/admin/system/rate-limits",
            headers=auth_header(["dxcp-platform-admins"]),
            json={"read_rpm": 100, "mutate_rpm": 20, "daily_quota_build_register": 40},
        )

    assert response.status_code == 200
    assert response.json() == {"read_rpm": 100, "mutate_rpm": 20, "daily_quota_build_register": 40, "source": "ssm"}
    assert store["/dxcp/config/read_rpm"] == "100"
    assert store["/dxcp/config/mutate_rpm"] == "20"
    assert store["/dxcp/config/daily_quota_build_register"] == "40"


async def test_get_system_rate_limits_falls_back_for_missing_build_register_quota(tmp_path: Path, monkeypatch):
    store = {
        "/dxcp/config/read_rpm": "77",
        "/dxcp/config/mutate_rpm": "12",
    }
    async with _client(tmp_path, monkeypatch, store=store) as (client, _):
        response = await client.get(
            "/v1/admin/system/rate-limits",
            headers=auth_header(["dxcp-platform-admins"]),
        )

    assert response.status_code == 200
    body = response.json()
    assert body["read_rpm"] == 77
    assert body["mutate_rpm"] == 12
    assert body["daily_quota_build_register"] == 50
