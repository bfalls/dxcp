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
        cur.execute(
            "SELECT id FROM deployments WHERE state IN (?, ?) LIMIT 1",
            ("ACTIVE", "IN_PROGRESS"),
        )
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
        }

    def has_active_deployment(self) -> bool:
        response = self.table.scan(
            FilterExpression=Attr("pk").eq("DEPLOYMENT") & Attr("state").is_in(["ACTIVE", "IN_PROGRESS"]),
            Limit=1,
        )
        return response.get("Count", 0) > 0

    def insert_deployment(self, record: dict, failures: List[dict]) -> None:
        item = {
            "pk": "DEPLOYMENT",
            "sk": record["id"],
            "id": record["id"],
            "service": record["service"],
            "environment": record["environment"],
            "version": record["version"],
            "state": record["state"],
            "changeSummary": record["changeSummary"],
            "createdAt": record["createdAt"],
            "updatedAt": record["updatedAt"],
            "spinnakerExecutionId": record["spinnakerExecutionId"],
            "spinnakerExecutionUrl": record["spinnakerExecutionUrl"],
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
            "state": item.get("state"),
            "changeSummary": item.get("changeSummary"),
            "createdAt": item.get("createdAt"),
            "updatedAt": item.get("updatedAt"),
            "spinnakerExecutionId": item.get("spinnakerExecutionId"),
            "spinnakerExecutionUrl": item.get("spinnakerExecutionUrl"),
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
                    "state": item.get("state"),
                    "changeSummary": item.get("changeSummary"),
                    "createdAt": item.get("createdAt"),
                    "updatedAt": item.get("updatedAt"),
                    "spinnakerExecutionId": item.get("spinnakerExecutionId"),
                    "spinnakerExecutionUrl": item.get("spinnakerExecutionUrl"),
                    "failures": item.get("failures", []),
                }
            )
        deployments.sort(key=lambda d: d.get("createdAt", ""), reverse=True)
        return deployments

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
        return DynamoStorage(table_name)
    return Storage(
        os.getenv("DXCP_DB_PATH", "./data/dxcp.db"),
        os.getenv("DXCP_SERVICE_REGISTRY_PATH", "./data/services.json"),
    )
