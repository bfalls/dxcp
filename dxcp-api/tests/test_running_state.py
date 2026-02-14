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


def _write_service_registry(path: Path) -> None:
    data = [
        {
            "service_name": "demo-service",
            "allowed_environments": ["sandbox", "prod"],
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
    seed_defaults(main.storage)
    main.guardrails = main.Guardrails(main.storage)
    main.storage.insert_environment(
        {
            "id": "default:prod",
            "name": "prod",
            "type": "prod",
            "delivery_group_id": "default",
            "is_enabled": True,
            "guardrails": None,
            "created_at": main.utc_now(),
            "created_by": "system",
            "updated_at": main.utc_now(),
            "updated_by": "system",
        }
    )
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
    version: str,
    rollback_of: str | None = None,
    environment: str = "sandbox",
):
    record = {
        "id": deployment_id,
        "service": "demo-service",
        "environment": environment,
        "version": version,
        "recipeId": "default",
        "state": state,
        "changeSummary": "running state test",
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


async def test_running_state_rollforward_and_rollback(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, main):
        _insert_deployment(main.storage, "dep-a", "SUCCEEDED", "2024-01-01T00:00:00Z", "1.0.0")
        response = await client.get(
            "/v1/services/demo-service/running?environment=sandbox",
            headers=auth_header(["dxcp-observers"]),
        )
        assert response.status_code == 200
        assert response.json()["version"] == "1.0.0"

        _insert_deployment(main.storage, "dep-b", "SUCCEEDED", "2024-01-02T00:00:00Z", "1.0.1")
        _insert_deployment(main.storage, "dep-prod", "SUCCEEDED", "2024-01-02T00:00:00Z", "9.9.9", environment="prod")
        response = await client.get(
            "/v1/services/demo-service/running?environment=sandbox",
            headers=auth_header(["dxcp-observers"]),
        )
        assert response.status_code == 200
        assert response.json()["version"] == "1.0.1"
        response = await client.get(
            "/v1/services/demo-service/running?environment=prod",
            headers=auth_header(["dxcp-observers"]),
        )
        assert response.status_code == 200
        assert response.json()["version"] == "9.9.9"

        _insert_deployment(main.storage, "dep-c", "FAILED", "2024-01-03T00:00:00Z", "1.0.2")
        response = await client.get(
            "/v1/services/demo-service/running?environment=sandbox",
            headers=auth_header(["dxcp-observers"]),
        )
        assert response.status_code == 200
        assert response.json()["version"] == "1.0.1"

        _insert_deployment(
            main.storage,
            "dep-r",
            "SUCCEEDED",
            "2024-01-04T00:00:00Z",
            "1.0.0",
            rollback_of="dep-b",
        )
        main.storage.update_deployment(
            "dep-b",
            "ROLLED_BACK",
            [],
            outcome="ROLLED_BACK",
            superseded_by="dep-r",
        )
        response = await client.get(
            "/v1/services/demo-service/running?environment=sandbox",
            headers=auth_header(["dxcp-observers"]),
        )
        assert response.status_code == 200
        body = response.json()
        assert body["version"] == "1.0.0"
        assert body["deploymentKind"] == "ROLLBACK"

        history = await client.get(
            "/v1/deployments?service=demo-service&environment=sandbox",
            headers=auth_header(["dxcp-observers"]),
        )
        assert history.status_code == 200
        by_id = {item["id"]: item for item in history.json()}
        assert by_id["dep-r"]["deploymentKind"] == "ROLLBACK"
        assert by_id["dep-r"]["outcome"] == "SUCCEEDED"
