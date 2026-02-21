import json
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
import pytest
from auth_utils import auth_header, auth_header_for_subject, configure_auth_env, mock_jwks

from test_helpers import seed_defaults


pytestmark = pytest.mark.anyio


class _FakeSSMClient:
    def __init__(self, store: dict[str, str]) -> None:
        self.store = store

    def get_parameter(self, Name: str, WithDecryption: bool = True) -> dict:
        if Name not in self.store:
            raise RuntimeError(f"Missing SSM parameter: {Name}")
        return {"Parameter": {"Value": self.store[Name]}}

    def put_parameter(self, Name: str, Value: str, Type: str = "String", Overwrite: bool = True) -> dict:
        self.store[Name] = Value
        return {}

    def get_parameters(self, Names: list[str], WithDecryption: bool = True) -> dict:
        params = []
        for name in Names:
            if name in self.store:
                params.append({"Name": name, "Value": self.store[name]})
        return {"Parameters": params}


class _FakeBoto3:
    def __init__(self, store: dict[str, str]) -> None:
        self.client_impl = _FakeSSMClient(store)

    def client(self, service_name: str):
        if service_name != "ssm":
            raise RuntimeError(f"Unexpected boto3 client request: {service_name}")
        return self.client_impl


def _write_service_registry(path: Path) -> None:
    data = [
        {
            "service_name": "demo-service",
            "allowed_environments": ["sandbox"],
            "allowed_recipes": ["default"],
            "allowed_artifact_sources": ["s3://dxcp-test-bucket/"],
        }
    ]
    path.write_text(json.dumps(data), encoding="utf-8")


def _load_main(tmp_path: Path):
    dxcp_api_dir = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(dxcp_api_dir))
    os.environ["DXCP_DB_PATH"] = str(tmp_path / "dxcp-test.db")
    os.environ["DXCP_SERVICE_REGISTRY_PATH"] = str(tmp_path / "services.json")
    os.environ["DXCP_CI_PUBLISHERS"] = json.dumps(
        [
            {
                "name": "ci-publisher-1",
                "provider": "custom",
                "subjects": ["ci-publisher-1"],
            }
        ]
    )
    configure_auth_env()
    _write_service_registry(Path(os.environ["DXCP_SERVICE_REGISTRY_PATH"]))

    for module in [
        "main",
        "config",
        "storage",
        "policy",
        "idempotency",
        "rate_limit",
        "admin_system_routes",
    ]:
        if module in sys.modules:
            del sys.modules[module]

    import importlib

    return importlib.import_module("main")


@asynccontextmanager
async def _client(tmp_path: Path, monkeypatch, store: dict[str, str]):
    main = _load_main(tmp_path)
    mock_jwks(monkeypatch)
    main.SETTINGS.ssm_prefix = "/dxcp/config"
    main.SETTINGS.read_rpm = 60
    main.SETTINGS.mutate_rpm = 10
    main.SETTINGS.daily_quota_build_register = 50
    main.SETTINGS.mutations_disabled = False
    main.SETTINGS.kill_switch = False
    import admin_system_routes
    import rate_limit

    fake = _FakeBoto3(store)
    monkeypatch.setattr(admin_system_routes, "boto3", fake)
    monkeypatch.setattr(rate_limit, "boto3", fake)
    main.storage = main.build_storage()
    seed_defaults(main.storage)
    main.storage.insert_build(
        {
            "service": "demo-service",
            "version": "1.0.0",
            "artifactRef": "s3://dxcp-test-bucket/demo-service-1.0.0.zip",
            "sha256": "a" * 64,
            "sizeBytes": 1024,
            "contentType": "application/zip",
            "registeredAt": main.utc_now(),
        }
    )
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=main.app),
        base_url="http://testserver",
    ) as client:
        yield client, main


def _intent_payload() -> dict:
    return {
        "service": "demo-service",
        "environment": "sandbox",
        "version": "1.0.0",
        "changeSummary": "test deploy",
        "recipeId": "default",
    }


def _build_register_payload() -> dict:
    return {
        "service": "demo-service",
        "version": "1.0.0",
        "artifactRef": "s3://dxcp-test-bucket/demo-service-1.0.0.zip",
        "git_sha": "f" * 40,
        "git_branch": "main",
        "ci_provider": "github_actions",
        "ci_run_id": "run-1",
        "built_at": "2026-02-16T00:00:00Z",
    }


async def test_mutations_disabled_setting_admin_only_and_persisted(tmp_path: Path, monkeypatch):
    store = {"/dxcp/config/mutations_disabled": "false"}
    async with _client(tmp_path, monkeypatch, store=store) as (client, _):
        observer_get = await client.get(
            "/v1/admin/system/mutations-disabled",
            headers=auth_header(["dxcp-observers"]),
        )
        admin_get = await client.get(
            "/v1/admin/system/mutations-disabled",
            headers=auth_header(["dxcp-platform-admins"]),
        )
        owner_put = await client.put(
            "/v1/admin/system/mutations-disabled",
            headers=auth_header(["dxcp-delivery-owners"]),
            json={"mutations_disabled": True},
        )
        ci_put = await client.put(
            "/v1/admin/system/mutations-disabled",
            headers=auth_header(["dxcp-ci-publishers"]),
            json={"mutations_disabled": True},
        )
        admin_put = await client.put(
            "/v1/admin/system/mutations-disabled",
            headers=auth_header(["dxcp-platform-admins"]),
            json={"mutations_disabled": True, "reason": "incident test"},
        )

    assert observer_get.status_code == 403
    assert admin_get.status_code == 200
    assert admin_get.json()["mutations_disabled"] is False
    assert owner_put.status_code == 403
    assert owner_put.json()["code"] == "ROLE_FORBIDDEN"
    assert ci_put.status_code == 403
    assert ci_put.json()["code"] == "ROLE_FORBIDDEN"
    assert admin_put.status_code == 200
    assert admin_put.json() == {"mutations_disabled": True, "source": "ssm"}
    assert store["/dxcp/config/mutations_disabled"] == "true"


async def test_mutations_disabled_blocks_mutations_but_not_reads(tmp_path: Path, monkeypatch):
    store = {
        "/dxcp/config/mutations_disabled": "false",
        "/dxcp/config/ci_publishers": json.dumps(
            [
                {
                    "name": "ci-publisher-1",
                    "provider": "custom",
                    "subjects": ["ci-publisher-1"],
                }
            ]
        ),
    }
    async with _client(tmp_path, monkeypatch, store=store) as (client, _):
        toggle_on = await client.put(
            "/v1/admin/system/mutations-disabled",
            headers=auth_header(["dxcp-platform-admins"]),
            json={"mutations_disabled": True, "reason": "governance test"},
        )
        deploy_validate = await client.post(
            "/v1/deployments/validate",
            headers=auth_header(["dxcp-delivery-owners"]),
            json=_intent_payload(),
        )
        build_register = await client.post(
            "/v1/builds/register",
            headers={"Idempotency-Key": "build-1", **auth_header_for_subject(["dxcp-ci-publishers"], "ci-publisher-1")},
            json=_build_register_payload(),
        )
        admin_mutation = await client.put(
            "/v1/admin/system/ci-publishers",
            headers={"Idempotency-Key": "ci-publishers-1", **auth_header(["dxcp-platform-admins"])},
            json={
                "publishers": [
                    {
                        "name": "ci-publisher-1",
                        "provider": "custom",
                        "subjects": ["ci-publisher-1"],
                    }
                ]
            },
        )
        recipe_create = await client.post(
            "/v1/recipes",
            headers=auth_header(["dxcp-platform-admins"]),
            json={
                "id": "kill-switch-test",
                "name": "Kill Switch Test",
                "description": "blocked while kill switch enabled",
                "spinnaker_application": "demo",
                "deploy_pipeline": "deploy",
                "rollback_pipeline": "rollback",
                "effective_behavior_summary": "test recipe",
                "status": "active",
            },
        )
        read_deployments = await client.get("/v1/deployments", headers=auth_header(["dxcp-observers"]))

    assert toggle_on.status_code == 200
    assert deploy_validate.status_code == 503
    assert deploy_validate.json()["code"] == "MUTATIONS_DISABLED"
    assert build_register.status_code == 503
    assert build_register.json()["code"] == "MUTATIONS_DISABLED"
    assert admin_mutation.status_code == 503
    assert admin_mutation.json()["code"] == "MUTATIONS_DISABLED"
    assert recipe_create.status_code == 503
    assert recipe_create.json()["code"] == "MUTATIONS_DISABLED"
    assert read_deployments.status_code == 200


async def test_mutations_disabled_update_audit_log_includes_actor_and_reason(tmp_path: Path, monkeypatch):
    store = {"/dxcp/config/mutations_disabled": "false"}
    captured = {}
    async with _client(tmp_path, monkeypatch, store=store) as (client, _):
        import admin_system_routes

        def _capture_log(message: str, *args):
            captured["line"] = message % args

        monkeypatch.setattr(admin_system_routes.logger, "info", _capture_log)
        response = await client.patch(
            "/v1/admin/system/mutations-disabled",
            headers=auth_header(["dxcp-platform-admins"]),
            json={"mutations_disabled": True, "reason": "incident response"},
        )

    assert response.status_code == 200
    line = captured["line"]
    assert "event=admin.system_mutations_disabled.updated" in line
    assert "actor_id=user-1" in line
    assert "actor_sub=user-1" in line
    assert "actor_email=user@example.com" in line
    assert "old_value=False" in line
    assert "new_value=True" in line
    assert "reason=incident response" in line
    assert "timestamp=" in line
