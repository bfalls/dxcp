MIGRATION_ID = "202602150900_backfill_environment_promotion_order"


def run(storage) -> None:
    groups = storage.list_delivery_groups()
    for group in groups:
        group_id = group.get("id")
        allowed = group.get("allowed_environments")
        if not group_id or not isinstance(allowed, list) or not allowed:
            continue

        for index, env_name in enumerate(allowed):
            if not isinstance(env_name, str):
                continue
            normalized_name = env_name.strip()
            if not normalized_name:
                continue

            env = storage.get_environment_for_group(normalized_name, group_id)
            if not env:
                continue

            desired_order = index + 1
            if env.get("promotion_order") == desired_order:
                continue

            env["promotion_order"] = desired_order
            storage.update_environment(env)
