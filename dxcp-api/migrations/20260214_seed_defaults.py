MIGRATION_ID = "20260214_seed_defaults"


def run(storage) -> None:
    storage.ensure_default_delivery_group()
    storage.ensure_default_environments()
    storage.ensure_default_recipe()
