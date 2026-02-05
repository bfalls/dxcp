import json
import os
import sqlite3
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import List, Optional

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
                state TEXT NOT NULL,
                change_summary TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                spinnaker_execution_id TEXT NOT NULL,
                spinnaker_execution_url TEXT NOT NULL,
                spinnaker_application TEXT,
                spinnaker_pipeline TEXT,
                rollback_of TEXT,
                delivery_group_id TEXT
            )
            """
        )
        self._ensure_column(cur, "deployments", "rollback_of", "TEXT")
        self._ensure_column(cur, "deployments", "spinnaker_application", "TEXT")
        self._ensure_column(cur, "deployments", "spinnaker_pipeline", "TEXT")
        self._ensure_column(cur, "deployments", "delivery_group_id", "TEXT")
        self._ensure_column(cur, "deployments", "recipe_id", "TEXT")
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
                sha256 TEXT NOT NULL,
                size_bytes INTEGER NOT NULL,
                content_type TEXT NOT NULL,
                registered_at TEXT NOT NULL
            )
            """
        )
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
            CREATE TABLE IF NOT EXISTS recipes (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT,
                allowed_parameters TEXT NOT NULL,
                spinnaker_application TEXT,
                deploy_pipeline TEXT,
                rollback_pipeline TEXT,
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
        self._ensure_column(cur, "recipes", "created_at", "TEXT")
        self._ensure_column(cur, "recipes", "created_by", "TEXT")
        self._ensure_column(cur, "recipes", "updated_at", "TEXT")
        self._ensure_column(cur, "recipes", "updated_by", "TEXT")
        self._ensure_column(cur, "recipes", "last_change_reason", "TEXT")
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
        allowed_envs = entry.get("allowed_environments", [])
        if not isinstance(allowed_envs, list) or "sandbox" not in allowed_envs:
            print(f"service registry invalid entry for {name}: allowed_environments must include sandbox")
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
        return group

    def _has_recipes(self) -> bool:
        conn = self._connect()
        cur = conn.cursor()
        cur.execute("SELECT id FROM recipes LIMIT 1")
        row = cur.fetchone()
        conn.close()
        return row is not None

    def insert_recipe(self, recipe: dict) -> dict:
        conn = self._connect()
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO recipes (
                id, name, description, allowed_parameters,
                spinnaker_application, deploy_pipeline, rollback_pipeline, status,
                created_at, created_by, updated_at, updated_by, last_change_reason
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                recipe["id"],
                recipe["name"],
                recipe.get("description"),
                self._serialize_json(recipe.get("allowed_parameters", [])),
                recipe.get("spinnaker_application"),
                recipe.get("deploy_pipeline"),
                recipe.get("rollback_pipeline"),
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
        conn = self._connect()
        cur = conn.cursor()
        cur.execute(
            """
            UPDATE recipes
            SET name = ?, description = ?, allowed_parameters = ?,
                spinnaker_application = ?, deploy_pipeline = ?, rollback_pipeline = ?, status = ?,
                created_at = ?, created_by = ?, updated_at = ?, updated_by = ?, last_change_reason = ?
            WHERE id = ?
            """,
            (
                recipe["name"],
                recipe.get("description"),
                self._serialize_json(recipe.get("allowed_parameters", [])),
                recipe.get("spinnaker_application"),
                recipe.get("deploy_pipeline"),
                recipe.get("rollback_pipeline"),
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
        return recipe

    def _row_to_recipe(self, row: sqlite3.Row) -> dict:
        return {
            "id": row["id"],
            "name": row["name"],
            "description": row["description"],
            "allowed_parameters": self._deserialize_json(row["allowed_parameters"], []),
            "spinnaker_application": row["spinnaker_application"],
            "deploy_pipeline": row["deploy_pipeline"],
            "rollback_pipeline": row["rollback_pipeline"],
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
            "allowed_recipes": ["default"],
            "guardrails": None,
            "created_at": now,
            "created_by": "system",
            "updated_at": now,
            "updated_by": "system",
        }
        return self.insert_delivery_group(group)

    def ensure_default_recipe(self) -> Optional[dict]:
        if self._has_recipes():
            return None
        now = utc_now()
        recipe = {
            "id": "default",
            "name": "Default Deploy",
            "description": "Default recipe for demo deployments",
            "allowed_parameters": [],
            "spinnaker_application": None,
            "deploy_pipeline": "demo-deploy",
            "rollback_pipeline": "rollback-demo-service",
            "status": "active",
            "created_at": now,
            "created_by": "system",
            "updated_at": now,
            "updated_by": "system",
        }
        return self.insert_recipe(recipe)

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

    def count_active_deployments_for_group(self, group_id: str) -> int:
        conn = self._connect()
        cur = conn.cursor()
        cur.execute(
            """
            SELECT COUNT(1) AS total
            FROM deployments
            WHERE state IN (?, ?) AND delivery_group_id = ?
            """,
            ("ACTIVE", "IN_PROGRESS", group_id),
        )
        row = cur.fetchone()
        conn.close()
        return int(row["total"]) if row else 0

    def insert_deployment(self, record: dict, failures: List[dict]) -> None:
        conn = self._connect()
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO deployments (
                id, service, environment, version, recipe_id, state, change_summary,
                created_at, updated_at, spinnaker_execution_id, spinnaker_execution_url,
                spinnaker_application, spinnaker_pipeline, rollback_of, delivery_group_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                record["id"],
                record["service"],
                record["environment"],
                record["version"],
                record.get("recipeId"),
                record["state"],
                record["changeSummary"],
                record["createdAt"],
                record["updatedAt"],
                record["spinnakerExecutionId"],
                record["spinnakerExecutionUrl"],
                record.get("spinnakerApplication"),
                record.get("spinnakerPipeline"),
                record.get("rollbackOf"),
                record.get("deliveryGroupId"),
            ),
        )
        self._replace_failures(cur, record["id"], failures)
        conn.commit()
        conn.close()

    def update_deployment(self, deployment_id: str, state: str, failures: List[dict]) -> None:
        conn = self._connect()
        cur = conn.cursor()
        cur.execute(
            "UPDATE deployments SET state = ?, updated_at = ? WHERE id = ?",
            (state, utc_now(), deployment_id),
        )
        self._replace_failures(cur, deployment_id, failures)
        conn.commit()
        conn.close()

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

    def list_deployments(self, service: Optional[str], state: Optional[str]) -> List[dict]:
        conn = self._connect()
        cur = conn.cursor()
        query = "SELECT * FROM deployments"
        params = []
        conditions = []
        if service:
            conditions.append("service = ?")
            params.append(service)
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
            "state": row["state"],
            "changeSummary": row["change_summary"],
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
            "spinnakerExecutionId": row["spinnaker_execution_id"],
            "spinnakerExecutionUrl": row["spinnaker_execution_url"],
            "spinnakerApplication": row["spinnaker_application"],
            "spinnakerPipeline": row["spinnaker_pipeline"],
            "rollbackOf": row["rollback_of"],
            "deliveryGroupId": row["delivery_group_id"],
            "failures": failures,
        }

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
                id, service, version, artifact_ref, sha256, size_bytes,
                content_type, registered_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                build_id,
                record["service"],
                record["version"],
                record["artifactRef"],
                record["sha256"],
                record["sizeBytes"],
                record["contentType"],
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
            "sha256": row["sha256"],
            "sizeBytes": row["size_bytes"],
            "contentType": row["content_type"],
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
                "sha256": row["sha256"],
                "sizeBytes": row["size_bytes"],
                "contentType": row["content_type"],
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
        return group

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
            recipes.append(
                {
                    "id": item.get("id"),
                    "name": item.get("name"),
                    "description": item.get("description"),
                    "allowed_parameters": item.get("allowed_parameters", []),
                    "spinnaker_application": item.get("spinnaker_application"),
                    "deploy_pipeline": item.get("deploy_pipeline"),
                    "rollback_pipeline": item.get("rollback_pipeline"),
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
        return {
            "id": item.get("id"),
            "name": item.get("name"),
            "description": item.get("description"),
            "allowed_parameters": item.get("allowed_parameters", []),
            "spinnaker_application": item.get("spinnaker_application"),
            "deploy_pipeline": item.get("deploy_pipeline"),
            "rollback_pipeline": item.get("rollback_pipeline"),
            "status": item.get("status") or "active",
            "created_at": item.get("created_at"),
            "created_by": item.get("created_by"),
            "updated_at": item.get("updated_at"),
            "updated_by": item.get("updated_by"),
            "last_change_reason": item.get("last_change_reason"),
        }

    def insert_recipe(self, recipe: dict) -> dict:
        item = {
            "pk": "RECIPE",
            "sk": recipe["id"],
            "id": recipe["id"],
            "name": recipe["name"],
            "description": recipe.get("description"),
            "allowed_parameters": recipe.get("allowed_parameters", []),
            "spinnaker_application": recipe.get("spinnaker_application"),
            "deploy_pipeline": recipe.get("deploy_pipeline"),
            "rollback_pipeline": recipe.get("rollback_pipeline"),
            "status": recipe.get("status", "active"),
            "created_at": recipe.get("created_at"),
            "created_by": recipe.get("created_by"),
            "updated_at": recipe.get("updated_at"),
            "updated_by": recipe.get("updated_by"),
            "last_change_reason": recipe.get("last_change_reason"),
        }
        self.table.put_item(Item=item)
        return recipe

    def update_recipe(self, recipe: dict) -> dict:
        item = {
            "pk": "RECIPE",
            "sk": recipe["id"],
            "id": recipe["id"],
            "name": recipe["name"],
            "description": recipe.get("description"),
            "allowed_parameters": recipe.get("allowed_parameters", []),
            "spinnaker_application": recipe.get("spinnaker_application"),
            "deploy_pipeline": recipe.get("deploy_pipeline"),
            "rollback_pipeline": recipe.get("rollback_pipeline"),
            "status": recipe.get("status", "active"),
            "created_at": recipe.get("created_at"),
            "created_by": recipe.get("created_by"),
            "updated_at": recipe.get("updated_at"),
            "updated_by": recipe.get("updated_by"),
            "last_change_reason": recipe.get("last_change_reason"),
        }
        self.table.put_item(Item=item)
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
            "allowed_recipes": ["default"],
            "guardrails": None,
            "created_at": now,
            "created_by": "system",
            "updated_at": now,
            "updated_by": "system",
        }
        return self.insert_delivery_group(group)

    def ensure_default_recipe(self) -> Optional[dict]:
        existing = self._scan_recipes(limit=1)
        if existing:
            return None
        now = utc_now()
        recipe = {
            "id": "default",
            "name": "Default Deploy",
            "description": "Default recipe for demo deployments",
            "allowed_parameters": [],
            "spinnaker_application": None,
            "deploy_pipeline": "demo-deploy",
            "rollback_pipeline": "rollback-demo-service",
            "status": "active",
            "created_at": now,
            "created_by": "system",
            "updated_at": now,
            "updated_by": "system",
        }
        return self.insert_recipe(recipe)

    def has_active_deployment(self) -> bool:
        response = self.table.scan(
            FilterExpression=Attr("pk").eq("DEPLOYMENT") & Attr("state").is_in(["ACTIVE", "IN_PROGRESS"]),
            Limit=1,
        )
        return response.get("Count", 0) > 0

    def count_active_deployments_for_group(self, group_id: str) -> int:
        response = self.table.scan(
            FilterExpression=Attr("pk").eq("DEPLOYMENT")
            & Attr("state").is_in(["ACTIVE", "IN_PROGRESS"])
            & Attr("delivery_group_id").eq(group_id)
        )
        return int(response.get("Count", 0))

    def insert_deployment(self, record: dict, failures: List[dict]) -> None:
        item = {
            "pk": "DEPLOYMENT",
            "sk": record["id"],
            "id": record["id"],
            "service": record["service"],
            "environment": record["environment"],
            "version": record["version"],
            "recipeId": record.get("recipeId"),
            "state": record["state"],
            "changeSummary": record["changeSummary"],
            "createdAt": record["createdAt"],
            "updatedAt": record["updatedAt"],
            "spinnakerExecutionId": record["spinnakerExecutionId"],
            "spinnakerExecutionUrl": record["spinnakerExecutionUrl"],
            "spinnakerApplication": record.get("spinnakerApplication"),
            "spinnakerPipeline": record.get("spinnakerPipeline"),
            "rollbackOf": record.get("rollbackOf"),
            "delivery_group_id": record.get("deliveryGroupId"),
            "failures": failures,
        }
        self.table.put_item(Item=item)

    def update_deployment(self, deployment_id: str, state: str, failures: List[dict]) -> None:
        self.table.update_item(
            Key={"pk": "DEPLOYMENT", "sk": deployment_id},
            UpdateExpression="SET #state = :state, updatedAt = :updatedAt, failures = :failures",
            ExpressionAttributeNames={"#state": "state"},
            ExpressionAttributeValues={
                ":state": state,
                ":updatedAt": utc_now(),
                ":failures": failures,
            },
        )

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
            "state": item.get("state"),
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

    def list_deployments(self, service: Optional[str], state: Optional[str]) -> List[dict]:
        response = self.table.query(KeyConditionExpression=Key("pk").eq("DEPLOYMENT"))
        items = response.get("Items", [])
        deployments = []
        for item in items:
            if service and item.get("service") != service:
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
                    "state": item.get("state"),
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
            )
        deployments.sort(
            key=lambda d: (d.get("createdAt", ""), d.get("id", "")),
            reverse=True,
        )
        return deployments

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
            "state": item.get("state"),
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
            "sha256": record["sha256"],
            "sizeBytes": self._dec(record["sizeBytes"]),
            "contentType": record["contentType"],
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
            "sha256": item.get("sha256"),
            "sizeBytes": int(item.get("sizeBytes", 0)),
            "contentType": item.get("contentType"),
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
                "sha256": item.get("sha256"),
                "sizeBytes": int(item.get("sizeBytes", 0)),
                "contentType": item.get("contentType"),
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
    storage.ensure_default_delivery_group()
    storage.ensure_default_recipe()
    return storage
