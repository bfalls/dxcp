#!/usr/bin/env python3
import argparse
import json
import os
from decimal import Decimal

import boto3


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed DXCP service registry into DynamoDB")
    parser.add_argument("--table", required=True, help="DynamoDB table name")
    parser.add_argument(
        "--registry",
        default=os.path.join(os.path.dirname(__file__), "..", "dxcp-api", "data", "services.json"),
        help="Path to services.json",
    )
    args = parser.parse_args()

    with open(args.registry, "r", encoding="utf-8") as handle:
        entries = json.load(handle)

    table = boto3.resource("dynamodb").Table(args.table)
    with table.batch_writer() as batch:
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            name = entry.get("service_name")
            if not name:
                continue
            item = {
                "pk": "SERVICE",
                "sk": name,
                "service_name": name,
                "allowed_environments": entry.get("allowed_environments", []),
                "allowed_recipes": entry.get("allowed_recipes", []),
                "allowed_artifact_sources": entry.get("allowed_artifact_sources", []),
                "stable_service_url_template": entry.get("stable_service_url_template"),
            }
            batch.put_item(Item=item)


if __name__ == "__main__":
    main()
