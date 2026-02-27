MIGRATION_ID = "202602270900_multi_environment_foundations"


def run(storage) -> None:
    # Dynamo and SQLite local modes share a single storage abstraction.
    # For SQLite we ensure the admin foundation tables exist.
    if not hasattr(storage, "_connect"):
        return

    conn = storage._connect()
    cur = conn.cursor()
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
