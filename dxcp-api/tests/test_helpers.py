def seed_defaults(storage) -> None:
    storage.ensure_default_delivery_group()
    storage.ensure_default_environments()
    storage.ensure_default_recipe()
