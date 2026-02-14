import json
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
import pytest
from auth_utils import auth_header, configure_auth_env, mock_jwks


class FakeSpinnaker:
    def __init__(self) -> None:
        self.mode = "http"
        self.executions = {}
        self.triggered = []

    def trigger_deploy(self, payload: dict, idempotency_key: str) -> dict:
        execution_id = f"exec-{len(self.executions) + 1}"
        self.executions[execution_id] = {"state": "IN_PROGRESS", "failures": []}
        self.triggered.append({"kind": "deploy", "payload": payload, "idempotency_key": idempotency_key})
        return {"executionId": execution_id, "executionUrl": f"http://spinnaker.local/pipelines/{execution_id}"}

    def trigger_rollback(self, payload: dict, idempotency_key: str) -> dict:
        execution_id = f"exec-{len(self.executions) + 1}"
        self.executions[execution_id] = {"state": "IN_PROGRESS", "failures": []}
        self.triggered.append({"kind": "rollback", "payload": payload, "idempotency_key": idempotency_key})
        return {"executionId": execution_id, "executionUrl": f"http://spinnaker.local/pipelines/{execution_id}"}

    def get_execution(self, execution_id: str) -> dict:
        execution = self.executions.get(execution_id, {"state": "UNKNOWN", "failures": []})
        return {
            "state": execution["state"],
            "failures": execution["failures"],
            "executionUrl": f"http://spinnaker.local/pipelines/{execution_id}",
        }


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
    os.environ["DXCP_SPINNAKER_MODE"] = "http"
    configure_auth_env()
    _write_service_registry(Path(os.environ["DXCP_SERVICE_REGISTRY_PATH"]))

    for module in ["main", "config", "storage", "policy", "idempotency", "rate_limit"]:
        if module in sys.modules:
            del sys.modules[module]

    import importlib

    main = importlib.import_module("main")
    return main


def _insert_deployment(storage, deployment_id: str, service: str, env: str, version: str, state: str, created_at: str):
    record = {
        "id": deployment_id,
        "service": service,
        "environment": env,
        "version": version,
        "state": state,
        "changeSummary": f"{state.lower()} {version}",
        "createdAt": created_at,
        "updatedAt": created_at,
        "spinnakerExecutionId": f"exec-{deployment_id}",
        "spinnakerExecutionUrl": f"http://spinnaker.local/pipelines/exec-{deployment_id}",
        "spinnakerApplication": "demo-app",
        "spinnakerPipeline": "demo-pipeline",
        "deliveryGroupId": "default",
        "failures": [],
    }
    storage.insert_deployment(record, [])


pytestmark = pytest.mark.anyio


@asynccontextmanager
async def _client_and_state(tmp_path: Path, monkeypatch):
    main = _load_main(tmp_path)
    mock_jwks(monkeypatch)
    fake = FakeSpinnaker()
    main.spinnaker = fake
    main.idempotency = main.IdempotencyStore()
    main.rate_limiter = main.RateLimiter()
    main.storage = main.build_storage()
    main.guardrails = main.Guardrails(main.storage)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=main.app),
        base_url="http://testserver",
    ) as client:
        yield client, main, fake


async def test_rollback_requires_idempotency_key(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, _, _):
        response = await client.post(
            "/v1/deployments/unknown/rollback",
            headers=auth_header(["dxcp-platform-admins"]),
            json={},
        )
    assert response.status_code == 400
    body = response.json()
    assert body["code"] == "IDMP_KEY_REQUIRED"


async def test_rollback_invalid_environment(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, main, _):
        _insert_deployment(
            main.storage,
            deployment_id="dep-prod",
            service="demo-service",
            env="prod",
            version="1.0.0",
            state="SUCCEEDED",
            created_at="2024-01-01T00:00:00Z",
        )
        response = await client.post(
            "/v1/deployments/dep-prod/rollback",
            headers={"Idempotency-Key": "rollback-1", **auth_header(["dxcp-platform-admins"])},
            json={},
        )
    assert response.status_code == 403
    body = response.json()
    assert body["code"] == "ENVIRONMENT_NOT_ALLOWED"


async def test_rollback_active_lock(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, main, _):
        _insert_deployment(
            main.storage,
            deployment_id="dep-success",
            service="demo-service",
            env="sandbox",
            version="1.0.1",
            state="SUCCEEDED",
            created_at="2024-01-02T00:00:00Z",
        )
        _insert_deployment(
            main.storage,
            deployment_id="dep-active",
            service="demo-service",
            env="sandbox",
            version="1.0.2",
            state="ACTIVE",
            created_at="2024-01-03T00:00:00Z",
        )
        response = await client.post(
            "/v1/deployments/dep-success/rollback",
            headers={"Idempotency-Key": "rollback-2", **auth_header(["dxcp-platform-admins"])},
            json={},
        )
    assert response.status_code == 409
    body = response.json()
    assert body["code"] == "CONCURRENCY_LIMIT_REACHED"


async def test_rollback_unknown_deployment(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, _, _):
        response = await client.post(
            "/v1/deployments/missing/rollback",
            headers={"Idempotency-Key": "rollback-3", **auth_header(["dxcp-platform-admins"])},
            json={},
        )
    assert response.status_code == 404
    body = response.json()
    assert body["code"] == "NOT_FOUND"


async def test_rollback_requires_prior_success(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, main, _):
        _insert_deployment(
            main.storage,
            deployment_id="dep-failed",
            service="demo-service",
            env="sandbox",
            version="1.0.0",
            state="FAILED",
            created_at="2024-01-01T00:00:00Z",
        )
        _insert_deployment(
            main.storage,
            deployment_id="dep-target",
            service="demo-service",
            env="sandbox",
            version="1.0.1",
            state="SUCCEEDED",
            created_at="2024-01-02T00:00:00Z",
        )
        response = await client.post(
            "/v1/deployments/dep-target/rollback",
            headers={"Idempotency-Key": "rollback-4", **auth_header(["dxcp-platform-admins"])},
            json={},
        )
    assert response.status_code == 400
    body = response.json()
    assert body["code"] == "NO_PRIOR_SUCCESSFUL_VERSION"


async def test_rollback_creates_record_and_updates_status(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, main, fake):
        _insert_deployment(
            main.storage,
            deployment_id="dep-a",
            service="demo-service",
            env="sandbox",
            version="1.0.0",
            state="SUCCEEDED",
            created_at="2024-01-01T00:00:00Z",
        )
        _insert_deployment(
            main.storage,
            deployment_id="dep-b",
            service="demo-service",
            env="sandbox",
            version="1.0.1",
            state="SUCCEEDED",
            created_at="2024-01-02T00:00:00Z",
        )
        response = await client.post(
            "/v1/deployments/dep-b/rollback",
            headers={"Idempotency-Key": "rollback-5", **auth_header(["dxcp-platform-admins"])},
            json={},
        )
        assert response.status_code == 201
        body = response.json()
        assert body["version"] == "1.0.0"
        assert body["rollbackOf"] == "dep-b"
        assert body["engineExecutionId"]
        assert fake.triggered[0]["kind"] == "rollback"
        assert fake.triggered[0]["payload"]["version"] == "1.0.0"
        assert fake.triggered[0]["payload"]["targetVersion"] == "1.0.0"

        fake.executions[body["engineExecutionId"]]["state"] = "SUCCEEDED"
        detail = await client.get(
            f"/v1/deployments/{body['id']}",
            headers=auth_header(["dxcp-platform-admins"]),
        )
        assert detail.status_code == 200
        detail_body = detail.json()
        assert detail_body["state"] == "SUCCEEDED"

        original = main.storage.get_deployment("dep-b")
        assert original["state"] == "ROLLED_BACK"
        assert original["outcome"] == "ROLLED_BACK"
