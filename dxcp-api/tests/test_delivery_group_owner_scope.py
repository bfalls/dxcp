import json
import os
import sys
from pathlib import Path

import pytest

from auth_utils import configure_auth_env
from test_helpers import seed_defaults


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

    for module in ["main", "config", "storage", "policy", "idempotency", "rate_limit", "auth"]:
        if module in sys.modules:
            del sys.modules[module]

    import importlib

    return importlib.import_module("main")


pytestmark = [pytest.mark.anyio, pytest.mark.governance_contract]


def _seed_group(main, group_id: str, owner: str):
    main.storage.insert_delivery_group(
        {
            "id": group_id,
            "name": f"Group {group_id}",
            "description": None,
            "owner": owner,
            "services": ["demo-service"],
            "allowed_recipes": ["default"],
            "allowed_environments": ["sandbox"],
            "guardrails": None,
            "created_at": main.utc_now(),
            "created_by": "system",
            "updated_at": main.utc_now(),
            "updated_by": "system",
        }
    )


async def test_owner_scope_single_email_match(tmp_path: Path):
    main = _load_main(tmp_path)
    main.storage = main.build_storage()
    seed_defaults(main.storage)
    default = main.storage.get_delivery_group("default")
    if default:
        default["services"] = []
        default["owner"] = None
        main.storage.update_delivery_group(default)
    _seed_group(main, "group-a", "alice@example.com")

    actor = main.Actor(actor_id="user-1", role=main.Role.DELIVERY_OWNER, email="alice@example.com")
    groups = main._delivery_groups_for_actor(actor)
    assert {g["id"] for g in groups} == {"group-a"}


async def test_owner_scope_multiple_owner_emails_match(tmp_path: Path):
    main = _load_main(tmp_path)
    main.storage = main.build_storage()
    seed_defaults(main.storage)
    default = main.storage.get_delivery_group("default")
    if default:
        default["services"] = []
        default["owner"] = None
        main.storage.update_delivery_group(default)
    _seed_group(main, "group-a", "alice@example.com, bob@example.com")

    actor = main.Actor(actor_id="user-1", role=main.Role.DELIVERY_OWNER, email="bob@example.com")
    groups = main._delivery_groups_for_actor(actor)
    assert {g["id"] for g in groups} == {"group-a"}


async def test_owner_scope_case_insensitive_and_whitespace(tmp_path: Path):
    main = _load_main(tmp_path)
    main.storage = main.build_storage()
    seed_defaults(main.storage)
    default = main.storage.get_delivery_group("default")
    if default:
        default["services"] = []
        default["owner"] = None
        main.storage.update_delivery_group(default)
    _seed_group(main, "group-a", "  Alice@Example.com  ,  Team+ops@Example.COM  ")

    actor = main.Actor(actor_id="user-1", role=main.Role.DELIVERY_OWNER, email="team+ops@example.com")
    groups = main._delivery_groups_for_actor(actor)
    assert {g["id"] for g in groups} == {"group-a"}


async def test_owner_scope_ignores_empty_entries(tmp_path: Path):
    main = _load_main(tmp_path)
    main.storage = main.build_storage()
    seed_defaults(main.storage)
    default = main.storage.get_delivery_group("default")
    if default:
        default["services"] = []
        default["owner"] = None
        main.storage.update_delivery_group(default)
    _seed_group(main, "group-a", " , alice@example.com, , ")

    actor = main.Actor(actor_id="user-1", role=main.Role.DELIVERY_OWNER, email="alice@example.com")
    groups = main._delivery_groups_for_actor(actor)
    assert {g["id"] for g in groups} == {"group-a"}


async def test_owner_scope_missing_email_claim_returns_no_access(tmp_path: Path):
    main = _load_main(tmp_path)
    main.storage = main.build_storage()
    seed_defaults(main.storage)
    _seed_group(main, "group-a", "alice@example.com")

    actor = main.Actor(actor_id="user-1", role=main.Role.DELIVERY_OWNER, email=None)
    groups = main._delivery_groups_for_actor(actor)
    assert groups == []
