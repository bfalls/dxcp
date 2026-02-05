import json
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
import pytest
from auth_utils import auth_header, build_token, configure_auth_env, mock_jwks


pytestmark = pytest.mark.anyio


class FakeSpinnaker:
    def __init__(self) -> None:
        self.mode = "lambda"

    def trigger_deploy(self, payload: dict, idempotency_key: str) -> dict:
        return {"executionId": "exec-1", "executionUrl": "http://spinnaker.local/pipelines/exec-1"}


def _write_service_registry(path: Path) -> None:
    data = [
        {
            "service_name": "demo-service",
            "allowed_environments": ["sandbox"],
            "allowed_recipes": ["default"],
            "allowed_artifact_sources": ["local:"],
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
    main.spinnaker = FakeSpinnaker()
    main.idempotency = main.IdempotencyStore()
    main.rate_limiter = main.RateLimiter()
    main.storage = main.build_storage()
    main.guardrails = main.Guardrails(main.storage)
    main.storage.insert_build(
        {
            "service": "demo-service",
            "version": "1.0.0",
            "artifactRef": "local:demo-service-1.0.0.zip",
            "sha256": "a" * 64,
            "sizeBytes": 1024,
            "contentType": "application/zip",
            "registeredAt": main.utc_now(),
        }
    )
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=main.app),
        base_url="http://testserver",
    ) as client:
        yield client, main


async def test_audit_events_require_admin(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, _):
        response = await client.get(
            "/v1/audit/events",
            headers=auth_header(["dxcp-observers"]),
        )
    assert response.status_code == 403


async def test_audit_event_written_on_admin_create(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, main):
        default_group = main.storage.get_delivery_group("default")
        if default_group:
            default_group["services"] = []
            main.storage.update_delivery_group(default_group)
        token = build_token(["dxcp-platform-admins"], subject="admin-1")
        response = await client.post(
            "/v1/delivery-groups",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "id": "audit-group",
                "name": "Audit Group",
                "description": "Audit test",
                "owner": "team-1",
                "services": ["demo-service"],
                "allowed_recipes": ["default"],
                "guardrails": None,
            },
        )
        assert response.status_code == 201
        events = await client.get(
            "/v1/audit/events?event_type=ADMIN_CREATE",
            headers={"Authorization": f"Bearer {token}"},
        )
    assert events.status_code == 200
    body = events.json()
    assert body
    assert body[0]["event_type"] == "ADMIN_CREATE"
    assert body[0]["target_type"] == "DeliveryGroup"
    assert body[0]["target_id"] == "audit-group"
    async with _client_and_state(tmp_path, monkeypatch) as (client, _):
        update = await client.put(
            "/v1/delivery-groups/audit-group",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "id": "audit-group",
                "name": "Audit Group Updated",
                "description": "Audit test",
                "owner": "team-1",
                "services": ["demo-service"],
                "allowed_recipes": ["default"],
                "guardrails": None,
            },
        )
        assert update.status_code == 200
        updated_events = await client.get(
            "/v1/audit/events?event_type=ADMIN_UPDATE",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert updated_events.status_code == 200
        updated_body = updated_events.json()
        assert updated_body
        assert updated_body[0]["target_id"] == "audit-group"


async def test_audit_event_written_on_deploy_submit(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, main):
        token = build_token(["dxcp-platform-admins"], subject="admin-1")
        response = await client.post(
            "/v1/deployments",
            headers={"Authorization": f"Bearer {token}", "Idempotency-Key": "deploy-1"},
            json={
                "service": "demo-service",
                "environment": "sandbox",
                "version": "1.0.0",
                "changeSummary": "audit deploy",
                "recipeId": "default",
            },
        )
        assert response.status_code == 201
        events = await client.get(
            "/v1/audit/events?event_type=DEPLOY_SUBMIT",
            headers={"Authorization": f"Bearer {token}"},
        )
    assert events.status_code == 200
    body = events.json()
    assert body
    assert body[0]["event_type"] == "DEPLOY_SUBMIT"
    assert body[0]["service_name"] == "demo-service"


async def test_no_audit_event_on_read_only(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, _):
        token = build_token(["dxcp-platform-admins"], subject="admin-1")
        response = await client.get(
            "/v1/recipes",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 200
        events = await client.get(
            "/v1/audit/events",
            headers={"Authorization": f"Bearer {token}"},
        )
    assert events.status_code == 200
    assert events.json() == []
