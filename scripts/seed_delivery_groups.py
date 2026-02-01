import json
import os
import sys
from typing import List

from pathlib import Path


def _load_groups(path: Path) -> List[dict]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, list):
        raise ValueError("delivery group seed file must be a JSON list")
    return data


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: python scripts/seed_delivery_groups.py <groups.json>")
        return 1

    seed_path = Path(sys.argv[1])
    if not seed_path.exists():
        print(f"seed file not found: {seed_path}")
        return 1

    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "dxcp-api"))
    from storage import build_storage

    storage = build_storage()
    groups = _load_groups(seed_path)
    inserted = 0
    skipped = 0
    for group in groups:
        group_id = group.get("id")
        if not group_id:
            print("skipping group without id")
            skipped += 1
            continue
        if storage.get_delivery_group(group_id):
            skipped += 1
            continue
        storage.insert_delivery_group(group)
        inserted += 1

    print(f"delivery groups inserted={inserted} skipped={skipped}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
