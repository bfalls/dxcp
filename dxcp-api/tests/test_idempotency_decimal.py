import json
import os
import sys
from decimal import Decimal
from pathlib import Path

import pytest


class _FakeDdbTable:
    def __init__(self) -> None:
        self.items = []

    def put_item(self, Item: dict) -> None:
        self.items.append(Item)


class _FakeDdbResource:
    def __init__(self, table: _FakeDdbTable) -> None:
        self._table = table

    def Table(self, _name: str) -> _FakeDdbTable:
        return self._table


def _load_idempotency_module(tmp_path: Path, monkeypatch):
    dxcp_api_dir = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(dxcp_api_dir))
    os.environ["DXCP_DB_PATH"] = str(tmp_path / "dxcp-test.db")
    os.environ["DXCP_SERVICE_REGISTRY_PATH"] = str(tmp_path / "services.json")
    os.environ["DXCP_DDB_TABLE"] = "dxcp-test-table"

    fake_table = _FakeDdbTable()
    fake_resource = _FakeDdbResource(fake_table)

    import boto3  # type: ignore

    monkeypatch.setattr(boto3, "resource", lambda *_args, **_kwargs: fake_resource)

    for module in ["idempotency", "config"]:
        if module in sys.modules:
            del sys.modules[module]

    import importlib

    return importlib.import_module("idempotency"), fake_table


def test_dynamodb_idempotency_set_serializes_decimal(tmp_path: Path, monkeypatch):
    module, fake_table = _load_idempotency_module(tmp_path, monkeypatch)
    store = module.IdempotencyStore()

    response = {
        "id": "dep-1",
        "recipeRevision": Decimal("1"),
        "quota": Decimal("10.5"),
    }
    store.set("key-1", response, 201)

    assert len(fake_table.items) == 1
    payload = fake_table.items[0]
    parsed = json.loads(payload["response"])
    assert parsed["recipeRevision"] == 1
    assert parsed["quota"] == 10.5
    assert payload["statusCode"] == Decimal(201)


@pytest.fixture(autouse=True)
def _cleanup_env():
    yield
    os.environ.pop("DXCP_DDB_TABLE", None)
