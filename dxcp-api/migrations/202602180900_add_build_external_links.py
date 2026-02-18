MIGRATION_ID = "202602180900_add_build_external_links"


def run(storage) -> None:
    # SQLite storage keeps build columns in the local DB.
    if not hasattr(storage, "_connect"):
        return
    conn = storage._connect()
    cur = conn.cursor()
    cur.execute("PRAGMA table_info(builds)")
    columns = {row["name"] for row in cur.fetchall()}
    if "commit_url" not in columns:
        cur.execute("ALTER TABLE builds ADD COLUMN commit_url TEXT")
    if "run_url" not in columns:
        cur.execute("ALTER TABLE builds ADD COLUMN run_url TEXT")
    conn.commit()
    conn.close()
