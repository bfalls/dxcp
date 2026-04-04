MIGRATION_ID = "202604041000_normalize_legacy_environment_ids"


def run(storage) -> None:
    normalize = getattr(storage, "normalize_legacy_environment_identities", None)
    if callable(normalize):
        normalize()
