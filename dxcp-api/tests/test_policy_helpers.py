import pytest

from policy import Guardrails, PolicyError


class _FakeStorage:
    def __init__(self, active_by_group=None, global_active=False) -> None:
        self._active_by_group = active_by_group or {}
        self._global_active = global_active

    def count_active_deployments_for_group(self, group_id: str) -> int:
        return self._active_by_group.get(group_id, 0)

    def has_active_deployment(self) -> bool:
        return self._global_active


def test_delivery_group_lock_is_group_scoped_not_global():
    storage = _FakeStorage(active_by_group={"group-a": 0}, global_active=True)
    guardrails = Guardrails(storage)

    guardrails.enforce_delivery_group_lock("group-a", 1)

    with pytest.raises(PolicyError) as exc:
        guardrails.enforce_global_lock()
    assert exc.value.code == "CONCURRENCY_LIMIT_REACHED"


def test_delivery_group_lock_enforces_minimum_one():
    storage = _FakeStorage(active_by_group={"group-a": 1})
    guardrails = Guardrails(storage)

    with pytest.raises(PolicyError) as exc:
        guardrails.enforce_delivery_group_lock("group-a", 0)
    assert exc.value.code == "CONCURRENCY_LIMIT_REACHED"


def test_delivery_group_lock_allows_below_limit():
    storage = _FakeStorage(active_by_group={"group-a": 1})
    guardrails = Guardrails(storage)

    guardrails.enforce_delivery_group_lock("group-a", 2)
