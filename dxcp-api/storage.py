import json
import sqlite3
import uuid
from typing import List, Optional
from datetime import datetime, timezone


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
                state TEXT NOT NULL,
                change_summary TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                spinnaker_execution_id TEXT NOT NULL,
                spinnaker_execution_url TEXT NOT NULL
            )
            """
        )
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
        conn.commit()
        conn.close()

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
        return sorted(
            [
                {
                    "service_name": entry.get("service_name"),
                    "allowed_environments": entry.get("allowed_environments", []),
                    "allowed_recipes": entry.get("allowed_recipes", []),
                    "allowed_artifact_sources": entry.get("allowed_artifact_sources", []),
                    "stable_service_url_template": entry.get("stable_service_url_template"),
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

    def has_active_deployment(self) -> bool:
        conn = self._connect()
        cur = conn.cursor()
        cur.execute("SELECT id FROM deployments WHERE state = ? LIMIT 1", ("ACTIVE",))
        row = cur.fetchone()
        conn.close()
        return row is not None

    def insert_deployment(self, record: dict, failures: List[dict]) -> None:
        conn = self._connect()
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO deployments (
                id, service, environment, version, state, change_summary,
                created_at, updated_at, spinnaker_execution_id, spinnaker_execution_url
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                record["id"],
                record["service"],
                record["environment"],
                record["version"],
                record["state"],
                record["changeSummary"],
                record["createdAt"],
                record["updatedAt"],
                record["spinnakerExecutionId"],
                record["spinnakerExecutionUrl"],
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
        query += " ORDER BY created_at DESC"
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
            "state": row["state"],
            "changeSummary": row["change_summary"],
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
            "spinnakerExecutionId": row["spinnaker_execution_id"],
            "spinnakerExecutionUrl": row["spinnaker_execution_url"],
            "failures": failures,
        }

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
