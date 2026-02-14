import json
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
import pytest
from auth_utils import auth_header, configure_auth_env, mock_jwks
from fake_engine import FakeEngineAdapter


from test_helpers import seed_defaults

pytestmark = pytest.mark.anyio


def _write_service_registry(path: Path) -> None:
    data = [
        {
            "service_name": "payments",
            "allowed_environments": ["sandbox"],
            "allowed_recipes": ["standard"],
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
    main.spinnaker = FakeEngineAdapter()
    main.idempotency = main.IdempotencyStore()
    main.rate_limiter = main.RateLimiter()
    main.storage = main.build_storage()
    seed_defaults(main.storage)
    main.guardrails = main.Guardrails(main.storage)

    default_group = main.storage.get_delivery_group("default")
    if default_group:
        default_group["services"] = []
        main.storage.update_delivery_group(default_group)

    main.storage.insert_recipe(
        {
            "id": "standard",
            "name": "Standard Recipe",
            "description": "Rollback invariant recipe",
            "spinnaker_application": "payments-app",
            "deploy_pipeline": "deploy-payments",
            "rollback_pipeline": "rollback-payments",
            "effective_behavior_summary": "Standard roll-forward deploy with rollback support.",
            "status": "active",
        }
    )

    main.storage.insert_delivery_group(
        {
            "id": "group-1",
            "name": "Payments Group",
            "description": "Rollback invariant group",
            "owner": None,
            "services": ["payments"],
            "allowed_recipes": ["standard"],
            "allowed_environments": ["sandbox"],
            "guardrails": {
                "max_concurrent_deployments": 1,
                "daily_deploy_quota": 5,
                "daily_rollback_quota": 5,
            },
        }
    )
    main.storage.insert_environment(
        {
            "id": "group-1:sandbox",
            "name": "sandbox",
            "type": "non_prod",
            "delivery_group_id": "group-1",
            "is_enabled": True,
            "guardrails": None,
            "created_at": main.utc_now(),
            "created_by": "system",
            "updated_at": main.utc_now(),
            "updated_by": "system",
        }
    )

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=main.app),
        base_url="http://testserver",
    ) as client:
        yield client, main, main.spinnaker


def _insert_deployment(
    storage,
    deployment_id: str,
    version: str,
    state: str,
    created_at: str,
    rollback_of: str | None = None,
) -> None:
    record = {
        "id": deployment_id,
        "service": "payments",
        "environment": "sandbox",
        "version": version,
        "recipeId": "standard",
        "state": state,
        "changeSummary": f"{state.lower()} {version}",
        "createdAt": created_at,
        "updatedAt": created_at,
        "spinnakerExecutionId": f"exec-{deployment_id}",
        "spinnakerExecutionUrl": f"http://engine.local/pipelines/exec-{deployment_id}",
        "spinnakerApplication": "payments-app",
        "spinnakerPipeline": "deploy-payments",
        "deliveryGroupId": "group-1",
        "failures": [],
        "rollbackOf": rollback_of,
    }
    storage.insert_deployment(record, [])


def _assert_user_safe_error(body: dict) -> None:
    message = (body.get("message") or "").lower()
    operator_hint = (body.get("operator_hint") or "").lower()
    assert "spinnaker" not in message
    assert "spinnaker" not in operator_hint


async def test_rollback_uses_latest_success_before_target(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, main, fake):
        _insert_deployment(
            main.storage,
            deployment_id="dep-1",
            version="1.0.0",
            state="SUCCEEDED",
            created_at="2024-01-01T00:00:00Z",
        )
        _insert_deployment(
            main.storage,
            deployment_id="dep-2",
            version="1.0.1",
            state="FAILED",
            created_at="2024-01-02T00:00:00Z",
        )
        _insert_deployment(
            main.storage,
            deployment_id="dep-3",
            version="1.0.2",
            state="SUCCEEDED",
            created_at="2024-01-03T00:00:00Z",
        )
        response = await client.post(
            "/v1/deployments/dep-3/rollback",
            headers={"Idempotency-Key": "rollback-invariant-1", **auth_header(["dxcp-platform-admins"])},
            json={},
        )
        assert response.status_code == 201
        body = response.json()
        assert body["deploymentKind"] == "ROLLBACK"
        assert body["rollbackOf"] == "dep-3"
        assert body["version"] == "1.0.0"
        assert fake.triggered[0]["kind"] == "rollback"
        assert fake.triggered[0]["payload"]["version"] == "1.0.0"


async def test_rollback_fails_without_prior_successful_deployment(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, main, _):
        _insert_deployment(
            main.storage,
            deployment_id="dep-failed",
            version="1.0.0",
            state="FAILED",
            created_at="2024-01-01T00:00:00Z",
        )
        _insert_deployment(
            main.storage,
            deployment_id="dep-target",
            version="1.0.1",
            state="SUCCEEDED",
            created_at="2024-01-02T00:00:00Z",
        )
        response = await client.post(
            "/v1/deployments/dep-target/rollback",
            headers={"Idempotency-Key": "rollback-invariant-2", **auth_header(["dxcp-platform-admins"])},
            json={},
        )
    assert response.status_code == 400
    body = response.json()
    assert body["code"] == "NO_PRIOR_SUCCESSFUL_VERSION"
    _assert_user_safe_error(body)


async def test_rollback_rejects_rollback_target(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, main, _):
        _insert_deployment(
            main.storage,
            deployment_id="dep-1",
            version="1.0.0",
            state="SUCCEEDED",
            created_at="2024-01-01T00:00:00Z",
        )
        _insert_deployment(
            main.storage,
            deployment_id="dep-2",
            version="1.0.1",
            state="SUCCEEDED",
            created_at="2024-01-02T00:00:00Z",
        )
        _insert_deployment(
            main.storage,
            deployment_id="dep-r",
            version="1.0.0",
            state="SUCCEEDED",
            created_at="2024-01-03T00:00:00Z",
            rollback_of="dep-2",
        )
        response = await client.post(
            "/v1/deployments/dep-r/rollback",
            headers={"Idempotency-Key": "rollback-invariant-3", **auth_header(["dxcp-platform-admins"])},
            json={},
        )
    assert response.status_code == 400
    body = response.json()
    assert body["code"] == "ROLLBACK_OF_ROLLBACK"
    _assert_user_safe_error(body)
