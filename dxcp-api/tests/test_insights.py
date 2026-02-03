import json
import os
import sys
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
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


def _insert_deployment(storage, deployment_id: str, created_at: str, failures: list, rollback_of: str | None = None):
    record = {
        "id": deployment_id,
        "service": "demo-service",
        "environment": "sandbox",
        "version": "1.0.0",
        "recipeId": "default",
        "state": "FAILED" if failures else "SUCCEEDED",
        "changeSummary": "insights test",
        "createdAt": created_at,
        "updatedAt": created_at,
        "spinnakerExecutionId": f"exec-{deployment_id}",
        "spinnakerExecutionUrl": f"http://spinnaker.local/pipelines/exec-{deployment_id}",
        "spinnakerApplication": "demo-app",
        "spinnakerPipeline": "demo-pipeline",
        "deliveryGroupId": "default",
        "rollbackOf": rollback_of,
        "failures": failures,
    }
    storage.insert_deployment(record, failures)


async def test_insights_aggregation(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, main):
        now = datetime.now(timezone.utc)
        day1 = (now - timedelta(days=1)).isoformat().replace("+00:00", "Z")
        day2 = (now - timedelta(days=2)).isoformat().replace("+00:00", "Z")
        day3 = (now - timedelta(days=3)).isoformat().replace("+00:00", "Z")
        _insert_deployment(
            main.storage,
            deployment_id="dep-1",
            created_at=day3,
            failures=[{"category": "infra", "summary": "boom", "observedAt": "2024-01-01T00:00:00Z"}],
        )
        _insert_deployment(
            main.storage,
            deployment_id="dep-2",
            created_at=day2,
            failures=[{"category": "policy", "summary": "blocked", "observedAt": "2024-01-02T00:00:00Z"}],
        )
        _insert_deployment(
            main.storage,
            deployment_id="dep-3",
            created_at=day1,
            failures=[],
            rollback_of="dep-1",
        )
        response = await client.get(
            "/v1/insights/failures?windowDays=30",
            headers=auth_header(["dxcp-platform-admins"]),
        )
    assert response.status_code == 200
    body = response.json()
    assert body["totalDeployments"] == 2
    assert body["totalRollbacks"] == 1
    categories = {item["key"]: item["count"] for item in body["failuresByCategory"]}
    assert categories["INFRASTRUCTURE"] == 1
    assert categories["POLICY"] == 1
