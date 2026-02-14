#!/usr/bin/env python3
import argparse
import importlib.util
import os
import sys
from typing import List

import boto3
from boto3.dynamodb.conditions import Attr
from botocore.exceptions import ClientError

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
MIGRATIONS_DIR = os.path.join(ROOT_DIR, "dxcp-api", "migrations")

sys.path.insert(0, os.path.join(ROOT_DIR, "dxcp-api"))

from storage import DynamoStorage, utc_now  # noqa: E402


def discover_migrations() -> List[dict]:
    migrations = []
    if not os.path.isdir(MIGRATIONS_DIR):
        return migrations
    for filename in sorted(os.listdir(MIGRATIONS_DIR)):
        if not filename.endswith(".py"):
            continue
        if filename.startswith("_"):
            continue
        path = os.path.join(MIGRATIONS_DIR, filename)
        module_name = f"dxcp_migration_{os.path.splitext(filename)[0]}"
        spec = importlib.util.spec_from_file_location(module_name, path)
        if not spec or not spec.loader:
            continue
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        migration_id = getattr(module, "MIGRATION_ID", None)
        run_fn = getattr(module, "run", None)
        if not migration_id or not callable(run_fn):
            continue
        migrations.append({"id": migration_id, "run": run_fn, "path": path})
    return migrations


def get_applied_migrations(table) -> set:
    response = table.scan(FilterExpression=Attr("pk").eq("MIGRATION"))
    items = response.get("Items", [])
    return {item.get("sk") for item in items if item.get("sk")}


def record_migration(table, migration_id: str) -> bool:
    item = {
        "pk": "MIGRATION",
        "sk": migration_id,
        "migration_id": migration_id,
        "applied_at": utc_now(),
        "status": "applied",
    }
    try:
        table.put_item(
            Item=item,
            ConditionExpression="attribute_not_exists(pk) AND attribute_not_exists(sk)",
        )
        return True
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException":
            return False
        raise


def main() -> int:
    parser = argparse.ArgumentParser(description="Run DXCP DynamoDB migrations")
    parser.add_argument("--table", required=True, help="DynamoDB table name")
    args = parser.parse_args()

    table = boto3.resource("dynamodb").Table(args.table)
    storage = DynamoStorage(args.table)
    applied = get_applied_migrations(table)
    migrations = discover_migrations()

    if not migrations:
        print("No migrations found.")
        return 0

    ran = 0
    for migration in migrations:
        migration_id = migration["id"]
        if migration_id in applied:
            continue
        print(f"Running migration {migration_id}...")
        migration["run"](storage)
        record_migration(table, migration_id)
        ran += 1

    if ran == 0:
        print("No pending migrations.")
    else:
        print(f"Applied {ran} migration(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
