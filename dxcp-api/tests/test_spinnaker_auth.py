import json
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
import pytest
from auth_utils import auth_header, build_token, configure_auth_env, mock_jwks


pytestmark = pytest.mark.anyio


def _write_service_registry(path: Path) -> None:
    data = [
        {
            "service_name": "svc-a",
            "allowed_environments": ["sandbox"],
            "allowed_recipes": ["recipe-a", "recipe-b"],
            "allowed_artifact_sources": [],
        },
        {
            "service_name": "svc-b",
            "allowed_environments": ["sandbox"],
            "allowed_recipes": ["recipe-c"],
            "allowed_artifact_sources": [],
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


async def test_spinnaker_endpoints_require_auth(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, _):
        response = await client.get("/v1/spinnaker/status")
    assert response.status_code == 401


async def test_spinnaker_endpoints_forbid_non_admin(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, _):
        response = await client.get(
            "/v1/spinnaker/status",
            headers=auth_header(["dxcp-observers"]),
        )
    assert response.status_code == 403


async def test_spinnaker_endpoints_allow_admin(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, main):
        main.spinnaker.mode = "lambda"
        response = await client.get(
            "/v1/spinnaker/status",
            headers=auth_header(["dxcp-platform-admins"]),
        )
    assert response.status_code == 200


async def test_spinnaker_discovery_requires_scope(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, _):
        token = build_token(["dxcp-observers"], subject="observer-1")
        response = await client.get(
            "/v1/spinnaker/applications",
            headers={"Authorization": f"Bearer {token}"},
        )
    assert response.status_code == 403
    assert response.json()["code"] == "DELIVERY_GROUP_SCOPE_REQUIRED"


async def test_spinnaker_discovery_filters_non_admin(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, main):
        main.storage.insert_recipe(
            {
                "id": "recipe-a",
                "name": "Recipe A",
                "description": None,
                "allowed_parameters": [],
                "spinnaker_application": "app-alpha",
                "deploy_pipeline": "pipe-deploy",
                "rollback_pipeline": "pipe-rollback",
                "status": "active",
            }
        )
        main.storage.insert_recipe(
            {
                "id": "recipe-b",
                "name": "Recipe B",
                "description": None,
                "allowed_parameters": [],
                "spinnaker_application": "app-beta",
                "deploy_pipeline": "pipe-beta",
                "rollback_pipeline": "pipe-beta-rollback",
                "status": "active",
            }
        )
        main.storage.insert_delivery_group(
            {
                "id": "group-1",
                "name": "Group 1",
                "description": None,
                "owner": "owner-1",
                "services": ["svc-a"],
                "allowed_recipes": ["recipe-a"],
                "guardrails": None,
            }
        )
        main.spinnaker.mode = "http"
        monkeypatch.setattr(
            main.spinnaker,
            "list_applications",
            lambda: [
                {"name": "app-alpha"},
                {"name": "app-beta"},
            ],
        )
        monkeypatch.setattr(
            main.spinnaker,
            "list_pipeline_configs",
            lambda application: [
                {"id": "1", "name": "pipe-deploy"},
                {"id": "2", "name": "pipe-rollback"},
                {"id": "3", "name": "pipe-beta"},
            ],
        )
        token = build_token(["dxcp-observers"], subject="owner-1")
        apps_response = await client.get(
            "/v1/spinnaker/applications",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert apps_response.status_code == 200
        assert apps_response.json() == {"applications": [{"name": "app-alpha"}]}

        pipelines_response = await client.get(
            "/v1/spinnaker/applications/app-alpha/pipelines",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert pipelines_response.status_code == 200
        assert pipelines_response.json() == {
            "pipelines": [
                {"id": "1", "name": "pipe-deploy"},
                {"id": "2", "name": "pipe-rollback"},
            ]
        }

        forbidden_response = await client.get(
            "/v1/spinnaker/applications/app-beta/pipelines",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert forbidden_response.status_code == 403
        assert forbidden_response.json()["code"] == "SPINNAKER_SCOPE_FORBIDDEN"
