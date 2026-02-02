import json
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
import pytest


pytestmark = pytest.mark.anyio


class FakeSpinnaker:
    def __init__(self) -> None:
        self.mode = "lambda"
        self.executions = {}

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
    os.environ["DXCP_ROLE"] = "PLATFORM_ADMIN"
    _write_service_registry(Path(os.environ["DXCP_SERVICE_REGISTRY_PATH"]))

    for module in ["main", "config", "storage", "policy", "idempotency", "rate_limit"]:
        if module in sys.modules:
            del sys.modules[module]

    import importlib

    main = importlib.import_module("main")
    return main


@asynccontextmanager
async def _client_and_state(tmp_path: Path):
    main = _load_main(tmp_path)
    fake = FakeSpinnaker()
    main.spinnaker = fake
    main.storage = main.build_storage()
    main.guardrails = main.Guardrails(main.storage)
    client = httpx.AsyncClient(
        transport=httpx.ASGITransport(app=main.app),
        base_url="http://testserver",
    )
    try:
        yield client, main, fake
    finally:
        await client.aclose()


def _insert_deployment(storage, deployment_id: str, state: str, rollback_of: str | None = None):
    record = {
        "id": deployment_id,
        "service": "demo-service",
        "environment": "sandbox",
        "version": "1.0.0",
        "recipeId": "default",
        "state": state,
        "changeSummary": "timeline test",
        "createdAt": "2024-01-01T00:00:00Z",
        "updatedAt": "2024-01-01T00:05:00Z",
        "spinnakerExecutionId": f"exec-{deployment_id}",
        "spinnakerExecutionUrl": f"http://spinnaker.local/pipelines/exec-{deployment_id}",
        "spinnakerApplication": "demo-app",
        "spinnakerPipeline": "demo-pipeline",
        "deliveryGroupId": "default",
        "rollbackOf": rollback_of,
        "failures": [],
    }
    storage.insert_deployment(record, [])


async def test_timeline_succeeded(tmp_path: Path):
    async with _client_and_state(tmp_path) as (client, main, _):
        _insert_deployment(main.storage, "dep-1", "SUCCEEDED")
        response = await client.get("/v1/deployments/dep-1/timeline")
    assert response.status_code == 200
    events = response.json()
    keys = [event["key"] for event in events]
    assert keys[0] == "submitted"
    assert "succeeded" in keys


async def test_timeline_rollback_failed(tmp_path: Path):
    async with _client_and_state(tmp_path) as (client, main, _):
        _insert_deployment(main.storage, "dep-2", "FAILED", rollback_of="dep-1")
        response = await client.get("/v1/deployments/dep-2/timeline")
    assert response.status_code == 200
    keys = [event["key"] for event in response.json()]
    assert "rollback_started" in keys
    assert "rollback_failed" in keys
