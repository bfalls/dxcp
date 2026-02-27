import json
import os
import sqlite3
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import List, Optional

from delivery_state import base_outcome_from_state, normalize_deployment_kind

try:
    import boto3
    from boto3.dynamodb.conditions import Attr, Key
    from botocore.exceptions import ClientError
except Exception:  # pragma: no cover - optional dependency for local mode
    boto3 = None
    Key = None
    Attr = None
    ClientError = None


def _read_ssm_parameter(name: str, cache: dict) -> Optional[str]:
    if name in cache:
        return cache[name]
    if not boto3:
        cache[name] = None
        return None
    try:
        client = boto3.client("ssm")
        response = client.get_parameter(Name=name)
        value = response.get("Parameter", {}).get("Value")
    except Exception:
        value = None
    cache[name] = value
    return value


def _resolve_ssm_template(value: Optional[str], cache: dict) -> Optional[str]:
    if not isinstance(value, str):
        return value
    if not value.startswith("ssm:"):
        return value
    name = value[len("ssm:") :]
    resolved = _read_ssm_parameter(name, cache)
    return resolved or value


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


DEFAULT_ENGINE_TYPE = "SPINNAKER"
TERMINAL_DEPLOYMENT_STATES = {"SUCCEEDED", "FAILED", "CANCELED", "ROLLED_BACK"}
TERMINAL_DEPLOYMENT_OUTCOMES = {"SUCCEEDED", "FAILED", "CANCELED", "ROLLED_BACK", "SUPERSEDED"}
PROTECTED_DEPLOYMENT_FIELDS = (
    "service",
    "environment",
    "recipeId",
    "version",
    "deploymentKind",
    "rollbackOf",
    "intentCorrelationId",
)


class ImmutableDeploymentError(Exception):
    def __init__(self, message: str = "Deployment records are immutable after creation") -> None:
        super().__init__(message)
        self.code = "IMMUTABLE_RECORD"
        self.status_code = 409


def _assert_protected_fields_unchanged(before: Optional[dict], after: Optional[dict]) -> None:
    if not before or not after:
        return
    for field in PROTECTED_DEPLOYMENT_FIELDS:
        if before.get(field) != after.get(field):
            raise ImmutableDeploymentError(f"Cannot change protected deployment field: {field}")


class Storage:
    def __init__(self, db_path: str, registry_path: str) -> None:
        self.db_path = db_path
        self.registry_path = registry_path
        self._init_db()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        conn = self._connect()
        cur = conn.cursor()
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS deployments (
                id TEXT PRIMARY KEY,
                service TEXT NOT NULL,
                environment TEXT NOT NULL,
                version TEXT NOT NULL,
                recipe_id TEXT,
                recipe_revision INTEGER,
                effective_behavior_summary TEXT,
                state TEXT NOT NULL,
                deployment_kind TEXT,
                outcome TEXT,
                intent_correlation_id TEXT,
                superseded_by TEXT,
                change_summary TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                engine_type TEXT,
                spinnaker_execution_id TEXT NOT NULL,
                spinnaker_execution_url TEXT NOT NULL,
                spinnaker_application TEXT,
                spinnaker_pipeline TEXT,
                rollback_of TEXT,
                source_environment TEXT,
                delivery_group_id TEXT
            )
            """
        )
        self._ensure_column(cur, "deployments", "deployment_kind", "TEXT")
        self._ensure_column(cur, "deployments", "outcome", "TEXT")
        self._ensure_column(cur, "deployments", "intent_correlation_id", "TEXT")
        self._ensure_column(cur, "deployments", "superseded_by", "TEXT")
        self._ensure_column(cur, "deployments", "rollback_of", "TEXT")
        self._ensure_column(cur, "deployments", "spinnaker_application", "TEXT")
        self._ensure_column(cur, "deployments", "spinnaker_pipeline", "TEXT")
        self._ensure_column(cur, "deployments", "delivery_group_id", "TEXT")
        self._ensure_column(cur, "deployments", "source_environment", "TEXT")
        self._ensure_column(cur, "deployments", "recipe_id", "TEXT")
        self._ensure_column(cur, "deployments", "recipe_revision", "INTEGER")
        self._ensure_column(cur, "deployments", "effective_behavior_summary", "TEXT")
        self._ensure_column(cur, "deployments", "engine_type", "TEXT")
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS failures (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                deployment_id TEXT NOT NULL,
                category TEXT NOT NULL,
                summary TEXT NOT NULL,
                detail TEXT,
                action_hint TEXT,
                observed_at TEXT NOT NULL
            )
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS build_upload_caps (
                id TEXT PRIMARY KEY,
                service TEXT NOT NULL,
                version TEXT NOT NULL,
                expected_size_bytes INTEGER NOT NULL,
                expected_sha256 TEXT NOT NULL,
                expected_content_type TEXT NOT NULL,
                token TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS builds (
                id TEXT PRIMARY KEY,
                service TEXT NOT NULL,
                version TEXT NOT NULL,
                artifact_ref TEXT NOT NULL,
                git_sha TEXT,
                git_branch TEXT,
                ci_publisher TEXT,
                ci_provider TEXT,
                ci_run_id TEXT,
                built_at TEXT,
                sha256 TEXT NOT NULL,
                size_bytes INTEGER NOT NULL,
                content_type TEXT NOT NULL,
                checksum_sha256 TEXT,
                repo TEXT,
                actor TEXT,
                registered_at TEXT NOT NULL
            )
            """
        )
        self._ensure_column(cur, "builds", "git_sha", "TEXT")
        self._ensure_column(cur, "builds", "git_branch", "TEXT")
        self._ensure_column(cur, "builds", "ci_publisher", "TEXT")
        self._ensure_column(cur, "builds", "ci_provider", "TEXT")
        self._ensure_column(cur, "builds", "ci_run_id", "TEXT")
        self._ensure_column(cur, "builds", "built_at", "TEXT")
        self._ensure_column(cur, "builds", "checksum_sha256", "TEXT")
        self._ensure_column(cur, "builds", "repo", "TEXT")
        self._ensure_column(cur, "builds", "actor", "TEXT")
        self._ensure_column(cur, "builds", "commit_url", "TEXT")
        self._ensure_column(cur, "builds", "run_url", "TEXT")
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS services (
                service_name TEXT PRIMARY KEY,
                allowed_environments TEXT NOT NULL,
                allowed_recipes TEXT NOT NULL,
                allowed_artifact_sources TEXT NOT NULL,
                stable_service_url_template TEXT
            )
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS delivery_groups (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT,
                owner TEXT,
                services TEXT NOT NULL,
                allowed_environments TEXT,
                allowed_recipes TEXT NOT NULL,
                guardrails TEXT,
                created_at TEXT,
                created_by TEXT,
                updated_at TEXT,
                updated_by TEXT,
                last_change_reason TEXT
            )
            """
        )
        self._ensure_column(cur, "delivery_groups", "created_at", "TEXT")
        self._ensure_column(cur, "delivery_groups", "created_by", "TEXT")
        self._ensure_column(cur, "delivery_groups", "updated_at", "TEXT")
        self._ensure_column(cur, "delivery_groups", "updated_by", "TEXT")
        self._ensure_column(cur, "delivery_groups", "last_change_reason", "TEXT")
        self._ensure_column(cur, "delivery_groups", "allowed_environments", "TEXT")
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS environments (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                display_name TEXT,
                type TEXT NOT NULL,
                promotion_order INTEGER,
                delivery_group_id TEXT NOT NULL,
                is_enabled INTEGER NOT NULL,
                guardrails TEXT,
                created_at TEXT,
                created_by TEXT,
                updated_at TEXT,
                updated_by TEXT,
                last_change_reason TEXT
            )
            """
        )
        self._ensure_column(cur, "environments", "display_name", "TEXT")
        self._ensure_column(cur, "environments", "promotion_order", "INTEGER")
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS recipes (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT,
                allowed_parameters TEXT NOT NULL,
                engine_type TEXT,
                spinnaker_application TEXT,
                deploy_pipeline TEXT,
                rollback_pipeline TEXT,
                recipe_revision INTEGER,
                effective_behavior_summary TEXT,
                status TEXT,
                created_at TEXT,
                created_by TEXT,
                updated_at TEXT,
                updated_by TEXT,
                last_change_reason TEXT
            )
            """
        )
        self._ensure_column(cur, "recipes", "status", "TEXT")
        self._ensure_column(cur, "recipes", "recipe_revision", "INTEGER")
        self._ensure_column(cur, "recipes", "effective_behavior_summary", "TEXT")
        self._ensure_column(cur, "recipes", "created_at", "TEXT")
        self._ensure_column(cur, "recipes", "created_by", "TEXT")
        self._ensure_column(cur, "recipes", "updated_at", "TEXT")
        self._ensure_column(cur, "recipes", "updated_by", "TEXT")
        self._ensure_column(cur, "recipes", "last_change_reason", "TEXT")
        self._ensure_column(cur, "recipes", "engine_type", "TEXT")
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS audit_events (
                event_id TEXT PRIMARY KEY,
                event_type TEXT NOT NULL,
                actor_id TEXT NOT NULL,
                actor_role TEXT NOT NULL,
                target_type TEXT NOT NULL,
                target_id TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                outcome TEXT NOT NULL,
                summary TEXT NOT NULL,
                delivery_group_id TEXT,
                service_name TEXT,
                environment TEXT
            )
            """
        )
        cur.execute("CREATE INDEX IF NOT EXISTS idx_audit_events_timestamp ON audit_events(timestamp)")
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS admin_environments (
                environment_id TEXT PRIMARY KEY,
                display_name TEXT NOT NULL,
                type TEXT NOT NULL,
                is_enabled INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS delivery_group_environment_policy (
                delivery_group_id TEXT NOT NULL,
                environment_id TEXT NOT NULL,
                is_enabled INTEGER NOT NULL,
                order_index INTEGER NOT NULL,
                PRIMARY KEY (delivery_group_id, environment_id)
            )
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS service_environment_routing (
                service_id TEXT NOT NULL,
                environment_id TEXT NOT NULL,
                recipe_id TEXT NOT NULL,
                PRIMARY KEY (service_id, environment_id)
            )
            """
        )
        cur.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_environments_environment_id ON admin_environments(environment_id)"
        )
        cur.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_dg_env_policy_unique ON delivery_group_environment_policy(delivery_group_id, environment_id)"
        )
        cur.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_service_env_routing_unique ON service_environment_routing(service_id, environment_id)"
        )
        conn.commit()
        conn.close()

    def _ensure_column(self, cur: sqlite3.Cursor, table: str, column: str, column_type: str) -> None:
        cur.execute(f"PRAGMA table_info({table})")
        columns = {row["name"] for row in cur.fetchall()}
        if column not in columns:
            cur.execute(f"ALTER TABLE {table} ADD COLUMN {column} {column_type}")

    def _read_registry(self) -> List[dict]:
        try:
            with open(self.registry_path, "r", encoding="utf-8") as handle:
                data = json.load(handle)
        except FileNotFoundError:
            return []
        if not isinstance(data, list):
            print("service registry invalid: root must be a list")
            return []
        valid = []
        for entry in data:
            if self._is_valid_service_entry(entry):
                valid.append(entry)
        return valid

    def _is_valid_service_entry(self, entry: dict) -> bool:
        if not isinstance(entry, dict):
            print("service registry invalid entry: not an object")
            return False
        name = entry.get("service_name")
        if not name or not isinstance(name, str):
            print("service registry invalid entry: missing service_name")
            return False
        allowed_envs = entry.get("allowed_environments")
        if allowed_envs is not None:
            if not isinstance(allowed_envs, list):
                print(f"service registry invalid entry for {name}: allowed_environments must be a list when provided")
                return False
            for env in allowed_envs:
                if not isinstance(env, str) or not env.strip():
                    print(f"service registry invalid entry for {name}: allowed_environments must be strings")
                    return False
        for field in ["allowed_recipes", "allowed_artifact_sources"]:
            value = entry.get(field, [])
            if not isinstance(value, list):
                print(f"service registry invalid entry for {name}: {field} must be a list")
                return False
        return True

    def list_services(self) -> List[dict]:
        data = self._read_registry()
        ssm_cache: dict = {}
        return sorted(
            [
                {
                    "service_name": entry.get("service_name"),
                    "allowed_environments": entry.get("allowed_environments", []),
                    "allowed_recipes": entry.get("allowed_recipes", []),
                    "allowed_artifact_sources": entry.get("allowed_artifact_sources", []),
                    "stable_service_url_template": _resolve_ssm_template(
                        entry.get("stable_service_url_template"),
                        ssm_cache,
                    ),
                    "backstage_entity_ref": entry.get("backstage_entity_ref"),
                    "backstage_entity_url": _resolve_ssm_template(
                        entry.get("backstage_entity_url_template"),
                        ssm_cache,
                    ),
                }
                for entry in data
                if entry.get("service_name")
            ],
            key=lambda item: item["service_name"],
        )

    def get_service(self, service_name: str) -> Optional[dict]:
        for entry in self.list_services():
            if entry["service_name"] == service_name:
                return entry
        return None

    def _has_delivery_groups(self) -> bool:
        conn = self._connect()
        cur = conn.cursor()
        cur.execute("SELECT id FROM delivery_groups LIMIT 1")
        row = cur.fetchone()
        conn.close()
        return row is not None

    def _serialize_json(self, value) -> Optional[str]:
        if value is None:
            return None
        return json.dumps(value)

    def _deserialize_json(self, value: Optional[str], default):
        if value is None:
            return default
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return default

    def insert_delivery_group(self, group: dict) -> dict:
        conn = self._connect()
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO delivery_groups (
                id, name, description, owner, services, allowed_environments, allowed_recipes, guardrails,
                created_at, created_by, updated_at, updated_by, last_change_reason
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                group["id"],
                group["name"],
                group.get("description"),
                group.get("owner"),
                self._serialize_json(group.get("services", [])),
                self._serialize_json(group.get("allowed_environments")),
                self._serialize_json(group.get("allowed_recipes", [])),
                self._serialize_json(group.get("guardrails")),
                group.get("created_at"),
                group.get("created_by"),
                group.get("updated_at"),
                group.get("updated_by"),
                group.get("last_change_reason"),
            ),
        )
        conn.commit()
        conn.close()
        self._ensure_group_environments(group)
        return group

    def update_delivery_group(self, group: dict) -> dict:
        conn = self._connect()
        cur = conn.cursor()
        cur.execute(
            """
            UPDATE delivery_groups
            SET name = ?, description = ?, owner = ?, services = ?, allowed_environments = ?, allowed_recipes = ?, guardrails = ?,
                created_at = ?, created_by = ?, updated_at = ?, updated_by = ?, last_change_reason = ?
            WHERE id = ?
            """,
            (
                group["name"],
                group.get("description"),
                group.get("owner"),
                self._serialize_json(group.get("services", [])),
                self._serialize_json(group.get("allowed_environments")),
                self._serialize_json(group.get("allowed_recipes", [])),
                self._serialize_json(group.get("guardrails")),
                group.get("created_at"),
                group.get("created_by"),
                group.get("updated_at"),
                group.get("updated_by"),
                group.get("last_change_reason"),
                group["id"],
            ),
        )
        conn.commit()
        conn.close()
        self._ensure_group_environments(group)
        return group

    def _derive_environment_type(self, name: str) -> str:
        return "prod" if name.lower() == "prod" else "non_prod"

    def _ensure_group_environments(self, group: dict) -> None:
        allowed = group.get("allowed_environments")
        if not isinstance(allowed, list):
            return
        now = utc_now()
        for index, env_name in enumerate(allowed):
            if not isinstance(env_name, str) or not env_name.strip():
                continue
            existing = self.get_environment_for_group(env_name, group["id"])
            if existing:
                continue
            self.insert_environment(
                {
                    "id": f"{group['id']}:{env_name}",
                    "name": env_name,
                    "type": self._derive_environment_type(env_name),
                    "display_name": None,
                    "promotion_order": index + 1,
                    "delivery_group_id": group["id"],
                    "is_enabled": True,
                    "guardrails": None,
                    "created_at": now,
                    "created_by": "system",
                    "updated_at": now,
                    "updated_by": "system",
                }
            )

    def _has_recipes(self) -> bool:
        conn = self._connect()
        cur = conn.cursor()
        cur.execute("SELECT id FROM recipes LIMIT 1")
        row = cur.fetchone()
        conn.close()
        return row is not None

    def insert_recipe(self, recipe: dict) -> dict:
        recipe_revision = recipe.get("recipe_revision") or 1
        effective_behavior_summary = recipe.get("effective_behavior_summary") or "No behavior summary provided."
        engine_type = recipe.get("engine_type") or DEFAULT_ENGINE_TYPE
        conn = self._connect()
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO recipes (
                id, name, description, allowed_parameters, engine_type,
                spinnaker_application, deploy_pipeline, rollback_pipeline, recipe_revision, effective_behavior_summary, status,
                created_at, created_by, updated_at, updated_by, last_change_reason
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                recipe["id"],
                recipe["name"],
                recipe.get("description"),
                self._serialize_json(recipe.get("allowed_parameters", [])),
                engine_type,
                recipe.get("spinnaker_application"),
                recipe.get("deploy_pipeline"),
                recipe.get("rollback_pipeline"),
                recipe_revision,
                effective_behavior_summary,
                recipe.get("status", "active"),
                recipe.get("created_at"),
                recipe.get("created_by"),
                recipe.get("updated_at"),
                recipe.get("updated_by"),
                recipe.get("last_change_reason"),
            ),
        )
        conn.commit()
        conn.close()
        recipe["recipe_revision"] = recipe_revision
        recipe["effective_behavior_summary"] = effective_behavior_summary
        recipe["engine_type"] = engine_type
        return recipe

    def insert_audit_event(self, event: dict) -> dict:
        conn = self._connect()
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO audit_events (
                event_id, event_type, actor_id, actor_role, target_type, target_id,
                timestamp, outcome, summary, delivery_group_id, service_name, environment
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                event["event_id"],
                event["event_type"],
                event["actor_id"],
                event["actor_role"],
                event["target_type"],
                event["target_id"],
                event["timestamp"],
                event["outcome"],
                event["summary"],
                event.get("delivery_group_id"),
                event.get("service_name"),
                event.get("environment"),
            ),
        )
        conn.commit()
        conn.close()
        return event

    def list_audit_events(
        self,
        event_type: Optional[str] = None,
        delivery_group_id: Optional[str] = None,
        start_time: Optional[str] = None,
        end_time: Optional[str] = None,
        limit: int = 200,
    ) -> List[dict]:
        clauses = []
        params = []
        if event_type:
            clauses.append("event_type = ?")
            params.append(event_type)
        if delivery_group_id:
            clauses.append("delivery_group_id = ?")
            params.append(delivery_group_id)
        if start_time:
            clauses.append("timestamp >= ?")
            params.append(start_time)
        if end_time:
            clauses.append("timestamp <= ?")
            params.append(end_time)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        sql = f"SELECT * FROM audit_events {where} ORDER BY timestamp DESC LIMIT ?"
        params.append(limit)
        conn = self._connect()
        cur = conn.cursor()
        cur.execute(sql, params)
        rows = cur.fetchall()
        conn.close()
        return [dict(row) for row in rows]

    def update_recipe(self, recipe: dict) -> dict:
        recipe_revision = recipe.get("recipe_revision") or 1
        effective_behavior_summary = recipe.get("effective_behavior_summary") or "No behavior summary provided."
        engine_type = recipe.get("engine_type") or DEFAULT_ENGINE_TYPE
        conn = self._connect()
        cur = conn.cursor()
        cur.execute(
            """
            UPDATE recipes
            SET name = ?, description = ?, allowed_parameters = ?, engine_type = ?,
                spinnaker_application = ?, deploy_pipeline = ?, rollback_pipeline = ?, recipe_revision = ?, effective_behavior_summary = ?, status = ?,
                created_at = ?, created_by = ?, updated_at = ?, updated_by = ?, last_change_reason = ?
            WHERE id = ?
            """,
            (
                recipe["name"],
                recipe.get("description"),
                self._serialize_json(recipe.get("allowed_parameters", [])),
                engine_type,
                recipe.get("spinnaker_application"),
                recipe.get("deploy_pipeline"),
                recipe.get("rollback_pipeline"),
                recipe_revision,
                effective_behavior_summary,
                recipe.get("status", "active"),
                recipe.get("created_at"),
                recipe.get("created_by"),
                recipe.get("updated_at"),
                recipe.get("updated_by"),
                recipe.get("last_change_reason"),
                recipe["id"],
            ),
        )
        conn.commit()
        conn.close()
        recipe["recipe_revision"] = recipe_revision
        recipe["effective_behavior_summary"] = effective_behavior_summary
        recipe["engine_type"] = engine_type
        return recipe

    def _row_to_recipe(self, row: sqlite3.Row) -> dict:
        recipe_revision = row["recipe_revision"] if row["recipe_revision"] is not None else 1
        effective_behavior_summary = row["effective_behavior_summary"] or "No behavior summary provided."
        return {
            "id": row["id"],
            "name": row["name"],
            "description": row["description"],
            "allowed_parameters": self._deserialize_json(row["allowed_parameters"], []),
            "engine_type": row["engine_type"] or DEFAULT_ENGINE_TYPE,
            "spinnaker_application": row["spinnaker_application"],
            "deploy_pipeline": row["deploy_pipeline"],
            "rollback_pipeline": row["rollback_pipeline"],
            "recipe_revision": recipe_revision,
            "effective_behavior_summary": effective_behavior_summary,
            "status": row["status"] or "active",
            "created_at": row["created_at"],
            "created_by": row["created_by"],
            "updated_at": row["updated_at"],
            "updated_by": row["updated_by"],
            "last_change_reason": row["last_change_reason"],
        }

    def list_recipes(self) -> List[dict]:
        conn = self._connect()
        cur = conn.cursor()
        cur.execute("SELECT * FROM recipes ORDER BY name ASC")
        rows = cur.fetchall()
        conn.close()
        return [self._row_to_recipe(row) for row in rows]

    def get_recipe(self, recipe_id: str) -> Optional[dict]:
        conn = self._connect()
        cur = conn.cursor()
        cur.execute("SELECT * FROM recipes WHERE id = ?", (recipe_id,))
        row = cur.fetchone()
        conn.close()
        if not row:
            return None
        return self._row_to_recipe(row)

    def _row_to_delivery_group(self, row: sqlite3.Row) -> dict:
        return {
            "id": row["id"],
            "name": row["name"],
            "description": row["description"],
            "owner": row["owner"],
            "services": self._deserialize_json(row["services"], []),
            "allowed_environments": self._deserialize_json(row["allowed_environments"], None),
            "allowed_recipes": self._deserialize_json(row["allowed_recipes"], []),
            "guardrails": self._deserialize_json(row["guardrails"], None),
            "created_at": row["created_at"],
            "created_by": row["created_by"],
            "updated_at": row["updated_at"],
            "updated_by": row["updated_by"],
            "last_change_reason": row["last_change_reason"],
        }

    def list_delivery_groups(self) -> List[dict]:
        conn = self._connect()
        cur = conn.cursor()
        cur.execute("SELECT * FROM delivery_groups ORDER BY name ASC")
        rows = cur.fetchall()
        conn.close()
        return [self._row_to_delivery_group(row) for row in rows]

    def get_delivery_group(self, group_id: str) -> Optional[dict]:
        conn = self._connect()
        cur = conn.cursor()
        cur.execute("SELECT * FROM delivery_groups WHERE id = ?", (group_id,))
        row = cur.fetchone()
        conn.close()
        if not row:
            return None
        return self._row_to_delivery_group(row)

    def get_delivery_group_for_service(self, service_name: str) -> Optional[dict]:
        for group in self.list_delivery_groups():
            services = group.get("services", [])
            if service_name in services:
                return group
        return None

    def _row_to_environment(self, row: sqlite3.Row) -> dict:
        return {
            "id": row["id"],
            "name": row["name"],
            "display_name": row["display_name"],
            "type": row["type"],
            "promotion_order": row["promotion_order"],
            "delivery_group_id": row["delivery_group_id"],
            "is_enabled": bool(row["is_enabled"]),
            "guardrails": self._deserialize_json(row["guardrails"], None),
            "created_at": row["created_at"],
            "created_by": row["created_by"],
            "updated_at": row["updated_at"],
            "updated_by": row["updated_by"],
            "last_change_reason": row["last_change_reason"],
        }

    def list_environments(self) -> List[dict]:
        conn = self._connect()
        cur = conn.cursor()
        cur.execute("SELECT * FROM environments ORDER BY name ASC")
        rows = cur.fetchall()
        conn.close()
        return [self._row_to_environment(row) for row in rows]

    def get_environment(self, environment_id: str) -> Optional[dict]:
        conn = self._connect()
        cur = conn.cursor()
        cur.execute("SELECT * FROM environments WHERE id = ?", (environment_id,))
        row = cur.fetchone()
        conn.close()
        if not row:
            return None
        return self._row_to_environment(row)

    def get_environment_for_group(self, name: str, delivery_group_id: str) -> Optional[dict]:
        conn = self._connect()
        cur = conn.cursor()
        cur.execute(
            "SELECT * FROM environments WHERE name = ? AND delivery_group_id = ?",
            (name, delivery_group_id),
        )
        row = cur.fetchone()
        conn.close()
        if not row:
            return None
        return self._row_to_environment(row)

    def insert_environment(self, environment: dict) -> dict:
        if self.get_environment(environment["id"]):
            return environment
        conn = self._connect()
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO environments (
                id, name, display_name, type, promotion_order, delivery_group_id, is_enabled, guardrails,
                created_at, created_by, updated_at, updated_by, last_change_reason
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                environment["id"],
                environment["name"],
                environment.get("display_name"),
                environment["type"],
                environment.get("promotion_order"),
                environment["delivery_group_id"],
                1 if environment.get("is_enabled", True) else 0,
                self._serialize_json(environment.get("guardrails")),
                environment.get("created_at"),
                environment.get("created_by"),
                environment.get("updated_at"),
                environment.get("updated_by"),
                environment.get("last_change_reason"),
            ),
        )
        conn.commit()
        conn.close()
        return environment

    def update_environment(self, environment: dict) -> dict:
        conn = self._connect()
        cur = conn.cursor()
        cur.execute(
            """
            UPDATE environments
            SET name = ?, display_name = ?, type = ?, promotion_order = ?, delivery_group_id = ?, is_enabled = ?, guardrails = ?,
                created_at = ?, created_by = ?, updated_at = ?, updated_by = ?, last_change_reason = ?
            WHERE id = ?
            """,
            (
                environment["name"],
                environment.get("display_name"),
                environment["type"],
                environment.get("promotion_order"),
                environment["delivery_group_id"],
                1 if environment.get("is_enabled", True) else 0,
                self._serialize_json(environment.get("guardrails")),
                environment.get("created_at"),
                environment.get("created_by"),
                environment.get("updated_at"),
                environment.get("updated_by"),
                environment.get("last_change_reason"),
                environment["id"],
            ),
        )
        conn.commit()
        conn.close()
        return environment

    def ensure_default_delivery_group(self) -> Optional[dict]:
        if self._has_delivery_groups():
            return None
        now = utc_now()
        services = [entry["service_name"] for entry in self.list_services() if entry.get("service_name")]
        group = {
            "id": "default",
            "name": "Default Delivery Group",
            "description": "Default group for allowlisted services",
            "owner": None,
            "services": services,
            "allowed_environments": None,
            "allowed_recipes": ["default", "canary", "bluegreen"],
            "guardrails": None,
            "created_at": now,
            "created_by": "system",
            "updated_at": now,
            "updated_by": "system",
        }
        return self.insert_delivery_group(group)

    def _has_environments(self) -> bool:
        conn = self._connect()
        cur = conn.cursor()
        cur.execute("SELECT id FROM environments LIMIT 1")
        row = cur.fetchone()
        conn.close()
        return row is not None

    def ensure_default_environments(self) -> List[dict]:
        if self._has_environments():
            return []
        now = utc_now()
        created = []
        for group in self.list_delivery_groups():
            configured = group.get("allowed_environments")
            env_names = configured if isinstance(configured, list) and configured else ["sandbox"]
            for index, env_name in enumerate(env_names):
                if not isinstance(env_name, str) or not env_name.strip():
                    continue
                env = {
                    "id": f"{group['id']}:{env_name}",
                    "name": env_name,
                    "display_name": None,
                    "type": self._derive_environment_type(env_name),
                    "promotion_order": index + 1,
                    "delivery_group_id": group["id"],
                    "is_enabled": True,
                    "guardrails": None,
                    "created_at": now,
                    "created_by": "system",
                    "updated_at": now,
                    "updated_by": "system",
                }
                self.insert_environment(env)
                created.append(env)
        return created

    def ensure_default_recipe(self) -> Optional[dict]:
        now = utc_now()
        recipes = [
            {
                "id": "default",
                "name": "Standard",
                "description": "Standard deploy recipe for demo deployments",
                "allowed_parameters": [],
                "engine_type": DEFAULT_ENGINE_TYPE,
                "spinnaker_application": "demo-app",
                "deploy_pipeline": "demo-deploy",
                "rollback_pipeline": "rollback-demo-service",
                "recipe_revision": 1,
                "effective_behavior_summary": "Standard roll-forward deploy with rollback support.",
                "status": "active",
                "created_at": now,
                "created_by": "system",
                "updated_at": now,
                "updated_by": "system",
            },
            {
                "id": "canary",
                "name": "Canary",
                "description": "Canary deploy recipe with automated verification.",
                "allowed_parameters": [],
                "engine_type": DEFAULT_ENGINE_TYPE,
                "spinnaker_application": "demo-app",
                "deploy_pipeline": "demo-deploy-canary",
                "rollback_pipeline": "rollback-demo-service",
                "recipe_revision": 1,
                "effective_behavior_summary": "Progressive rollout with verification and rollback on failed analysis.",
                "status": "active",
                "created_at": now,
                "created_by": "system",
                "updated_at": now,
                "updated_by": "system",
            },
            {
                "id": "bluegreen",
                "name": "BlueGreen",
                "description": "Blue/green deploy recipe with controlled cutover.",
                "allowed_parameters": [],
                "engine_type": DEFAULT_ENGINE_TYPE,
                "spinnaker_application": "demo-app",
                "deploy_pipeline": "demo-deploy-bluegreen",
                "rollback_pipeline": "rollback-demo-service",
                "recipe_revision": 1,
                "effective_behavior_summary": "Parallel rollout with cutover and rollback capability.",
                "status": "active",
                "created_at": now,
                "created_by": "system",
                "updated_at": now,
                "updated_by": "system",
            },
        ]
        created = None
        for recipe in recipes:
            if self.get_recipe(recipe["id"]):
                continue
            self.insert_recipe(recipe)
            if created is None:
                created = recipe
        return created

    def list_admin_environments(self) -> List[dict]:
        conn = self._connect()
        cur = conn.cursor()
        cur.execute("SELECT * FROM admin_environments ORDER BY environment_id ASC")
        rows = cur.fetchall()
        conn.close()
        return [
            {
                "environment_id": row["environment_id"],
                "display_name": row["display_name"],
                "type": row["type"],
                "is_enabled": bool(row["is_enabled"]),
                "created_at": row["created_at"],
                "updated_at": row["updated_at"],
            }
            for row in rows
        ]

    def get_admin_environment(self, environment_id: str) -> Optional[dict]:
        conn = self._connect()
        cur = conn.cursor()
        cur.execute(
            "SELECT * FROM admin_environments WHERE environment_id = ?",
            (environment_id,),
        )
        row = cur.fetchone()
        conn.close()
        if not row:
            return None
        return {
            "environment_id": row["environment_id"],
            "display_name": row["display_name"],
            "type": row["type"],
            "is_enabled": bool(row["is_enabled"]),
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }

    def insert_admin_environment(self, environment: dict) -> dict:
        conn = self._connect()
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO admin_environments (
                environment_id, display_name, type, is_enabled, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                environment["environment_id"],
                environment["display_name"],
                environment["type"],
                1 if environment.get("is_enabled", True) else 0,
                environment["created_at"],
                environment["updated_at"],
            ),
        )
        conn.commit()
        conn.close()
        return environment

    def update_admin_environment(self, environment: dict) -> dict:
        conn = self._connect()
        cur = conn.cursor()
        cur.execute(
            """
            UPDATE admin_environments
            SET display_name = ?, type = ?, is_enabled = ?, updated_at = ?
            WHERE environment_id = ?
            """,
            (
                environment["display_name"],
                environment["type"],
                1 if environment.get("is_enabled", True) else 0,
                environment["updated_at"],
                environment["environment_id"],
            ),
        )
        conn.commit()
        conn.close()
        return environment

    def list_delivery_group_environment_policy(self, delivery_group_id: str) -> List[dict]:
        conn = self._connect()
        cur = conn.cursor()
        cur.execute(
            """
            SELECT p.delivery_group_id, p.environment_id, p.is_enabled, p.order_index,
                   e.display_name, e.type
            FROM delivery_group_environment_policy p
            LEFT JOIN admin_environments e ON e.environment_id = p.environment_id
            WHERE p.delivery_group_id = ?
            ORDER BY p.order_index ASC, p.environment_id ASC
            """,
            (delivery_group_id,),
        )
        rows = cur.fetchall()
        conn.close()
        return [
            {
                "delivery_group_id": row["delivery_group_id"],
                "environment_id": row["environment_id"],
                "is_enabled": bool(row["is_enabled"]),
                "order_index": row["order_index"],
                "display_name": row["display_name"],
                "type": row["type"],
            }
            for row in rows
        ]

    def upsert_delivery_group_environment_policy(self, row: dict) -> dict:
        conn = self._connect()
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO delivery_group_environment_policy (
                delivery_group_id, environment_id, is_enabled, order_index
            ) VALUES (?, ?, ?, ?)
            ON CONFLICT(delivery_group_id, environment_id) DO UPDATE SET
                is_enabled = excluded.is_enabled,
                order_index = excluded.order_index
            """,
            (
                row["delivery_group_id"],
                row["environment_id"],
                1 if row.get("is_enabled", True) else 0,
                int(row["order_index"]),
            ),
        )
        conn.commit()
        conn.close()
        return row

    def list_service_environment_routing(self, service_id: str) -> List[dict]:
        conn = self._connect()
        cur = conn.cursor()
        cur.execute(
            """
            SELECT r.service_id, r.environment_id, r.recipe_id,
                   e.display_name, e.type
            FROM service_environment_routing r
            LEFT JOIN admin_environments e ON e.environment_id = r.environment_id
            WHERE r.service_id = ?
            ORDER BY r.environment_id ASC
            """,
            (service_id,),
        )
        rows = cur.fetchall()
        conn.close()
        return [
            {
                "service_id": row["service_id"],
                "environment_id": row["environment_id"],
                "recipe_id": row["recipe_id"],
                "display_name": row["display_name"],
                "type": row["type"],
            }
            for row in rows
        ]

    def upsert_service_environment_routing(self, row: dict) -> dict:
        conn = self._connect()
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO service_environment_routing (
                service_id, environment_id, recipe_id
            ) VALUES (?, ?, ?)
            ON CONFLICT(service_id, environment_id) DO UPDATE SET
                recipe_id = excluded.recipe_id
            """,
            (
                row["service_id"],
                row["environment_id"],
                row["recipe_id"],
            ),
        )
        conn.commit()
        conn.close()
        return row

    def has_active_deployment(self) -> bool:
        conn = self._connect()
        cur = conn.cursor()
        cur.execute(
            "SELECT id FROM deployments WHERE state IN (?, ?) LIMIT 1",
            ("ACTIVE", "IN_PROGRESS"),
        )
        row = cur.fetchone()
        conn.close()
        return row is not None

    def count_active_deployments_for_group(self, group_id: str, environment: Optional[str] = None) -> int:
        conn = self._connect()
        cur = conn.cursor()
        params = ["ACTIVE", "IN_PROGRESS", group_id]
        env_clause = ""
        if environment:
            env_clause = " AND environment = ?"
            params.append(environment)
        query = (
            "SELECT COUNT(1) AS total "
            "FROM deployments "
            "WHERE state IN (?, ?) AND delivery_group_id = ?"
            f"{env_clause}"
        )
        cur.execute(query, tuple(params))
        row = cur.fetchone()
        conn.close()
        return int(row["total"]) if row else 0

    def insert_deployment(self, record: dict, failures: List[dict]) -> None:
        deployment_kind = normalize_deployment_kind(
            record.get("deploymentKind"),
            record.get("rollbackOf"),
        )
        outcome = record.get("outcome")
        if outcome is None:
            outcome = base_outcome_from_state(record.get("state"))
        intent_correlation_id = record.get("intentCorrelationId")
        superseded_by = record.get("supersededBy")
        engine_type = record.get("engine_type") or DEFAULT_ENGINE_TYPE
        conn = self._connect()
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO deployments (
                id, service, environment, version, recipe_id, recipe_revision, effective_behavior_summary, state, deployment_kind, outcome,
                intent_correlation_id, superseded_by, change_summary, created_at, updated_at,
                engine_type, spinnaker_execution_id, spinnaker_execution_url, spinnaker_application, spinnaker_pipeline,
                rollback_of, source_environment, delivery_group_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                record["id"],
                record["service"],
                record["environment"],
                record["version"],
                record.get("recipeId"),
                record.get("recipeRevision"),
                record.get("effectiveBehaviorSummary"),
                record["state"],
                deployment_kind,
                outcome,
                intent_correlation_id,
                superseded_by,
                record["changeSummary"],
                record["createdAt"],
                record["updatedAt"],
                engine_type,
                record["spinnakerExecutionId"],
                record["spinnakerExecutionUrl"],
                record.get("spinnakerApplication"),
                record.get("spinnakerPipeline"),
                record.get("rollbackOf"),
                record.get("sourceEnvironment"),
                record.get("deliveryGroupId"),
            ),
        )
        self._replace_failures(cur, record["id"], failures)
        conn.commit()
        conn.close()
        record["deploymentKind"] = deployment_kind
        record["outcome"] = outcome
        record["intentCorrelationId"] = intent_correlation_id
        record["supersededBy"] = superseded_by
        record["engine_type"] = engine_type
        if outcome == "SUCCEEDED":
            self.apply_supersession(record)

    def update_deployment(
        self,
        deployment_id: str,
        state: str,
        failures: List[dict],
        outcome: Optional[str] = None,
        superseded_by: Optional[str] = None,
    ) -> None:
        existing = self.get_deployment(deployment_id)
        if existing:
            existing_state = existing.get("state")
            if existing_state in TERMINAL_DEPLOYMENT_STATES and state != existing_state:
                raise ImmutableDeploymentError("Cannot change terminal deployment state")
            if outcome is not None:
                existing_outcome = existing.get("outcome") or base_outcome_from_state(existing_state)
                if existing_outcome in TERMINAL_DEPLOYMENT_OUTCOMES and outcome != existing_outcome:
                    raise ImmutableDeploymentError("Cannot change terminal deployment outcome")
        conn = self._connect()
        cur = conn.cursor()
        updates = ["state = ?", "updated_at = ?"]
        params = [state, utc_now()]
        if outcome is not None:
            updates.append("outcome = ?")
            params.append(outcome)
        if superseded_by is not None:
            updates.append("superseded_by = ?")
            params.append(superseded_by)
        params.append(deployment_id)
        cur.execute(
            f"UPDATE deployments SET {', '.join(updates)} WHERE id = ?",
            tuple(params),
        )
        self._replace_failures(cur, deployment_id, failures)
        conn.commit()
        conn.close()
        current = self.get_deployment(deployment_id)
        _assert_protected_fields_unchanged(existing, current)

    def update_deployment_superseded_by(self, deployment_id: str, superseded_by: Optional[str]) -> None:
        existing = self.get_deployment(deployment_id)
        conn = self._connect()
        cur = conn.cursor()
        cur.execute(
            "UPDATE deployments SET superseded_by = ?, updated_at = ? WHERE id = ?",
            (superseded_by, utc_now(), deployment_id),
        )
        conn.commit()
        conn.close()
        current = self.get_deployment(deployment_id)
        _assert_protected_fields_unchanged(existing, current)

    def _replace_failures(self, cur: sqlite3.Cursor, deployment_id: str, failures: List[dict]) -> None:
        cur.execute("DELETE FROM failures WHERE deployment_id = ?", (deployment_id,))
        for failure in failures:
            cur.execute(
                """
                INSERT INTO failures (
                    deployment_id, category, summary, detail, action_hint, observed_at
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    deployment_id,
                    failure.get("category"),
                    failure.get("summary"),
                    failure.get("detail"),
                    failure.get("actionHint"),
                    failure.get("observedAt"),
                ),
            )

    def get_deployment(self, deployment_id: str) -> Optional[dict]:
        conn = self._connect()
        cur = conn.cursor()
        cur.execute("SELECT * FROM deployments WHERE id = ?", (deployment_id,))
        row = cur.fetchone()
        if not row:
            conn.close()
            return None
        failures = self._get_failures(cur, deployment_id)
        conn.close()
        return self._row_to_deployment(row, failures)

    def list_deployments(
        self,
        service: Optional[str],
        state: Optional[str],
        environment: Optional[str] = None,
    ) -> List[dict]:
        conn = self._connect()
        cur = conn.cursor()
        query = "SELECT * FROM deployments"
        params = []
        conditions = []
        if service:
            conditions.append("service = ?")
            params.append(service)
        if environment:
            conditions.append("environment = ?")
            params.append(environment)
        if state:
            conditions.append("state = ?")
            params.append(state)
        if conditions:
            query += " WHERE " + " AND ".join(conditions)
        query += " ORDER BY created_at DESC, id DESC"
        cur.execute(query, tuple(params))
        rows = cur.fetchall()
        deployments = []
        for row in rows:
            failures = self._get_failures(cur, row["id"])
            deployments.append(self._row_to_deployment(row, failures))
        conn.close()
        return deployments

    def _get_failures(self, cur: sqlite3.Cursor, deployment_id: str) -> List[dict]:
        cur.execute("SELECT * FROM failures WHERE deployment_id = ?", (deployment_id,))
        rows = cur.fetchall()
        failures = []
        for row in rows:
            failures.append(
                {
                    "category": row["category"],
                    "summary": row["summary"],
                    "detail": row["detail"],
                    "actionHint": row["action_hint"],
                    "observedAt": row["observed_at"],
                }
            )
        return failures

    def _row_to_deployment(self, row: sqlite3.Row, failures: List[dict]) -> dict:
        return {
            "id": row["id"],
            "service": row["service"],
            "environment": row["environment"],
            "version": row["version"],
            "recipeId": row["recipe_id"],
            "recipeRevision": row["recipe_revision"],
            "effectiveBehaviorSummary": row["effective_behavior_summary"],
            "state": row["state"],
            "deploymentKind": row["deployment_kind"],
            "outcome": row["outcome"],
            "intentCorrelationId": row["intent_correlation_id"],
            "supersededBy": row["superseded_by"],
            "changeSummary": row["change_summary"],
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
            "engine_type": row["engine_type"] or DEFAULT_ENGINE_TYPE,
            "spinnakerExecutionId": row["spinnaker_execution_id"],
            "spinnakerExecutionUrl": row["spinnaker_execution_url"],
            "spinnakerApplication": row["spinnaker_application"],
            "spinnakerPipeline": row["spinnaker_pipeline"],
            "rollbackOf": row["rollback_of"],
            "sourceEnvironment": row["source_environment"],
            "deliveryGroupId": row["delivery_group_id"],
            "failures": failures,
        }

    def apply_supersession(self, record: dict) -> None:
        if record.get("state") != "SUCCEEDED":
            return
        service = record.get("service")
        if not service:
            return
        environment = record.get("environment")
        deployments = self.list_deployments(service, None, environment)
        latest_success = None
        for deployment in deployments:
            if deployment.get("state") == "SUCCEEDED":
                latest_success = deployment
                break
        if not latest_success:
            return
        if latest_success.get("id") != record.get("id"):
            self.update_deployment_superseded_by(record["id"], latest_success.get("id"))
            return
        for deployment in deployments:
            if deployment.get("state") == "SUCCEEDED" and deployment.get("id") != record.get("id"):
                self.update_deployment_superseded_by(deployment["id"], record.get("id"))
                break

    def find_prior_successful_deployment(self, deployment_id: str) -> Optional[dict]:
        conn = self._connect()
        cur = conn.cursor()
        cur.execute("SELECT * FROM deployments WHERE id = ?", (deployment_id,))
        target = cur.fetchone()
        if not target:
            conn.close()
            return None
        cur.execute(
            """
            SELECT * FROM deployments
            WHERE service = ? AND environment = ? AND state = ? AND created_at < ?
            ORDER BY created_at DESC
            LIMIT 1
            """,
            (target["service"], target["environment"], "SUCCEEDED", target["created_at"]),
        )
        row = cur.fetchone()
        if not row:
            conn.close()
            return None
        failures = self._get_failures(cur, row["id"])
        conn.close()
        return self._row_to_deployment(row, failures)

    def insert_upload_capability(self, service: str, version: str, size_bytes: int, sha256: str, content_type: str, expires_at: str, token: str) -> dict:
        cap_id = str(uuid.uuid4())
        conn = self._connect()
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO build_upload_caps (
                id, service, version, expected_size_bytes, expected_sha256,
                expected_content_type, token, expires_at, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (cap_id, service, version, size_bytes, sha256, content_type, token, expires_at, utc_now()),
        )
        conn.commit()
        conn.close()
        return {
            "id": cap_id,
            "service": service,
            "version": version,
            "expectedSizeBytes": size_bytes,
            "expectedSha256": sha256,
            "expectedContentType": content_type,
            "expiresAt": expires_at,
            "token": token,
        }

    def find_upload_capability(self, service: str, version: str, size_bytes: int, sha256: str, content_type: str) -> Optional[dict]:
        conn = self._connect()
        cur = conn.cursor()
        cur.execute(
            """
            SELECT * FROM build_upload_caps
            WHERE service = ? AND version = ? AND expected_size_bytes = ?
              AND expected_sha256 = ? AND expected_content_type = ?
            """,
            (service, version, size_bytes, sha256, content_type),
        )
        row = cur.fetchone()
        conn.close()
        if not row:
            return None
        return {
            "id": row["id"],
            "expiresAt": row["expires_at"],
            "token": row["token"],
        }

    def delete_upload_capability(self, cap_id: str) -> None:
        conn = self._connect()
        cur = conn.cursor()
        cur.execute("DELETE FROM build_upload_caps WHERE id = ?", (cap_id,))
        conn.commit()
        conn.close()

    def insert_build(self, record: dict) -> dict:
        build_id = str(uuid.uuid4())
        conn = self._connect()
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO builds (
                id, service, version, artifact_ref, git_sha, git_branch, ci_publisher, ci_provider, ci_run_id, built_at,
                sha256, size_bytes, content_type, checksum_sha256, repo, actor, commit_url, run_url, registered_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                build_id,
                record["service"],
                record["version"],
                record["artifactRef"],
                record.get("git_sha"),
                record.get("git_branch"),
                record.get("ci_publisher"),
                record.get("ci_provider"),
                record.get("ci_run_id"),
                record.get("built_at"),
                record["sha256"],
                record["sizeBytes"],
                record["contentType"],
                record.get("checksum_sha256"),
                record.get("repo"),
                record.get("actor"),
                record.get("commit_url"),
                record.get("run_url"),
                record["registeredAt"],
            ),
        )
        conn.commit()
        conn.close()
        record["id"] = build_id
        return record

    def find_latest_build(self, service: str, version: str) -> Optional[dict]:
        conn = self._connect()
        cur = conn.cursor()
        cur.execute(
            """
            SELECT * FROM builds
            WHERE service = ? AND version = ?
            ORDER BY registered_at DESC
            LIMIT 1
            """,
            (service, version),
        )
        row = cur.fetchone()
        conn.close()
        if not row:
            return None
        return {
            "id": row["id"],
            "service": row["service"],
            "version": row["version"],
            "artifactRef": row["artifact_ref"],
            "git_sha": row["git_sha"],
            "git_branch": row["git_branch"],
            "ci_publisher": row["ci_publisher"],
            "ci_provider": row["ci_provider"],
            "ci_run_id": row["ci_run_id"],
            "built_at": row["built_at"],
            "sha256": row["sha256"],
            "sizeBytes": row["size_bytes"],
            "contentType": row["content_type"],
            "checksum_sha256": row["checksum_sha256"],
            "repo": row["repo"],
            "actor": row["actor"],
            "commit_url": row["commit_url"],
            "run_url": row["run_url"],
            "registeredAt": row["registered_at"],
        }

    def list_builds_for_service(self, service: str) -> List[dict]:
        conn = self._connect()
        cur = conn.cursor()
        cur.execute(
            """
            SELECT * FROM builds
            WHERE service = ?
            ORDER BY registered_at DESC
            """,
            (service,),
        )
        rows = cur.fetchall()
        conn.close()
        return [
            {
                "id": row["id"],
                "service": row["service"],
                "version": row["version"],
                "artifactRef": row["artifact_ref"],
                "git_sha": row["git_sha"],
                "git_branch": row["git_branch"],
                "ci_publisher": row["ci_publisher"],
                "ci_provider": row["ci_provider"],
                "ci_run_id": row["ci_run_id"],
                "built_at": row["built_at"],
                "sha256": row["sha256"],
                "sizeBytes": row["size_bytes"],
                "contentType": row["content_type"],
                "checksum_sha256": row["checksum_sha256"],
                "repo": row["repo"],
                "actor": row["actor"],
                "commit_url": row["commit_url"],
                "run_url": row["run_url"],
                "registeredAt": row["registered_at"],
            }
            for row in rows
        ]


class DynamoStorage:
    def __init__(self, table_name: str) -> None:
        if not boto3:
            raise RuntimeError("boto3 is required for DynamoDB storage")
        self.table = boto3.resource("dynamodb").Table(table_name)

    def _dec(self, value: int) -> Decimal:
        return Decimal(str(value))

    def list_services(self) -> List[dict]:
        response = self.table.query(KeyConditionExpression=Key("pk").eq("SERVICE"))
        items = response.get("Items", [])
        ssm_cache: dict = {}
        services = []
        for item in items:
            services.append(
                {
                    "service_name": item.get("service_name"),
                    "allowed_environments": item.get("allowed_environments", []),
                    "allowed_recipes": item.get("allowed_recipes", []),
                    "allowed_artifact_sources": item.get("allowed_artifact_sources", []),
                    "stable_service_url_template": _resolve_ssm_template(
                        item.get("stable_service_url_template"),
                        ssm_cache,
                    ),
                    "backstage_entity_ref": item.get("backstage_entity_ref"),
                    "backstage_entity_url": _resolve_ssm_template(
                        item.get("backstage_entity_url_template"),
                        ssm_cache,
                    ),
                }
            )
        return sorted([s for s in services if s.get("service_name")], key=lambda item: item["service_name"])

    def get_service(self, service_name: str) -> Optional[dict]:
        response = self.table.get_item(Key={"pk": "SERVICE", "sk": service_name})
        item = response.get("Item")
        if not item:
            return None
        return {
            "service_name": item.get("service_name"),
            "allowed_environments": item.get("allowed_environments", []),
            "allowed_recipes": item.get("allowed_recipes", []),
            "allowed_artifact_sources": item.get("allowed_artifact_sources", []),
            "stable_service_url_template": item.get("stable_service_url_template"),
            "backstage_entity_ref": item.get("backstage_entity_ref"),
            "backstage_entity_url": item.get("backstage_entity_url"),
        }

    def _scan_delivery_groups(self, limit: Optional[int] = None) -> List[dict]:
        params = {
            "FilterExpression": Attr("pk").eq("DELIVERY_GROUP"),
        }
        if limit:
            params["Limit"] = limit
        response = self.table.scan(**params)
        return response.get("Items", [])

    def list_delivery_groups(self) -> List[dict]:
        items = self._scan_delivery_groups()
        groups = []
        for item in items:
            groups.append(
                {
                    "id": item.get("id"),
                    "name": item.get("name"),
                    "description": item.get("description"),
                    "owner": item.get("owner"),
                    "services": item.get("services", []),
                    "allowed_environments": item.get("allowed_environments"),
                    "allowed_recipes": item.get("allowed_recipes", []),
                    "guardrails": item.get("guardrails"),
                    "created_at": item.get("created_at"),
                    "created_by": item.get("created_by"),
                    "updated_at": item.get("updated_at"),
                    "updated_by": item.get("updated_by"),
                    "last_change_reason": item.get("last_change_reason"),
                }
            )
        groups.sort(key=lambda g: g.get("name", ""))
        return groups

    def get_delivery_group(self, group_id: str) -> Optional[dict]:
        response = self.table.get_item(Key={"pk": "DELIVERY_GROUP", "sk": group_id})
        item = response.get("Item")
        if not item:
            return None
        return {
            "id": item.get("id"),
            "name": item.get("name"),
            "description": item.get("description"),
            "owner": item.get("owner"),
            "services": item.get("services", []),
            "allowed_environments": item.get("allowed_environments"),
            "allowed_recipes": item.get("allowed_recipes", []),
            "guardrails": item.get("guardrails"),
            "created_at": item.get("created_at"),
            "created_by": item.get("created_by"),
            "updated_at": item.get("updated_at"),
            "updated_by": item.get("updated_by"),
            "last_change_reason": item.get("last_change_reason"),
        }

    def get_delivery_group_for_service(self, service_name: str) -> Optional[dict]:
        for group in self.list_delivery_groups():
            services = group.get("services", [])
            if service_name in services:
                return group
        return None

    def _scan_environments(self, limit: Optional[int] = None) -> List[dict]:
        params = {
            "FilterExpression": Attr("pk").eq("ENVIRONMENT"),
        }
        if limit:
            params["Limit"] = limit
        response = self.table.scan(**params)
        return response.get("Items", [])

    def list_environments(self) -> List[dict]:
        items = self._scan_environments()
        environments = []
        for item in items:
            environments.append(
                {
                    "id": item.get("id"),
                    "name": item.get("name"),
                    "display_name": item.get("display_name"),
                    "type": item.get("type"),
                    "promotion_order": item.get("promotion_order"),
                    "delivery_group_id": item.get("delivery_group_id"),
                    "is_enabled": bool(item.get("is_enabled", True)),
                    "guardrails": item.get("guardrails"),
                    "created_at": item.get("created_at"),
                    "created_by": item.get("created_by"),
                    "updated_at": item.get("updated_at"),
                    "updated_by": item.get("updated_by"),
                    "last_change_reason": item.get("last_change_reason"),
                }
            )
        environments.sort(key=lambda env: env.get("name", ""))
        return environments

    def get_environment(self, environment_id: str) -> Optional[dict]:
        response = self.table.get_item(Key={"pk": "ENVIRONMENT", "sk": environment_id})
        item = response.get("Item")
        if not item:
            return None
        return {
            "id": item.get("id"),
            "name": item.get("name"),
            "display_name": item.get("display_name"),
            "type": item.get("type"),
            "promotion_order": item.get("promotion_order"),
            "delivery_group_id": item.get("delivery_group_id"),
            "is_enabled": bool(item.get("is_enabled", True)),
            "guardrails": item.get("guardrails"),
            "created_at": item.get("created_at"),
            "created_by": item.get("created_by"),
            "updated_at": item.get("updated_at"),
            "updated_by": item.get("updated_by"),
            "last_change_reason": item.get("last_change_reason"),
        }

    def get_environment_for_group(self, name: str, delivery_group_id: str) -> Optional[dict]:
        items = self._scan_environments()
        for item in items:
            if item.get("name") == name and item.get("delivery_group_id") == delivery_group_id:
                return {
                    "id": item.get("id"),
                    "name": item.get("name"),
                    "display_name": item.get("display_name"),
                    "type": item.get("type"),
                    "promotion_order": item.get("promotion_order"),
                    "delivery_group_id": item.get("delivery_group_id"),
                    "is_enabled": bool(item.get("is_enabled", True)),
                    "guardrails": item.get("guardrails"),
                    "created_at": item.get("created_at"),
                    "created_by": item.get("created_by"),
                    "updated_at": item.get("updated_at"),
                    "updated_by": item.get("updated_by"),
                    "last_change_reason": item.get("last_change_reason"),
                }
        return None

    def insert_environment(self, environment: dict) -> dict:
        if self.get_environment(environment["id"]):
            return environment
        item = {
            "pk": "ENVIRONMENT",
            "sk": environment["id"],
            "id": environment["id"],
            "name": environment["name"],
            "display_name": environment.get("display_name"),
            "type": environment["type"],
            "promotion_order": environment.get("promotion_order"),
            "delivery_group_id": environment["delivery_group_id"],
            "is_enabled": environment.get("is_enabled", True),
            "guardrails": environment.get("guardrails"),
            "created_at": environment.get("created_at"),
            "created_by": environment.get("created_by"),
            "updated_at": environment.get("updated_at"),
            "updated_by": environment.get("updated_by"),
            "last_change_reason": environment.get("last_change_reason"),
        }
        self.table.put_item(Item=item)
        return environment

    def update_environment(self, environment: dict) -> dict:
        item = {
            "pk": "ENVIRONMENT",
            "sk": environment["id"],
            "id": environment["id"],
            "name": environment["name"],
            "display_name": environment.get("display_name"),
            "type": environment["type"],
            "promotion_order": environment.get("promotion_order"),
            "delivery_group_id": environment["delivery_group_id"],
            "is_enabled": environment.get("is_enabled", True),
            "guardrails": environment.get("guardrails"),
            "created_at": environment.get("created_at"),
            "created_by": environment.get("created_by"),
            "updated_at": environment.get("updated_at"),
            "updated_by": environment.get("updated_by"),
            "last_change_reason": environment.get("last_change_reason"),
        }
        self.table.put_item(Item=item)
        return environment

    def list_admin_environments(self) -> List[dict]:
        response = self.table.scan(FilterExpression=Attr("pk").eq("ADMIN_ENVIRONMENT"))
        items = response.get("Items", [])
        rows = [
            {
                "environment_id": item.get("environment_id"),
                "display_name": item.get("display_name"),
                "type": item.get("type"),
                "is_enabled": bool(item.get("is_enabled", True)),
                "created_at": item.get("created_at"),
                "updated_at": item.get("updated_at"),
            }
            for item in items
        ]
        rows.sort(key=lambda row: row.get("environment_id", ""))
        return rows

    def get_admin_environment(self, environment_id: str) -> Optional[dict]:
        response = self.table.get_item(Key={"pk": "ADMIN_ENVIRONMENT", "sk": environment_id})
        item = response.get("Item")
        if not item:
            return None
        return {
            "environment_id": item.get("environment_id"),
            "display_name": item.get("display_name"),
            "type": item.get("type"),
            "is_enabled": bool(item.get("is_enabled", True)),
            "created_at": item.get("created_at"),
            "updated_at": item.get("updated_at"),
        }

    def insert_admin_environment(self, environment: dict) -> dict:
        item = {
            "pk": "ADMIN_ENVIRONMENT",
            "sk": environment["environment_id"],
            "environment_id": environment["environment_id"],
            "display_name": environment["display_name"],
            "type": environment["type"],
            "is_enabled": environment.get("is_enabled", True),
            "created_at": environment["created_at"],
            "updated_at": environment["updated_at"],
        }
        self.table.put_item(
            Item=item,
            ConditionExpression="attribute_not_exists(pk) AND attribute_not_exists(sk)",
        )
        return environment

    def update_admin_environment(self, environment: dict) -> dict:
        item = {
            "pk": "ADMIN_ENVIRONMENT",
            "sk": environment["environment_id"],
            "environment_id": environment["environment_id"],
            "display_name": environment["display_name"],
            "type": environment["type"],
            "is_enabled": environment.get("is_enabled", True),
            "created_at": environment.get("created_at"),
            "updated_at": environment["updated_at"],
        }
        self.table.put_item(Item=item)
        return environment

    def list_delivery_group_environment_policy(self, delivery_group_id: str) -> List[dict]:
        response = self.table.scan(
            FilterExpression=Attr("pk").eq("DG_ENV_POLICY") & Attr("delivery_group_id").eq(delivery_group_id)
        )
        items = response.get("Items", [])
        rows = []
        for item in items:
            env_id = item.get("environment_id")
            env = self.get_admin_environment(env_id) if env_id else None
            rows.append(
                {
                    "delivery_group_id": item.get("delivery_group_id"),
                    "environment_id": env_id,
                    "is_enabled": bool(item.get("is_enabled", True)),
                    "order_index": int(item.get("order_index", 0)),
                    "display_name": env.get("display_name") if env else None,
                    "type": env.get("type") if env else None,
                }
            )
        rows.sort(key=lambda row: (row.get("order_index", 0), row.get("environment_id", "")))
        return rows

    def upsert_delivery_group_environment_policy(self, row: dict) -> dict:
        item = {
            "pk": "DG_ENV_POLICY",
            "sk": f"{row['delivery_group_id']}#{row['environment_id']}",
            "delivery_group_id": row["delivery_group_id"],
            "environment_id": row["environment_id"],
            "is_enabled": row.get("is_enabled", True),
            "order_index": int(row["order_index"]),
        }
        self.table.put_item(Item=item)
        return row

    def list_service_environment_routing(self, service_id: str) -> List[dict]:
        response = self.table.scan(
            FilterExpression=Attr("pk").eq("SERVICE_ENV_ROUTING") & Attr("service_id").eq(service_id)
        )
        items = response.get("Items", [])
        rows = []
        for item in items:
            env_id = item.get("environment_id")
            env = self.get_admin_environment(env_id) if env_id else None
            rows.append(
                {
                    "service_id": item.get("service_id"),
                    "environment_id": env_id,
                    "recipe_id": item.get("recipe_id"),
                    "display_name": env.get("display_name") if env else None,
                    "type": env.get("type") if env else None,
                }
            )
        rows.sort(key=lambda row: row.get("environment_id", ""))
        return rows

    def upsert_service_environment_routing(self, row: dict) -> dict:
        item = {
            "pk": "SERVICE_ENV_ROUTING",
            "sk": f"{row['service_id']}#{row['environment_id']}",
            "service_id": row["service_id"],
            "environment_id": row["environment_id"],
            "recipe_id": row["recipe_id"],
        }
        self.table.put_item(Item=item)
        return row

    def insert_delivery_group(self, group: dict) -> dict:
        item = {
            "pk": "DELIVERY_GROUP",
            "sk": group["id"],
            "id": group["id"],
            "name": group["name"],
            "description": group.get("description"),
            "owner": group.get("owner"),
            "services": group.get("services", []),
            "allowed_environments": group.get("allowed_environments"),
            "allowed_recipes": group.get("allowed_recipes", []),
            "guardrails": group.get("guardrails"),
            "created_at": group.get("created_at"),
            "created_by": group.get("created_by"),
            "updated_at": group.get("updated_at"),
            "updated_by": group.get("updated_by"),
            "last_change_reason": group.get("last_change_reason"),
        }
        self.table.put_item(Item=item)
        self._ensure_group_environments(group)
        return group

    def update_delivery_group(self, group: dict) -> dict:
        item = {
            "pk": "DELIVERY_GROUP",
            "sk": group["id"],
            "id": group["id"],
            "name": group["name"],
            "description": group.get("description"),
            "owner": group.get("owner"),
            "services": group.get("services", []),
            "allowed_environments": group.get("allowed_environments"),
            "allowed_recipes": group.get("allowed_recipes", []),
            "guardrails": group.get("guardrails"),
            "created_at": group.get("created_at"),
            "created_by": group.get("created_by"),
            "updated_at": group.get("updated_at"),
            "updated_by": group.get("updated_by"),
            "last_change_reason": group.get("last_change_reason"),
        }
        self.table.put_item(Item=item)
        self._ensure_group_environments(group)
        return group

    def _derive_environment_type(self, name: str) -> str:
        return "prod" if str(name).lower() == "prod" else "non_prod"

    def _ensure_group_environments(self, group: dict) -> None:
        allowed = group.get("allowed_environments")
        if not isinstance(allowed, list):
            return
        now = utc_now()
        for index, env_name in enumerate(allowed):
            if not isinstance(env_name, str) or not env_name.strip():
                continue
            if self.get_environment_for_group(env_name, group["id"]):
                continue
            self.insert_environment(
                {
                    "id": f"{group['id']}:{env_name}",
                    "name": env_name,
                    "display_name": None,
                    "type": self._derive_environment_type(env_name),
                    "promotion_order": index + 1,
                    "delivery_group_id": group["id"],
                    "is_enabled": True,
                    "guardrails": None,
                    "created_at": now,
                    "created_by": "system",
                    "updated_at": now,
                    "updated_by": "system",
                }
            )

    def _scan_recipes(self, limit: Optional[int] = None) -> List[dict]:
        params = {
            "FilterExpression": Attr("pk").eq("RECIPE"),
        }
        if limit:
            params["Limit"] = limit
        response = self.table.scan(**params)
        return response.get("Items", [])

    def list_recipes(self) -> List[dict]:
        items = self._scan_recipes()
        recipes = []
        for item in items:
            recipe_revision = item.get("recipe_revision") or 1
            effective_behavior_summary = item.get("effective_behavior_summary") or "No behavior summary provided."
            recipes.append(
                {
                    "id": item.get("id"),
                    "name": item.get("name"),
                    "description": item.get("description"),
                    "allowed_parameters": item.get("allowed_parameters", []),
                    "engine_type": item.get("engine_type") or DEFAULT_ENGINE_TYPE,
                    "spinnaker_application": item.get("spinnaker_application"),
                    "deploy_pipeline": item.get("deploy_pipeline"),
                    "rollback_pipeline": item.get("rollback_pipeline"),
                    "recipe_revision": recipe_revision,
                    "effective_behavior_summary": effective_behavior_summary,
                    "status": item.get("status") or "active",
                    "created_at": item.get("created_at"),
                    "created_by": item.get("created_by"),
                    "updated_at": item.get("updated_at"),
                    "updated_by": item.get("updated_by"),
                    "last_change_reason": item.get("last_change_reason"),
                }
            )
        recipes.sort(key=lambda r: r.get("name", ""))
        return recipes

    def get_recipe(self, recipe_id: str) -> Optional[dict]:
        response = self.table.get_item(Key={"pk": "RECIPE", "sk": recipe_id})
        item = response.get("Item")
        if not item:
            return None
        recipe_revision = item.get("recipe_revision") or 1
        effective_behavior_summary = item.get("effective_behavior_summary") or "No behavior summary provided."
        return {
            "id": item.get("id"),
            "name": item.get("name"),
            "description": item.get("description"),
            "allowed_parameters": item.get("allowed_parameters", []),
            "engine_type": item.get("engine_type") or DEFAULT_ENGINE_TYPE,
            "spinnaker_application": item.get("spinnaker_application"),
            "deploy_pipeline": item.get("deploy_pipeline"),
            "rollback_pipeline": item.get("rollback_pipeline"),
            "recipe_revision": recipe_revision,
            "effective_behavior_summary": effective_behavior_summary,
            "status": item.get("status") or "active",
            "created_at": item.get("created_at"),
            "created_by": item.get("created_by"),
            "updated_at": item.get("updated_at"),
            "updated_by": item.get("updated_by"),
            "last_change_reason": item.get("last_change_reason"),
        }

    def insert_recipe(self, recipe: dict) -> dict:
        recipe_revision = recipe.get("recipe_revision") or 1
        effective_behavior_summary = recipe.get("effective_behavior_summary") or "No behavior summary provided."
        engine_type = recipe.get("engine_type") or DEFAULT_ENGINE_TYPE
        item = {
            "pk": "RECIPE",
            "sk": recipe["id"],
            "id": recipe["id"],
            "name": recipe["name"],
            "description": recipe.get("description"),
            "allowed_parameters": recipe.get("allowed_parameters", []),
            "engine_type": engine_type,
            "spinnaker_application": recipe.get("spinnaker_application"),
            "deploy_pipeline": recipe.get("deploy_pipeline"),
            "rollback_pipeline": recipe.get("rollback_pipeline"),
            "recipe_revision": recipe_revision,
            "effective_behavior_summary": effective_behavior_summary,
            "status": recipe.get("status", "active"),
            "created_at": recipe.get("created_at"),
            "created_by": recipe.get("created_by"),
            "updated_at": recipe.get("updated_at"),
            "updated_by": recipe.get("updated_by"),
            "last_change_reason": recipe.get("last_change_reason"),
        }
        self.table.put_item(Item=item)
        recipe["recipe_revision"] = recipe_revision
        recipe["effective_behavior_summary"] = effective_behavior_summary
        recipe["engine_type"] = engine_type
        return recipe

    def update_recipe(self, recipe: dict) -> dict:
        recipe_revision = recipe.get("recipe_revision") or 1
        effective_behavior_summary = recipe.get("effective_behavior_summary") or "No behavior summary provided."
        engine_type = recipe.get("engine_type") or DEFAULT_ENGINE_TYPE
        item = {
            "pk": "RECIPE",
            "sk": recipe["id"],
            "id": recipe["id"],
            "name": recipe["name"],
            "description": recipe.get("description"),
            "allowed_parameters": recipe.get("allowed_parameters", []),
            "engine_type": engine_type,
            "spinnaker_application": recipe.get("spinnaker_application"),
            "deploy_pipeline": recipe.get("deploy_pipeline"),
            "rollback_pipeline": recipe.get("rollback_pipeline"),
            "recipe_revision": recipe_revision,
            "effective_behavior_summary": effective_behavior_summary,
            "status": recipe.get("status", "active"),
            "created_at": recipe.get("created_at"),
            "created_by": recipe.get("created_by"),
            "updated_at": recipe.get("updated_at"),
            "updated_by": recipe.get("updated_by"),
            "last_change_reason": recipe.get("last_change_reason"),
        }
        self.table.put_item(Item=item)
        recipe["recipe_revision"] = recipe_revision
        recipe["effective_behavior_summary"] = effective_behavior_summary
        recipe["engine_type"] = engine_type
        return recipe

    def insert_audit_event(self, event: dict) -> dict:
        item = {
            "pk": "AUDIT_EVENT",
            "sk": f"{event['timestamp']}#{event['event_id']}",
            "event_id": event["event_id"],
            "event_type": event["event_type"],
            "actor_id": event["actor_id"],
            "actor_role": event["actor_role"],
            "target_type": event["target_type"],
            "target_id": event["target_id"],
            "timestamp": event["timestamp"],
            "outcome": event["outcome"],
            "summary": event["summary"],
            "delivery_group_id": event.get("delivery_group_id"),
            "service_name": event.get("service_name"),
            "environment": event.get("environment"),
        }
        self.table.put_item(Item=item)
        return event

    def list_audit_events(
        self,
        event_type: Optional[str] = None,
        delivery_group_id: Optional[str] = None,
        start_time: Optional[str] = None,
        end_time: Optional[str] = None,
        limit: int = 200,
    ) -> List[dict]:
        response = self.table.scan(FilterExpression=Attr("pk").eq("AUDIT_EVENT"))
        items = response.get("Items", [])
        filtered = []
        for item in items:
            if event_type and item.get("event_type") != event_type:
                continue
            if delivery_group_id and item.get("delivery_group_id") != delivery_group_id:
                continue
            ts = item.get("timestamp")
            if start_time and ts and ts < start_time:
                continue
            if end_time and ts and ts > end_time:
                continue
            filtered.append(item)
        filtered.sort(key=lambda entry: entry.get("timestamp", ""), reverse=True)
        return filtered[:limit]

    def ensure_default_delivery_group(self) -> Optional[dict]:
        try:
            existing = self.table.get_item(
                Key={"pk": "DELIVERY_GROUP", "sk": "default"},
                ConsistentRead=True,
            ).get("Item")
            if existing:
                return None
        except Exception:
            existing = self._scan_delivery_groups(limit=1)
            if existing:
                return None
        now = utc_now()
        services = [entry["service_name"] for entry in self.list_services() if entry.get("service_name")]
        group = {
            "id": "default",
            "name": "Default Delivery Group",
            "description": "Default group for allowlisted services",
            "owner": None,
            "services": services,
            "allowed_environments": None,
            "allowed_recipes": ["default", "canary", "bluegreen"],
            "guardrails": None,
            "created_at": now,
            "created_by": "system",
            "updated_at": now,
            "updated_by": "system",
        }
        item = {
            "pk": "DELIVERY_GROUP",
            "sk": group["id"],
            "id": group["id"],
            "name": group["name"],
            "description": group.get("description"),
            "owner": group.get("owner"),
            "services": group.get("services", []),
            "allowed_environments": group.get("allowed_environments"),
            "allowed_recipes": group.get("allowed_recipes", []),
            "guardrails": group.get("guardrails"),
            "created_at": group.get("created_at"),
            "created_by": group.get("created_by"),
            "updated_at": group.get("updated_at"),
            "updated_by": group.get("updated_by"),
            "last_change_reason": group.get("last_change_reason"),
        }
        try:
            self.table.put_item(
                Item=item,
                ConditionExpression="attribute_not_exists(pk) AND attribute_not_exists(sk)",
            )
        except Exception:
            return None
        return group

    def ensure_default_environments(self) -> List[dict]:
        try:
            existing = self.table.get_item(
                Key={"pk": "ENVIRONMENT", "sk": "default:sandbox"},
                ConsistentRead=True,
            ).get("Item")
            if existing:
                return []
        except Exception:
            existing = self._scan_environments(limit=1)
            if existing:
                return []
        now = utc_now()
        created = []
        for group in self.list_delivery_groups():
            configured = group.get("allowed_environments")
            env_names = configured if isinstance(configured, list) and configured else ["sandbox"]
            for index, env_name in enumerate(env_names):
                if not isinstance(env_name, str) or not env_name.strip():
                    continue
                env = {
                    "id": f"{group['id']}:{env_name}",
                    "name": env_name,
                    "display_name": None,
                    "type": self._derive_environment_type(env_name),
                    "promotion_order": index + 1,
                    "delivery_group_id": group["id"],
                    "is_enabled": True,
                    "guardrails": None,
                    "created_at": now,
                    "created_by": "system",
                    "updated_at": now,
                    "updated_by": "system",
                }
                self.insert_environment(env)
                created.append(env)
        return created

    def ensure_default_recipe(self) -> Optional[dict]:
        now = utc_now()
        recipes = [
            {
                "id": "default",
                "name": "Standard",
                "description": "Standard deploy recipe for demo deployments",
                "allowed_parameters": [],
                "engine_type": DEFAULT_ENGINE_TYPE,
                "spinnaker_application": "demo-app",
                "deploy_pipeline": "demo-deploy",
                "rollback_pipeline": "rollback-demo-service",
                "recipe_revision": 1,
                "effective_behavior_summary": "Standard roll-forward deploy with rollback support.",
                "status": "active",
                "created_at": now,
                "created_by": "system",
                "updated_at": now,
                "updated_by": "system",
            },
            {
                "id": "canary",
                "name": "Canary",
                "description": "Canary deploy recipe with automated verification.",
                "allowed_parameters": [],
                "engine_type": DEFAULT_ENGINE_TYPE,
                "spinnaker_application": "demo-app",
                "deploy_pipeline": "demo-deploy-canary",
                "rollback_pipeline": "rollback-demo-service",
                "recipe_revision": 1,
                "effective_behavior_summary": "Progressive rollout with verification and rollback on failed analysis.",
                "status": "active",
                "created_at": now,
                "created_by": "system",
                "updated_at": now,
                "updated_by": "system",
            },
            {
                "id": "bluegreen",
                "name": "BlueGreen",
                "description": "Blue/green deploy recipe with controlled cutover.",
                "allowed_parameters": [],
                "engine_type": DEFAULT_ENGINE_TYPE,
                "spinnaker_application": "demo-app",
                "deploy_pipeline": "demo-deploy-bluegreen",
                "rollback_pipeline": "rollback-demo-service",
                "recipe_revision": 1,
                "effective_behavior_summary": "Parallel rollout with cutover and rollback capability.",
                "status": "active",
                "created_at": now,
                "created_by": "system",
                "updated_at": now,
                "updated_by": "system",
            },
        ]
        created = None
        for recipe in recipes:
            if self.get_recipe(recipe["id"]):
                continue
            self.insert_recipe(recipe)
            if created is None:
                created = recipe
        return created

    def has_active_deployment(self) -> bool:
        response = self.table.scan(
            FilterExpression=Attr("pk").eq("DEPLOYMENT") & Attr("state").is_in(["ACTIVE", "IN_PROGRESS"]),
            Limit=1,
        )
        return response.get("Count", 0) > 0

    def count_active_deployments_for_group(self, group_id: str, environment: Optional[str] = None) -> int:
        filter_expression = (
            Attr("pk").eq("DEPLOYMENT")
            & Attr("state").is_in(["ACTIVE", "IN_PROGRESS"])
            & Attr("delivery_group_id").eq(group_id)
        )
        if environment:
            filter_expression = filter_expression & Attr("environment").eq(environment)
        response = self.table.scan(FilterExpression=filter_expression)
        return int(response.get("Count", 0))

    def insert_deployment(self, record: dict, failures: List[dict]) -> None:
        deployment_kind = normalize_deployment_kind(
            record.get("deploymentKind"),
            record.get("rollbackOf"),
        )
        outcome = record.get("outcome")
        if outcome is None:
            outcome = base_outcome_from_state(record.get("state"))
        intent_correlation_id = record.get("intentCorrelationId")
        superseded_by = record.get("supersededBy")
        engine_type = record.get("engine_type") or DEFAULT_ENGINE_TYPE
        item = {
            "pk": "DEPLOYMENT",
            "sk": record["id"],
            "id": record["id"],
            "service": record["service"],
            "environment": record["environment"],
            "version": record["version"],
            "recipeId": record.get("recipeId"),
            "recipeRevision": record.get("recipeRevision"),
            "effectiveBehaviorSummary": record.get("effectiveBehaviorSummary"),
            "state": record["state"],
            "deploymentKind": deployment_kind,
            "outcome": outcome,
            "intentCorrelationId": intent_correlation_id,
            "supersededBy": superseded_by,
            "changeSummary": record["changeSummary"],
            "createdAt": record["createdAt"],
            "updatedAt": record["updatedAt"],
            "engine_type": engine_type,
            "spinnakerExecutionId": record["spinnakerExecutionId"],
            "spinnakerExecutionUrl": record["spinnakerExecutionUrl"],
            "spinnakerApplication": record.get("spinnakerApplication"),
            "spinnakerPipeline": record.get("spinnakerPipeline"),
            "rollbackOf": record.get("rollbackOf"),
            "sourceEnvironment": record.get("sourceEnvironment"),
            "delivery_group_id": record.get("deliveryGroupId"),
            "failures": failures,
        }
        try:
            self.table.put_item(
                Item=item,
                ConditionExpression="attribute_not_exists(pk) AND attribute_not_exists(sk)",
            )
        except Exception as exc:
            if ClientError is not None and isinstance(exc, ClientError):
                error_code = (exc.response.get("Error") or {}).get("Code")
                if error_code == "ConditionalCheckFailedException":
                    raise ImmutableDeploymentError("Deployment record already exists and cannot be replaced") from exc
            raise
        record["deploymentKind"] = deployment_kind
        record["outcome"] = outcome
        record["intentCorrelationId"] = intent_correlation_id
        record["supersededBy"] = superseded_by
        record["engine_type"] = engine_type
        if outcome == "SUCCEEDED":
            self.apply_supersession(record)

    def update_deployment(
        self,
        deployment_id: str,
        state: str,
        failures: List[dict],
        outcome: Optional[str] = None,
        superseded_by: Optional[str] = None,
    ) -> None:
        existing = self.get_deployment(deployment_id)
        if existing:
            existing_state = existing.get("state")
            if existing_state in TERMINAL_DEPLOYMENT_STATES and state != existing_state:
                raise ImmutableDeploymentError("Cannot change terminal deployment state")
            if outcome is not None:
                existing_outcome = existing.get("outcome") or base_outcome_from_state(existing_state)
                if existing_outcome in TERMINAL_DEPLOYMENT_OUTCOMES and outcome != existing_outcome:
                    raise ImmutableDeploymentError("Cannot change terminal deployment outcome")
        updates = ["#state = :state", "updatedAt = :updatedAt", "failures = :failures"]
        values = {
            ":state": state,
            ":updatedAt": utc_now(),
            ":failures": failures,
        }
        names = {"#state": "state"}
        if outcome is not None:
            updates.append("outcome = :outcome")
            values[":outcome"] = outcome
        if superseded_by is not None:
            updates.append("supersededBy = :supersededBy")
            values[":supersededBy"] = superseded_by
        self.table.update_item(
            Key={"pk": "DEPLOYMENT", "sk": deployment_id},
            UpdateExpression=f"SET {', '.join(updates)}",
            ExpressionAttributeNames=names,
            ExpressionAttributeValues=values,
        )
        current = self.get_deployment(deployment_id)
        _assert_protected_fields_unchanged(existing, current)

    def update_deployment_superseded_by(self, deployment_id: str, superseded_by: Optional[str]) -> None:
        existing = self.get_deployment(deployment_id)
        self.table.update_item(
            Key={"pk": "DEPLOYMENT", "sk": deployment_id},
            UpdateExpression="SET supersededBy = :supersededBy, updatedAt = :updatedAt",
            ExpressionAttributeValues={
                ":supersededBy": superseded_by,
                ":updatedAt": utc_now(),
            },
        )
        current = self.get_deployment(deployment_id)
        _assert_protected_fields_unchanged(existing, current)

    def get_deployment(self, deployment_id: str) -> Optional[dict]:
        response = self.table.get_item(Key={"pk": "DEPLOYMENT", "sk": deployment_id})
        item = response.get("Item")
        if not item:
            return None
        return {
            "id": item.get("id"),
            "service": item.get("service"),
            "environment": item.get("environment"),
            "version": item.get("version"),
            "recipeId": item.get("recipeId"),
            "recipeRevision": item.get("recipeRevision"),
            "effectiveBehaviorSummary": item.get("effectiveBehaviorSummary"),
            "state": item.get("state"),
            "deploymentKind": item.get("deploymentKind"),
            "outcome": item.get("outcome"),
            "intentCorrelationId": item.get("intentCorrelationId"),
            "supersededBy": item.get("supersededBy"),
            "changeSummary": item.get("changeSummary"),
            "createdAt": item.get("createdAt"),
            "updatedAt": item.get("updatedAt"),
            "engine_type": item.get("engine_type") or DEFAULT_ENGINE_TYPE,
            "spinnakerExecutionId": item.get("spinnakerExecutionId"),
            "spinnakerExecutionUrl": item.get("spinnakerExecutionUrl"),
            "spinnakerApplication": item.get("spinnakerApplication"),
            "spinnakerPipeline": item.get("spinnakerPipeline"),
            "rollbackOf": item.get("rollbackOf"),
            "sourceEnvironment": item.get("sourceEnvironment"),
            "failures": item.get("failures", []),
        }

    def list_deployments(
        self,
        service: Optional[str],
        state: Optional[str],
        environment: Optional[str] = None,
    ) -> List[dict]:
        response = self.table.query(KeyConditionExpression=Key("pk").eq("DEPLOYMENT"))
        items = response.get("Items", [])
        deployments = []
        for item in items:
            if service and item.get("service") != service:
                continue
            if environment and item.get("environment") != environment:
                continue
            if state and item.get("state") != state:
                continue
            deployments.append(
                {
                    "id": item.get("id"),
                    "service": item.get("service"),
                    "environment": item.get("environment"),
                    "version": item.get("version"),
                    "recipeId": item.get("recipeId"),
                    "recipeRevision": item.get("recipeRevision"),
                    "effectiveBehaviorSummary": item.get("effectiveBehaviorSummary"),
                    "state": item.get("state"),
                    "deploymentKind": item.get("deploymentKind"),
                    "outcome": item.get("outcome"),
                    "intentCorrelationId": item.get("intentCorrelationId"),
                    "supersededBy": item.get("supersededBy"),
                    "changeSummary": item.get("changeSummary"),
                    "createdAt": item.get("createdAt"),
                    "updatedAt": item.get("updatedAt"),
                    "engine_type": item.get("engine_type") or DEFAULT_ENGINE_TYPE,
                    "spinnakerExecutionId": item.get("spinnakerExecutionId"),
                    "spinnakerExecutionUrl": item.get("spinnakerExecutionUrl"),
                    "spinnakerApplication": item.get("spinnakerApplication"),
                    "spinnakerPipeline": item.get("spinnakerPipeline"),
                    "rollbackOf": item.get("rollbackOf"),
                    "sourceEnvironment": item.get("sourceEnvironment"),
                    "failures": item.get("failures", []),
                }
            )
        deployments.sort(
            key=lambda d: (d.get("createdAt", ""), d.get("id", "")),
            reverse=True,
        )
        return deployments

    def apply_supersession(self, record: dict) -> None:
        if record.get("state") != "SUCCEEDED":
            return
        service = record.get("service")
        if not service:
            return
        environment = record.get("environment")
        deployments = self.list_deployments(service, None, environment)
        latest_success = None
        for deployment in deployments:
            if deployment.get("state") == "SUCCEEDED":
                latest_success = deployment
                break
        if not latest_success:
            return
        if latest_success.get("id") != record.get("id"):
            self.update_deployment_superseded_by(record["id"], latest_success.get("id"))
            return
        for deployment in deployments:
            if deployment.get("state") == "SUCCEEDED" and deployment.get("id") != record.get("id"):
                self.update_deployment_superseded_by(deployment["id"], record.get("id"))
                break

    def find_prior_successful_deployment(self, deployment_id: str) -> Optional[dict]:
        target = self.get_deployment(deployment_id)
        if not target:
            return None
        response = self.table.query(KeyConditionExpression=Key("pk").eq("DEPLOYMENT"))
        items = response.get("Items", [])
        candidates = []
        for item in items:
            if item.get("service") != target.get("service"):
                continue
            if item.get("environment") != target.get("environment"):
                continue
            if item.get("state") != "SUCCEEDED":
                continue
            created_at = item.get("createdAt", "")
            if created_at and target.get("createdAt") and created_at >= target.get("createdAt"):
                continue
            candidates.append(item)
        if not candidates:
            return None
        candidates.sort(key=lambda item: item.get("createdAt", ""), reverse=True)
        item = candidates[0]
        return {
            "id": item.get("id"),
            "service": item.get("service"),
            "environment": item.get("environment"),
            "version": item.get("version"),
            "recipeId": item.get("recipeId"),
            "recipeRevision": item.get("recipeRevision"),
            "effectiveBehaviorSummary": item.get("effectiveBehaviorSummary"),
            "state": item.get("state"),
            "deploymentKind": item.get("deploymentKind"),
            "outcome": item.get("outcome"),
            "intentCorrelationId": item.get("intentCorrelationId"),
            "supersededBy": item.get("supersededBy"),
            "changeSummary": item.get("changeSummary"),
            "createdAt": item.get("createdAt"),
            "updatedAt": item.get("updatedAt"),
            "spinnakerExecutionId": item.get("spinnakerExecutionId"),
            "spinnakerExecutionUrl": item.get("spinnakerExecutionUrl"),
            "spinnakerApplication": item.get("spinnakerApplication"),
            "spinnakerPipeline": item.get("spinnakerPipeline"),
            "rollbackOf": item.get("rollbackOf"),
            "failures": item.get("failures", []),
        }

    def insert_upload_capability(
        self,
        service: str,
        version: str,
        size_bytes: int,
        sha256: str,
        content_type: str,
        expires_at: str,
        token: str,
    ) -> dict:
        cap_id = str(uuid.uuid4())
        item = {
            "pk": "UPLOAD_CAPABILITY",
            "sk": cap_id,
            "id": cap_id,
            "service": service,
            "version": version,
            "expectedSizeBytes": self._dec(size_bytes),
            "expectedSha256": sha256,
            "expectedContentType": content_type,
            "token": token,
            "expiresAt": expires_at,
            "createdAt": utc_now(),
        }
        self.table.put_item(Item=item)
        return {
            "id": cap_id,
            "service": service,
            "version": version,
            "expectedSizeBytes": size_bytes,
            "expectedSha256": sha256,
            "expectedContentType": content_type,
            "expiresAt": expires_at,
            "token": token,
        }

    def find_upload_capability(
        self,
        service: str,
        version: str,
        size_bytes: int,
        sha256: str,
        content_type: str,
    ) -> Optional[dict]:
        response = self.table.scan(
            FilterExpression=Attr("pk").eq("UPLOAD_CAPABILITY")
            & Attr("service").eq(service)
            & Attr("version").eq(version)
            & Attr("expectedSizeBytes").eq(self._dec(size_bytes))
            & Attr("expectedSha256").eq(sha256)
            & Attr("expectedContentType").eq(content_type),
            Limit=1,
        )
        items = response.get("Items", [])
        if not items:
            return None
        item = items[0]
        return {
            "id": item.get("id"),
            "expiresAt": item.get("expiresAt"),
            "token": item.get("token"),
        }

    def delete_upload_capability(self, cap_id: str) -> None:
        self.table.delete_item(Key={"pk": "UPLOAD_CAPABILITY", "sk": cap_id})

    def insert_build(self, record: dict) -> dict:
        build_id = str(uuid.uuid4())
        item = {
            "pk": "BUILD",
            "sk": build_id,
            "id": build_id,
            "service": record["service"],
            "version": record["version"],
            "artifactRef": record["artifactRef"],
            "git_sha": record.get("git_sha"),
            "git_branch": record.get("git_branch"),
            "ci_publisher": record.get("ci_publisher"),
            "ci_provider": record.get("ci_provider"),
            "ci_run_id": record.get("ci_run_id"),
            "built_at": record.get("built_at"),
            "sha256": record["sha256"],
            "sizeBytes": self._dec(record["sizeBytes"]),
            "contentType": record["contentType"],
            "checksum_sha256": record.get("checksum_sha256"),
            "repo": record.get("repo"),
            "actor": record.get("actor"),
            "commit_url": record.get("commit_url"),
            "run_url": record.get("run_url"),
            "registeredAt": record["registeredAt"],
        }
        self.table.put_item(Item=item)
        record["id"] = build_id
        return record

    def find_latest_build(self, service: str, version: str) -> Optional[dict]:
        # TODO: Full table scan (1MB page limit); at scale this can miss the true latest build without pagination.
        # Replace before production with a GSI on (service, createdAt) or a monotonic sort key to enable Query.
        response = self.table.scan(
            FilterExpression=Attr("pk").eq("BUILD")
            & Attr("service").eq(service)
            & Attr("version").eq(version)
        )
        items = response.get("Items", [])
        if not items:
            return None
        items.sort(key=lambda item: item.get("registeredAt", ""), reverse=True)
        item = items[0]
        return {
            "id": item.get("id"),
            "service": item.get("service"),
            "version": item.get("version"),
            "artifactRef": item.get("artifactRef"),
            "git_sha": item.get("git_sha"),
            "git_branch": item.get("git_branch"),
            "ci_publisher": item.get("ci_publisher"),
            "ci_provider": item.get("ci_provider"),
            "ci_run_id": item.get("ci_run_id"),
            "built_at": item.get("built_at"),
            "sha256": item.get("sha256"),
            "sizeBytes": int(item.get("sizeBytes", 0)),
            "contentType": item.get("contentType"),
            "checksum_sha256": item.get("checksum_sha256"),
            "repo": item.get("repo"),
            "actor": item.get("actor"),
            "commit_url": item.get("commit_url"),
            "run_url": item.get("run_url"),
            "registeredAt": item.get("registeredAt"),
        }

    def list_builds_for_service(self, service: str) -> List[dict]:
        # TODO: Full table scan (1MB page limit); at scale this can miss results without pagination.
        response = self.table.scan(
            FilterExpression=Attr("pk").eq("BUILD") & Attr("service").eq(service)
        )
        items = response.get("Items", [])
        items.sort(key=lambda item: item.get("registeredAt", ""), reverse=True)
        return [
            {
                "id": item.get("id"),
                "service": item.get("service"),
                "version": item.get("version"),
                "artifactRef": item.get("artifactRef"),
                "git_sha": item.get("git_sha"),
                "git_branch": item.get("git_branch"),
                "ci_publisher": item.get("ci_publisher"),
                "ci_provider": item.get("ci_provider"),
                "ci_run_id": item.get("ci_run_id"),
                "built_at": item.get("built_at"),
                "sha256": item.get("sha256"),
                "sizeBytes": int(item.get("sizeBytes", 0)),
                "contentType": item.get("contentType"),
                "checksum_sha256": item.get("checksum_sha256"),
                "repo": item.get("repo"),
                "actor": item.get("actor"),
                "commit_url": item.get("commit_url"),
                "run_url": item.get("run_url"),
                "registeredAt": item.get("registeredAt"),
            }
            for item in items
        ]


def build_storage():
    table_name = os.getenv("DXCP_DDB_TABLE", "")
    if table_name:
        storage = DynamoStorage(table_name)
    else:
        storage = Storage(
            os.getenv("DXCP_DB_PATH", "./data/dxcp.db"),
            os.getenv("DXCP_SERVICE_REGISTRY_PATH", "./data/services.json"),
        )
    return storage
