MIGRATION_ID = "202602170900_add_build_ci_publisher"


def run(storage) -> None:
    # SQLite storage keeps build columns in the local DB.
    if not hasattr(storage, "_connect"):
        return
    conn = storage._connect()
    cur = conn.cursor()
    cur.execute("PRAGMA table_info(builds)")
    columns = {row["name"] for row in cur.fetchall()}
    if "ci_publisher" not in columns:
        cur.execute("ALTER TABLE builds ADD COLUMN ci_publisher TEXT")
        conn.commit()
    conn.close()
