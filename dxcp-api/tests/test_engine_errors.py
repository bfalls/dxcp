import json
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
import pytest
from auth_utils import auth_header, build_token, configure_auth_env, mock_jwks


from test_helpers import seed_defaults

pytestmark = pytest.mark.anyio


def _load_main(tmp_path: Path):
    dxcp_api_dir = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(dxcp_api_dir))
    os.environ["DXCP_DB_PATH"] = str(tmp_path / "dxcp-test.db")
    os.environ["DXCP_SERVICE_REGISTRY_PATH"] = str(tmp_path / "services.json")
    os.environ["DXCP_DEMO_MODE"] = "0"
    configure_auth_env()
    Path(os.environ["DXCP_SERVICE_REGISTRY_PATH"]).write_text(
        json.dumps(
            [
                {
                    "service_name": "demo-service",
                    "allowed_environments": ["sandbox"],
                    "allowed_recipes": ["default"],
                    "allowed_artifact_sources": [],
                }
            ]
        ),
        encoding="utf-8",
    )

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
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=main.app),
        base_url="http://testserver",
    ) as client:
        yield client, main


async def test_engine_error_schema_admin(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, main):
        main.spinnaker.mode = "http"
        def _boom():
            raise RuntimeError(
                "Spinnaker HTTP 403: Authorization: Bearer secret https://spinnaker.example.com/api/v1/pipelines"
            )
        monkeypatch.setattr(main.spinnaker, "list_applications", _boom)
        response = await client.get(
            "/v1/spinnaker/applications",
            headers=auth_header(["dxcp-platform-admins"]),
        )
    assert response.status_code == 502
    body = response.json()
    assert body["code"] == "ENGINE_UNAUTHORIZED"
    assert body["message"] == "Unable to retrieve Spinnaker applications"
    assert body.get("request_id")
    assert "operator_hint" in body
    assert "secret" not in body["operator_hint"]
    assert "spinnaker.example.com/api" not in body["operator_hint"]


async def test_engine_error_schema_non_admin(tmp_path: Path, monkeypatch):
    async with _client_and_state(tmp_path, monkeypatch) as (client, main):
        main.spinnaker.mode = "http"
        recipe_payload = {
            "id": "default",
            "name": "Default Recipe",
            "description": None,
            "spinnaker_application": "app-one",
            "deploy_pipeline": "deploy-one",
            "rollback_pipeline": "rollback-one",
            "status": "active",
        }
        if main.storage.get_recipe("default"):
            main.storage.update_recipe(recipe_payload)
        else:
            main.storage.insert_recipe(recipe_payload)
        main.storage.insert_delivery_group(
            {
                "id": "group-1",
                "name": "Group 1",
                "description": None,
                "owner": "observer-1",
                "services": ["demo-service"],
                "allowed_recipes": ["default"],
                "guardrails": None,
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
        token = build_token(["dxcp-observers"], subject="observer-1")
        response = await client.get(
            "/v1/spinnaker/applications",
            headers={"Authorization": f"Bearer {token}"},
        )
    assert response.status_code == 403
    body = response.json()
    assert body["code"] == "ROLE_FORBIDDEN"
    assert "operator_hint" not in body
