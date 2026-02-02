import json
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
import pytest


class FakeSpinnaker:
    def __init__(self) -> None:
        self.mode = "lambda"
        self.executions = {}
        self.triggered = []

    def trigger_deploy(self, payload: dict, idempotency_key: str) -> dict:
        execution_id = f"exec-{len(self.executions) + 1}"
        self.executions[execution_id] = {"state": "IN_PROGRESS", "failures": []}
        self.triggered.append({"kind": "deploy", "payload": payload, "idempotency_key": idempotency_key})
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
            "service_name": "service-a",
            "allowed_environments": ["sandbox"],
            "allowed_recipes": ["default"],
            "allowed_artifact_sources": ["local:"],
        },
        {
            "service_name": "service-b",
            "allowed_environments": ["sandbox"],
            "allowed_recipes": ["default"],
            "allowed_artifact_sources": ["local:"],
        },
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


pytestmark = pytest.mark.anyio


@asynccontextmanager
async def _client_and_state(tmp_path: Path, group_a_guardrails: dict | None = None):
    main = _load_main(tmp_path)
    fake = FakeSpinnaker()
    main.spinnaker = fake
    main.idempotency = main.IdempotencyStore()
    main.rate_limiter = main.RateLimiter()
    main.storage = main.build_storage()
    main.guardrails = main.Guardrails(main.storage)
    main.storage.insert_delivery_group(
        {
            "id": "group-a",
            "name": "A Group",
            "description": "Group A",
            "owner": None,
            "services": ["service-a"],
            "allowed_recipes": ["default"],
            "guardrails": group_a_guardrails
            or {
                "max_concurrent_deployments": 1,
                "daily_deploy_quota": 5,
                "daily_rollback_quota": 5,
            },
        }
    )
    main.storage.insert_delivery_group(
        {
            "id": "group-b",
            "name": "B Group",
            "description": "Group B",
            "owner": None,
            "services": ["service-b"],
            "allowed_recipes": ["default"],
            "guardrails": {
                "max_concurrent_deployments": 1,
                "daily_deploy_quota": 5,
                "daily_rollback_quota": 5,
            },
        }
    )
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=main.app),
        base_url="http://testserver",
    ) as client:
        yield client, main, fake


def _deploy_payload(service: str) -> dict:
    return {
        "service": service,
        "environment": "sandbox",
        "version": "1.0.0",
        "changeSummary": f"deploy {service}",
        "recipeId": "default",
    }


async def test_group_lock_blocks_same_group(tmp_path: Path):
    async with _client_and_state(tmp_path) as (client, _, _):
        first = await client.post(
            "/v1/deployments",
            headers={"Idempotency-Key": "deploy-1"},
            json=_deploy_payload("service-a"),
        )
        second = await client.post(
            "/v1/deployments",
            headers={"Idempotency-Key": "deploy-2"},
            json=_deploy_payload("service-a"),
        )
    assert first.status_code == 201
    assert second.status_code == 409
    assert second.json()["code"] == "DEPLOYMENT_LOCKED"


async def test_group_lock_allows_different_groups(tmp_path: Path):
    async with _client_and_state(tmp_path) as (client, _, _):
        first = await client.post(
            "/v1/deployments",
            headers={"Idempotency-Key": "deploy-3"},
            json=_deploy_payload("service-a"),
        )
        second = await client.post(
            "/v1/deployments",
            headers={"Idempotency-Key": "deploy-4"},
            json=_deploy_payload("service-b"),
        )
    assert first.status_code == 201
    assert second.status_code == 201


async def test_group_quota_scoped(tmp_path: Path):
    async with _client_and_state(
        tmp_path,
        group_a_guardrails={
            "max_concurrent_deployments": 2,
            "daily_deploy_quota": 1,
            "daily_rollback_quota": 5,
        },
    ) as (client, _, _):
        first = await client.post(
            "/v1/deployments",
            headers={"Idempotency-Key": "deploy-5"},
            json=_deploy_payload("service-a"),
        )
        second = await client.post(
            "/v1/deployments",
            headers={"Idempotency-Key": "deploy-6"},
            json=_deploy_payload("service-a"),
        )
    assert first.status_code == 201
    assert second.status_code == 429
    assert second.json()["code"] == "RATE_LIMITED"
