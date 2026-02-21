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


def _publisher(name: str, subject: str) -> dict:
    return {
        "name": name,
        "provider": "custom",
        "subjects": [subject],
    }


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
    configure_auth_env()
    _write_service_registry(Path(os.environ["DXCP_SERVICE_REGISTRY_PATH"]))

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
    main.SETTINGS.read_rpm = 60
    main.SETTINGS.mutate_rpm = 10
    main.SETTINGS.ci_publishers = []
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


async def test_get_system_ci_publishers_admin_only(tmp_path: Path, monkeypatch):
    store = {"/dxcp/config/ci_publishers": json.dumps([_publisher("ci-bot-1", "ci-bot-1"), _publisher("ci-bot-2", "ci-bot-2")])}
    async with _client(tmp_path, monkeypatch, store) as (client, _):
        admin = await client.get(
            "/v1/admin/system/ci-publishers",
            headers=auth_header(["dxcp-platform-admins"]),
        )
        observer = await client.get(
            "/v1/admin/system/ci-publishers",
            headers=auth_header(["dxcp-observers"]),
        )
    assert admin.status_code == 200
    assert admin.json() == {
        "publishers": [_publisher("ci-bot-1", "ci-bot-1"), _publisher("ci-bot-2", "ci-bot-2")],
        "source": "ssm",
    }
    assert observer.status_code == 403


async def test_get_system_ci_publishers_falls_back_to_runtime_when_ssm_missing(tmp_path: Path, monkeypatch):
    store = {}
    async with _client(tmp_path, monkeypatch, store) as (client, main):
        main.SETTINGS.ci_publishers = [_publisher("runtime-ci-1", "runtime-ci-1"), _publisher("runtime-ci-2", "runtime-ci-2")]
        response = await client.get(
            "/v1/admin/system/ci-publishers",
            headers=auth_header(["dxcp-platform-admins"]),
        )
    assert response.status_code == 200
    assert response.json() == {
        "publishers": [_publisher("runtime-ci-1", "runtime-ci-1"), _publisher("runtime-ci-2", "runtime-ci-2")],
        "source": "runtime",
    }


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"publishers": "ci-bot-1"},
        {"publishers": [_publisher("ci-bot-1", "ci-bot-1"), {"name": "ci-bot-1", "provider": "custom", "subjects": ["other"]}]},
        {"publishers": [{"name": "", "provider": "custom", "subjects": ["ci-bot-1"]}]},
        {"publishers": [42]},
    ],
)
async def test_put_system_ci_publishers_validation(tmp_path: Path, monkeypatch, payload: dict):
    store = {"/dxcp/config/ci_publishers": json.dumps([_publisher("ci-bot-1", "ci-bot-1")])}
    async with _client(tmp_path, monkeypatch, store) as (client, _):
        response = await client.put(
            "/v1/admin/system/ci-publishers",
            headers={"Idempotency-Key": "ci-publishers-validate", **auth_header(["dxcp-platform-admins"])},
            json=payload,
        )
    assert response.status_code == 400
    assert response.json()["code"] == "INVALID_REQUEST"


async def test_put_system_ci_publishers_requires_idempotency_key(tmp_path: Path, monkeypatch):
    store = {"/dxcp/config/ci_publishers": json.dumps([_publisher("ci-bot-1", "ci-bot-1")])}
    async with _client(tmp_path, monkeypatch, store) as (client, _):
        missing = await client.put(
            "/v1/admin/system/ci-publishers",
            headers=auth_header(["dxcp-platform-admins"]),
            json={"publishers": [_publisher("ci-bot-2", "ci-bot-2")]},
        )
        empty = await client.put(
            "/v1/admin/system/ci-publishers",
            headers={"Idempotency-Key": "", **auth_header(["dxcp-platform-admins"])},
            json={"publishers": [_publisher("ci-bot-2", "ci-bot-2")]},
        )
    assert missing.status_code == 400
    assert missing.json()["code"] == "IDMP_KEY_REQUIRED"
    assert empty.status_code == 400
    assert empty.json()["code"] == "IDMP_KEY_REQUIRED"


async def test_put_system_ci_publishers_writes_ssm_and_updates_runtime(tmp_path: Path, monkeypatch):
    store = {"/dxcp/config/ci_publishers": json.dumps([_publisher("ci-bot-1", "ci-bot-1")])}
    updated_publishers = [_publisher("ci-bot-2", "ci-bot-2"), _publisher("ci-bot-3", "ci-bot-3")]
    async with _client(tmp_path, monkeypatch, store) as (client, main):
        response = await client.put(
            "/v1/admin/system/ci-publishers",
            headers={"Idempotency-Key": "ci-publishers-update", **auth_header(["dxcp-platform-admins"])},
            json={"publishers": updated_publishers},
        )
    assert response.status_code == 200
    assert response.json() == {"publishers": updated_publishers, "source": "ssm"}
    assert json.loads(store["/dxcp/config/ci_publishers"]) == updated_publishers
    assert [publisher.name for publisher in main.SETTINGS.ci_publishers] == ["ci-bot-2", "ci-bot-3"]


async def test_put_system_ci_publishers_changes_build_auth_immediately(tmp_path: Path, monkeypatch):
    store = {"/dxcp/config/ci_publishers": json.dumps([_publisher("ci-bot-1", "ci-bot-1")])}
    payload = {
        "service": "demo-service",
        "version": "1.0.1",
        "expectedSizeBytes": 1024,
        "expectedSha256": "a" * 64,
        "contentType": "application/zip",
    }
    async with _client(tmp_path, monkeypatch, store) as (client, _):
        before = await client.post(
            "/v1/builds/upload-capability",
            headers={"Idempotency-Key": "cap-before", **auth_header(["dxcp-ci-publishers"])},
            json=payload,
        )
        update = await client.put(
            "/v1/admin/system/ci-publishers",
            headers={"Idempotency-Key": "ci-publishers-rotate", **auth_header(["dxcp-platform-admins"])},
            json={"publishers": [_publisher("user-1", "user-1")]},
        )
        after = await client.post(
            "/v1/builds/upload-capability",
            headers={"Idempotency-Key": "cap-after", **auth_header(["dxcp-ci-publishers"])},
            json=payload,
        )
    assert before.status_code == 403
    assert before.json()["code"] == "CI_ONLY"
    assert update.status_code == 200
    assert after.status_code == 201
