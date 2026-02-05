import json
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
import pytest
from auth_utils import auth_header, configure_auth_env, mock_jwks


pytestmark = pytest.mark.anyio


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
    client = httpx.AsyncClient(
        transport=httpx.ASGITransport(app=main.app),
        base_url="http://testserver",
    )
    try:
        yield client, main
    finally:
        await client.aclose()


def _insert_deployment(
    storage,
    deployment_id: str,
    state: str,
    created_at: str,
    version: str = "1.0.0",
    rollback_of: str | None = None,
):
    record = {
        "id": deployment_id,
        "service": "demo-service",
        "environment": "sandbox",
        "version": version,
        "recipeId": "default",
        "state": state,
        "changeSummary": "status test",
        "createdAt": created_at,
        "updatedAt": created_at,
        "spinnakerExecutionId": f"exec-{deployment_id}",
        "spinnakerExecutionUrl": f"http://spinnaker.local/pipelines/exec-{deployment_id}",
        "spinnakerApplication": "demo-app",
        "spinnakerPipeline": "demo-pipeline",
        "deliveryGroupId": "default",
        "failures": [],
        "rollbackOf": rollback_of,
    }
    storage.insert_deployment(record, [])


async def test_delivery_status_latest_deployment(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, main):
        _insert_deployment(main.storage, "dep-1", "SUCCEEDED", "2024-01-01T00:00:00Z")
        response = await client.get(
            "/v1/services/demo-service/delivery-status",
            headers=auth_header(["dxcp-observers"]),
        )
    assert response.status_code == 200
    body = response.json()
    assert body["service"] == "demo-service"
    assert body["hasDeployments"] is True
    assert body["latest"]["state"] == "SUCCEEDED"
    assert body["latest"]["deploymentKind"] == "ROLL_FORWARD"
    assert body["latest"]["outcome"] == "SUCCEEDED"
    assert body["currentRunning"]["version"] == "1.0.0"


async def test_delivery_status_current_running_and_superseded(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, main):
        _insert_deployment(main.storage, "dep-1", "SUCCEEDED", "2024-01-01T00:00:00Z", version="1.0.0")
        _insert_deployment(main.storage, "dep-2", "FAILED", "2024-01-02T00:00:00Z", version="1.0.1")
        _insert_deployment(main.storage, "dep-3", "SUCCEEDED", "2024-01-03T00:00:00Z", version="1.0.2")
        response = await client.get(
            "/v1/services/demo-service/delivery-status",
            headers=auth_header(["dxcp-observers"]),
        )
    assert response.status_code == 200
    body = response.json()
    assert body["latest"]["id"] == "dep-3"
    assert body["latest"]["outcome"] == "SUCCEEDED"
    assert body["currentRunning"]["version"] == "1.0.2"


async def test_deployments_list_outcomes_and_kinds(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, main):
        _insert_deployment(main.storage, "dep-1", "SUCCEEDED", "2024-01-01T00:00:00Z", version="1.0.0")
        _insert_deployment(main.storage, "dep-2", "SUCCEEDED", "2024-01-02T00:00:00Z", version="1.0.1")
        _insert_deployment(
            main.storage,
            "dep-3",
            "SUCCEEDED",
            "2024-01-03T00:00:00Z",
            version="1.0.0",
            rollback_of="dep-2",
        )
        response = await client.get(
            "/v1/deployments",
            headers=auth_header(["dxcp-observers"]),
        )
    assert response.status_code == 200
    body = response.json()
    by_id = {item["id"]: item for item in body}
    assert by_id["dep-3"]["deploymentKind"] == "ROLLBACK"
    assert by_id["dep-3"]["outcome"] == "SUCCEEDED"
    assert by_id["dep-2"]["deploymentKind"] == "ROLL_FORWARD"
    assert by_id["dep-2"]["outcome"] == "SUPERSEDED"


async def test_allowed_actions_observer(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, _):
        response = await client.get(
            "/v1/services/demo-service/allowed-actions",
            headers=auth_header(["dxcp-observers"]),
        )
    assert response.status_code == 200
    body = response.json()
    assert body["actions"]["view"] is True
    assert body["actions"]["deploy"] is False
    assert body["actions"]["rollback"] is False
