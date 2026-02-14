# DXCP Migrations

DXCP uses a lightweight, versioned migration framework for DynamoDB data changes
and backfills. Migrations are idempotent and run as part of `scripts/deploy_aws.sh`.

## When to Add a Migration

Add a migration for any change that requires:
- New default records or seed data (e.g., environments).
- Backfills for new fields or derived values.
- One-time data corrections.

Avoid running data changes at Lambda import or on first request.

## How to Add a Migration

1. Create a new file in `dxcp-api/migrations/`:
   - Filename format: `YYYYMMDDHHMM_<name>.py`
   - Include a unique `MIGRATION_ID` string.
   - Implement a `run(storage)` function.

2. Make the migration idempotent:
   - Check for existing data before writing.
   - Safe to re-run.

Example:

```python
MIGRATION_ID = "20260214_seed_defaults"

def run(storage) -> None:
    storage.ensure_default_delivery_group()
    storage.ensure_default_environments()
    storage.ensure_default_recipe()
```

## How Migrations Run

Migrations are executed automatically during deploy:
- `scripts/deploy_aws.sh` runs `scripts/run_migrations.py --table <table>`
- Applied migrations are recorded in DynamoDB with:
  - `pk = "MIGRATION"`
  - `sk = MIGRATION_ID`

## Manual Run (AWS)

If needed, run migrations manually:

```bash
python scripts/run_migrations.py --table <DxcpTableName>
```

You can get `<DxcpTableName>` from `cdk/cdk-outputs.json` after a deploy.

## Notes

- Migrations currently target DynamoDB (production).
- Local SQLite mode does not use the migration runner; keep local seed logic separate if needed.
