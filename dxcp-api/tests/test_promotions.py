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
            "allowed_environments": ["sandbox", "staging", "prod"],
            "allowed_recipes": ["standard"],
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

    for module in ["main", "config", "storage", "policy", "idempotency", "rate_limit"]:
        if module in sys.modules:
            del sys.modules[module]

    import importlib

    main = importlib.import_module("main")
    return main


def _seed_successful_source(main, version: str = "1.2.3") -> None:
    main.storage.insert_deployment(
        {
            "id": "dep-source-success",
            "service": "payments",
            "environment": "sandbox",
            "version": version,
            "recipeId": "standard",
            "recipeRevision": 1,
            "effectiveBehaviorSummary": "Standard deploy behavior.",
            "state": "SUCCEEDED",
            "deploymentKind": "ROLL_FORWARD",
            "outcome": "SUCCEEDED",
            "intentCorrelationId": "seed-source",
            "supersededBy": None,
            "changeSummary": "seed success",
            "createdAt": main.utc_now(),
            "updatedAt": main.utc_now(),
            "engine_type": "SPINNAKER",
            "spinnakerExecutionId": "exec-seed-source",
            "spinnakerExecutionUrl": "http://engine.local/pipelines/exec-seed-source",
            "deliveryGroupId": "group-1",
            "failures": [],
        },
        [],
    )


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

    main.storage.insert_build(
        {
            "service": "payments",
            "version": "1.2.3",
            "artifactRef": "s3://dxcp-test-bucket/payments-1.2.3.zip",
            "sha256": "a" * 64,
            "sizeBytes": 1024,
            "contentType": "application/zip",
            "registeredAt": main.utc_now(),
        }
    )

    main.storage.insert_recipe(
        {
            "id": "standard",
            "name": "Standard Recipe",
            "description": "Default recipe for promotions",
            "spinnaker_application": None,
            "deploy_pipeline": "deploy-payments",
            "rollback_pipeline": "rollback-payments",
            "effective_behavior_summary": "Standard deploy behavior.",
            "status": "active",
        }
    )

    main.storage.insert_delivery_group(
        {
            "id": "group-1",
            "name": "Primary Delivery Group",
            "description": "Group for promotion tests",
            "owner": None,
            "services": ["payments"],
            "allowed_recipes": ["standard"],
            "allowed_environments": ["sandbox", "staging", "prod"],
            "guardrails": {
                "max_concurrent_deployments": 2,
                "daily_deploy_quota": 5,
                "daily_rollback_quota": 5,
            },
        }
    )
    for env_name in ["sandbox", "staging", "prod"]:
        env_type = "prod" if env_name == "prod" else "non_prod"
        main.storage.insert_environment(
            {
                "id": f"group-1:{env_name}",
                "name": env_name,
                "type": env_type,
                "delivery_group_id": "group-1",
                "is_enabled": True,
                "guardrails": None,
                "created_at": main.utc_now(),
                "created_by": "system",
                "updated_at": main.utc_now(),
                "updated_by": "system",
            }
        )
    for env_name, order_index in [("sandbox", 1), ("staging", 2), ("prod", 3)]:
        main.storage.upsert_delivery_group_environment_policy(
            {
                "delivery_group_id": "group-1",
                "environment_id": env_name,
                "is_enabled": True,
                "order_index": order_index,
            }
        )
    for env_name in ["sandbox", "staging", "prod"]:
        main.storage.upsert_service_environment_routing(
            {
                "service_id": "payments",
                "environment_id": env_name,
                "recipe_id": "standard",
            }
        )

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=main.app),
        base_url="http://testserver",
    ) as client:
        yield client, main


def _promotion_payload(
    source_environment: str = "sandbox",
    target_environment: str = "staging",
    version: str = "1.2.3",
    changeSummary: str = "promote payments",
) -> dict:
    return {
        "service": "payments",
        "source_environment": source_environment,
        "target_environment": target_environment,
        "version": version,
        "changeSummary": changeSummary,
    }


async def test_validate_promotion_rejects_without_successful_source(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, _):
        response = await client.post(
            "/v1/promotions/validate",
            headers=auth_header(["dxcp-platform-admins"]),
            json=_promotion_payload(),
        )
    assert response.status_code == 400
    body = response.json()
    assert body["code"] == "PROMOTION_VERSION_INELIGIBLE"


async def test_validate_promotion_rejects_environment_jump(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, main):
        _seed_successful_source(main)
        response = await client.post(
            "/v1/promotions/validate",
            headers=auth_header(["dxcp-platform-admins"]),
            json=_promotion_payload(target_environment="prod"),
        )
    assert response.status_code == 400
    body = response.json()
    assert body["code"] == "PROMOTION_PATH_NOT_ALLOWED"


async def test_create_promotion_creates_promote_record(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, main):
        _seed_successful_source(main)
        validate = await client.post(
            "/v1/promotions/validate",
            headers=auth_header(["dxcp-platform-admins"]),
            json=_promotion_payload(),
        )
        assert validate.status_code == 200

        response = await client.post(
            "/v1/promotions",
            headers={"Idempotency-Key": "promote-1", **auth_header(["dxcp-platform-admins"])},
            json=_promotion_payload(),
        )
        assert response.status_code == 201
        body = response.json()
        assert body["deploymentKind"] == "PROMOTE"
        assert body["environment"] == "staging"
        assert body["sourceEnvironment"] == "sandbox"
        assert body["version"] == "1.2.3"

        stored = main.storage.get_deployment(body["id"])
        assert stored is not None
        assert stored["deploymentKind"] == "PROMOTE"
        assert stored["sourceEnvironment"] == "sandbox"
        assert stored["recipeId"] == "standard"


async def test_validate_promotion_uses_delivery_group_environment_order_index_when_present(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, main):
        _seed_successful_source(main)
        main.storage.upsert_delivery_group_environment_policy(
            {
                "delivery_group_id": "group-1",
                "environment_id": "prod",
                "is_enabled": True,
                "order_index": 2,
            }
        )
        main.storage.upsert_delivery_group_environment_policy(
            {
                "delivery_group_id": "group-1",
                "environment_id": "staging",
                "is_enabled": True,
                "order_index": 3,
            }
        )

        response = await client.post(
            "/v1/promotions/validate",
            headers=auth_header(["dxcp-platform-admins"]),
            json=_promotion_payload(target_environment="staging"),
        )
    assert response.status_code == 400
    body = response.json()
    assert body["code"] == "PROMOTION_PATH_NOT_ALLOWED"


async def test_validate_promotion_fails_when_target_environment_not_routed(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, main):
        _seed_successful_source(main)
        group = main.storage.get_delivery_group("group-1")
        assert group is not None
        group["allowed_environments"] = ["sandbox", "qa", "staging", "prod"]
        main.storage.update_delivery_group(group)
        main.storage.insert_environment(
            {
                "id": "group-1:qa",
                "name": "qa",
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
        main.storage.upsert_delivery_group_environment_policy(
            {
                "delivery_group_id": "group-1",
                "environment_id": "qa",
                "is_enabled": True,
                "order_index": 2,
            }
        )
        main.storage.upsert_delivery_group_environment_policy(
            {
                "delivery_group_id": "group-1",
                "environment_id": "staging",
                "is_enabled": True,
                "order_index": 3,
            }
        )
        main.storage.upsert_delivery_group_environment_policy(
            {
                "delivery_group_id": "group-1",
                "environment_id": "prod",
                "is_enabled": True,
                "order_index": 4,
            }
        )
        response = await client.post(
            "/v1/promotions/validate",
            headers=auth_header(["dxcp-platform-admins"]),
            json=_promotion_payload(target_environment="qa"),
        )
    assert response.status_code == 400
    body = response.json()
    assert body["code"] == "SERVICE_ENVIRONMENT_NOT_ROUTED"


async def test_validate_promotion_fails_when_routed_recipe_not_allowed(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, main):
        _seed_successful_source(main)
        main.storage.insert_recipe(
            {
                "id": "experimental",
                "name": "Experimental Recipe",
                "description": "Not allowed for this delivery group",
                "spinnaker_application": None,
                "deploy_pipeline": "deploy-payments-experimental",
                "rollback_pipeline": "rollback-payments-experimental",
                "effective_behavior_summary": "Experimental behavior",
                "status": "active",
            }
        )
        main.storage.upsert_service_environment_routing(
            {
                "service_id": "payments",
                "environment_id": "staging",
                "recipe_id": "experimental",
            }
        )
        response = await client.post(
            "/v1/promotions/validate",
            headers=auth_header(["dxcp-platform-admins"]),
            json=_promotion_payload(),
        )
    assert response.status_code == 403
    body = response.json()
    assert body["code"] == "RECIPE_NOT_ALLOWED"


async def test_validate_promotion_fails_when_routed_recipe_not_compatible(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, main):
        _seed_successful_source(main)
        routed_recipe_id = "canary-promote-test"
        main.storage.insert_recipe(
            {
                "id": routed_recipe_id,
                "name": "Canary Recipe",
                "description": "Allowed by DG but not by service allowlist",
                "spinnaker_application": None,
                "deploy_pipeline": "deploy-payments-canary",
                "rollback_pipeline": "rollback-payments-canary",
                "effective_behavior_summary": "Canary behavior",
                "status": "active",
            }
        )
        group = main.storage.get_delivery_group("group-1")
        assert group is not None
        group["allowed_recipes"] = ["standard", routed_recipe_id]
        main.storage.update_delivery_group(group)
        main.storage.upsert_service_environment_routing(
            {
                "service_id": "payments",
                "environment_id": "staging",
                "recipe_id": routed_recipe_id,
            }
        )
        response = await client.post(
            "/v1/promotions/validate",
            headers=auth_header(["dxcp-platform-admins"]),
            json=_promotion_payload(),
        )
    assert response.status_code == 400
    body = response.json()
    assert body["code"] == "RECIPE_INCOMPATIBLE"


async def test_create_promotion_conflicts_for_same_idempotency_key_with_different_body(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, main):
        _seed_successful_source(main)
        response_a = await client.post(
            "/v1/promotions",
            headers={"Idempotency-Key": "promote-conflict-1", **auth_header(["dxcp-platform-admins"])},
            json=_promotion_payload(changeSummary="promote payments"),
        )
        assert response_a.status_code == 201

        response_b = await client.post(
            "/v1/promotions",
            headers={"Idempotency-Key": "promote-conflict-1", **auth_header(["dxcp-platform-admins"])},
            json=_promotion_payload(changeSummary="different summary"),
        )
    assert response_b.status_code == 409
    body = response_b.json()
    assert body["code"] == "IDEMPOTENCY_CONFLICT"
