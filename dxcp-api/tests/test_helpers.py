def seed_defaults(storage) -> None:
    storage.ensure_default_delivery_group()
    storage.ensure_default_environments()
    storage.ensure_default_recipe()
    storage.ensure_default_service_environment_routing()
