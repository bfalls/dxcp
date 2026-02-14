import json
import os
import sys
from pathlib import Path

from auth_utils import configure_auth_env


from test_helpers import seed_defaults

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


def test_spinnaker_scope_intersects_group_and_service_recipes(tmp_path):
    main = _load_main(tmp_path)
    main.storage = main.build_storage()
    seed_defaults(main.storage)
    main.guardrails = main.Guardrails(main.storage)

    main.storage.insert_recipe(
        {
            "id": "recipe-a",
            "name": "Recipe A",
            "description": None,
            "spinnaker_application": "app-a",
            "deploy_pipeline": "deploy-a",
            "rollback_pipeline": "rollback-a",
            "status": "active",
        }
    )
    main.storage.insert_recipe(
        {
            "id": "recipe-c",
            "name": "Recipe C",
            "description": None,
            "spinnaker_application": "app-c",
            "deploy_pipeline": "deploy-c",
            "rollback_pipeline": "rollback-c",
            "status": "active",
        }
    )
    main.storage.insert_delivery_group(
        {
            "id": "group-a",
            "name": "Group A",
            "description": None,
            "owner": None,
            "services": ["svc-a"],
            "allowed_recipes": ["recipe-a", "recipe-c"],
            "guardrails": None,
        }
    )
    main.storage.insert_delivery_group(
        {
            "id": "group-b",
            "name": "Group B",
            "description": None,
            "owner": None,
            "services": ["svc-b"],
            "allowed_recipes": ["recipe-a", "recipe-c"],
            "guardrails": None,
        }
    )

    actor = main.Actor(actor_id="admin-1", role=main.Role.PLATFORM_ADMIN)
    scope, error = main._spinnaker_scope_for_actor(actor)

    assert error is None
    assert scope["apps"] == {"app-a", "app-c"}
    assert scope["pipelines"]["app-a"] == {"deploy-a", "rollback-a"}
    assert scope["pipelines"]["app-c"] == {"deploy-c", "rollback-c"}
