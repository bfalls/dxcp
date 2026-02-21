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

pytestmark = [pytest.mark.anyio, pytest.mark.governance_contract]


def _write_service_registry(path: Path) -> None:
    data = [
        {
            "service_name": "service-a",
            "allowed_environments": ["sandbox"],
            "allowed_recipes": ["default"],
            "allowed_artifact_sources": ["s3://dxcp-test-bucket/"],
        },
        {
            "service_name": "service-b",
            "allowed_environments": ["sandbox"],
            "allowed_recipes": ["default"],
            "allowed_artifact_sources": ["s3://dxcp-test-bucket/"],
        },
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
async def _client_and_state(
    tmp_path: Path,
    monkeypatch,
    guardrails_a: dict | None = None,
    guardrails_b: dict | None = None,
):
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

    for service_name in ["service-a", "service-b"]:
        main.storage.insert_build(
            {
                "service": service_name,
                "version": "1.0.0",
                "artifactRef": f"s3://dxcp-test-bucket/{service_name}-1.0.0.zip",
                "sha256": "a" * 64,
                "sizeBytes": 1024,
                "contentType": "application/zip",
                "registeredAt": main.utc_now(),
            }
        )

    if not main.storage.get_recipe("default"):
        main.storage.insert_recipe(
            {
                "id": "default",
                "name": "Default Recipe",
                "description": "Default recipe for policy tests",
                "spinnaker_application": None,
                "deploy_pipeline": "deploy-default",
                "rollback_pipeline": "rollback-default",
                "effective_behavior_summary": "Default deploy behavior.",
                "status": "active",
            }
        )

    main.storage.insert_delivery_group(
        {
            "id": "group-a",
            "name": "Group A",
            "description": "Primary group for policy tests",
            "owner": None,
            "services": ["service-a"],
            "allowed_recipes": ["default"],
            "allowed_environments": ["sandbox"],
            "guardrails": guardrails_a
            or {
                "max_concurrent_deployments": 2,
                "daily_deploy_quota": 5,
                "daily_rollback_quota": 5,
            },
        }
    )
    main.storage.insert_environment(
        {
            "id": "group-a:sandbox",
            "name": "sandbox",
            "type": "non_prod",
            "delivery_group_id": "group-a",
            "is_enabled": True,
            "guardrails": None,
            "created_at": main.utc_now(),
            "created_by": "system",
            "updated_at": main.utc_now(),
            "updated_by": "system",
        }
    )
    main.storage.insert_delivery_group(
        {
            "id": "group-b",
            "name": "Group B",
            "description": "Secondary group for policy tests",
            "owner": None,
            "services": ["service-b"],
            "allowed_recipes": ["default"],
            "allowed_environments": ["sandbox"],
            "guardrails": guardrails_b
            or {
                "max_concurrent_deployments": 1,
                "daily_deploy_quota": 5,
                "daily_rollback_quota": 5,
            },
        }
    )
    main.storage.insert_environment(
        {
            "id": "group-b:sandbox",
            "name": "sandbox",
            "type": "non_prod",
            "delivery_group_id": "group-b",
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
        yield client, main


def _deploy_payload(service: str) -> dict:
    return {
        "service": service,
        "environment": "sandbox",
        "version": "1.0.0",
        "changeSummary": f"deploy {service}",
        "recipeId": "default",
    }


async def test_group_concurrency_allows_n_and_blocks_n_plus_one(tmp_path: Path, monkeypatch):
    guardrails_a = {
        "max_concurrent_deployments": 2,
        "daily_deploy_quota": 5,
        "daily_rollback_quota": 5,
    }
    async with _client_and_state(tmp_path, monkeypatch, guardrails_a=guardrails_a) as (client, _):
        first = await client.post(
            "/v1/deployments",
            headers={"Idempotency-Key": "group-a-1", **auth_header(["dxcp-platform-admins"])},
            json=_deploy_payload("service-a"),
        )
        second = await client.post(
            "/v1/deployments",
            headers={"Idempotency-Key": "group-a-2", **auth_header(["dxcp-platform-admins"])},
            json=_deploy_payload("service-a"),
        )
        blocked = await client.post(
            "/v1/deployments",
            headers={"Idempotency-Key": "group-a-3", **auth_header(["dxcp-platform-admins"])},
            json=_deploy_payload("service-a"),
        )
        other_group = await client.post(
            "/v1/deployments",
            headers={"Idempotency-Key": "group-b-1", **auth_header(["dxcp-platform-admins"])},
            json=_deploy_payload("service-b"),
        )

    assert first.status_code == 201
    assert second.status_code == 201
    assert blocked.status_code == 409
    assert blocked.json()["code"] == "CONCURRENCY_LIMIT_REACHED"
    assert other_group.status_code == 201


async def test_quota_exhaustion_blocks_and_validate_reflects_remaining(tmp_path: Path, monkeypatch):
    guardrails_a = {
        "max_concurrent_deployments": 5,
        "daily_deploy_quota": 2,
        "daily_rollback_quota": 5,
    }
    async with _client_and_state(tmp_path, monkeypatch, guardrails_a=guardrails_a) as (client, _):
        initial = await client.post(
            "/v1/deployments/validate",
            headers=auth_header(["dxcp-platform-admins"]),
            json=_deploy_payload("service-a"),
        )
        assert initial.status_code == 200
        policy = initial.json()["policy"]
        assert policy["current_concurrent_deployments"] == 0
        assert policy["deployments_used"] == 0
        assert policy["deployments_remaining"] == 2

        first = await client.post(
            "/v1/deployments",
            headers={"Idempotency-Key": "quota-1", **auth_header(["dxcp-platform-admins"])},
            json=_deploy_payload("service-a"),
        )
        assert first.status_code == 201

        after_first = await client.post(
            "/v1/deployments/validate",
            headers=auth_header(["dxcp-platform-admins"]),
            json=_deploy_payload("service-a"),
        )
        assert after_first.status_code == 200
        policy = after_first.json()["policy"]
        assert policy["current_concurrent_deployments"] == 1
        assert policy["deployments_used"] == 1
        assert policy["deployments_remaining"] == 1

        second = await client.post(
            "/v1/deployments",
            headers={"Idempotency-Key": "quota-2", **auth_header(["dxcp-platform-admins"])},
            json=_deploy_payload("service-a"),
        )
        assert second.status_code == 201

        blocked = await client.post(
            "/v1/deployments",
            headers={"Idempotency-Key": "quota-3", **auth_header(["dxcp-platform-admins"])},
            json=_deploy_payload("service-a"),
        )
        assert blocked.status_code == 429
        assert blocked.json()["code"] == "QUOTA_EXCEEDED"

        validate_blocked = await client.post(
            "/v1/deployments/validate",
            headers=auth_header(["dxcp-platform-admins"]),
            json=_deploy_payload("service-a"),
        )
        assert validate_blocked.status_code == 429
        assert validate_blocked.json()["code"] == "QUOTA_EXCEEDED"
