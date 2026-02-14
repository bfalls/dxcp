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

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=main.app),
        base_url="http://testserver",
    ) as client:
        yield client, main


def _promotion_payload(
    source_environment: str = "sandbox",
    target_environment: str = "staging",
    version: str = "1.2.3",
) -> dict:
    return {
        "service": "payments",
        "source_environment": source_environment,
        "target_environment": target_environment,
        "version": version,
        "recipeId": "standard",
        "changeSummary": "promote payments",
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


async def test_validate_promotion_uses_environment_promotion_order_when_present(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, main):
        _seed_successful_source(main)
        group = main.storage.get_delivery_group("group-1")
        assert group is not None
        # Intentionally out of order relative to desired promotion progression.
        group["allowed_environments"] = ["sandbox", "prod", "staging"]
        main.storage.update_delivery_group(group)
        for env_name, order in [("sandbox", 1), ("staging", 2), ("prod", 3)]:
            env = main.storage.get_environment_for_group(env_name, "group-1")
            assert env is not None
            env["promotion_order"] = order
            main.storage.update_environment(env)

        response = await client.post(
            "/v1/promotions/validate",
            headers=auth_header(["dxcp-platform-admins"]),
            json=_promotion_payload(target_environment="staging"),
        )
    assert response.status_code == 200
    body = response.json()
    assert body["target_environment"] == "staging"
