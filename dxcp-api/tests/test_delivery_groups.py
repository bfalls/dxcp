import json
import os
import sys
from pathlib import Path

from contextlib import asynccontextmanager

import httpx
import pytest


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
    _write_service_registry(Path(os.environ["DXCP_SERVICE_REGISTRY_PATH"]))

    for module in ["main", "config", "storage", "policy", "idempotency", "rate_limit"]:
        if module in sys.modules:
            del sys.modules[module]

    import importlib

    main = importlib.import_module("main")
    return main


pytestmark = pytest.mark.anyio


@asynccontextmanager
async def _client(tmp_path: Path):
    main = _load_main(tmp_path)
    main.rate_limiter = main.RateLimiter()
    main.storage = main.build_storage()
    main.guardrails = main.Guardrails(main.storage)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=main.app),
        base_url="http://testserver",
    ) as client:
        yield client


async def test_delivery_groups_list_returns_default(tmp_path: Path):
    async with _client(tmp_path) as client:
        response = await client.get("/v1/delivery-groups")
    assert response.status_code == 200
    body = response.json()
    assert isinstance(body, list)
    assert body
    default = body[0]
    assert default["id"] == "default"
    assert "demo-service" in default["services"]


async def test_delivery_groups_get_by_id(tmp_path: Path):
    async with _client(tmp_path) as client:
        response = await client.get("/v1/delivery-groups/default")
    assert response.status_code == 200
    body = response.json()
    assert body["id"] == "default"
    assert "demo-service" in body["services"]


async def test_delivery_groups_unknown_returns_404(tmp_path: Path):
    async with _client(tmp_path) as client:
        response = await client.get("/v1/delivery-groups/unknown")
    assert response.status_code == 404
    body = response.json()
    assert body["code"] == "NOT_FOUND"
