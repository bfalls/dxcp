
import pytest

import rate_limit
from policy import PolicyError


def _freeze_time(monkeypatch, start: float):
    now = {"t": start}
    monkeypatch.setattr(rate_limit.time, "time", lambda: now["t"])
    return now


def _freeze_day(monkeypatch, day: str = "2026-02-09"):
    monkeypatch.setattr(rate_limit.time, "strftime", lambda _fmt, _gmt=None: day)
    monkeypatch.setattr(rate_limit.time, "gmtime", lambda: 0)


def test_minute_bucket_enforces_limit_and_resets(monkeypatch):
    monkeypatch.delenv("DXCP_DDB_TABLE", raising=False)
    limiter = rate_limit.RateLimiter()
    clock = _freeze_time(monkeypatch, 0)

    limiter._check_minute("client-1", 2)
    limiter._check_minute("client-1", 2)
    with pytest.raises(PolicyError) as exc:
        limiter._check_minute("client-1", 2)
    assert exc.value.code == "RATE_LIMITED"

    clock["t"] = 61
    limiter._check_minute("client-1", 2)


def test_minute_bucket_isolated_by_limit(monkeypatch):
    monkeypatch.delenv("DXCP_DDB_TABLE", raising=False)
    limiter = rate_limit.RateLimiter()
    _freeze_time(monkeypatch, 0)

    limiter._check_minute("client-2", 1)
    limiter._check_minute("client-2", 2)
    limiter._check_minute("client-2", 2)
    with pytest.raises(PolicyError) as exc:
        limiter._check_minute("client-2", 2)
    assert exc.value.code == "RATE_LIMITED"


def test_daily_quota_scoped_and_remaining(monkeypatch):
    monkeypatch.delenv("DXCP_DDB_TABLE", raising=False)
    limiter = rate_limit.RateLimiter()
    _freeze_day(monkeypatch)

    limiter._check_daily("scope-a", "deploy", 2)
    limiter._check_daily("scope-a", "deploy", 2)
    with pytest.raises(PolicyError) as exc:
        limiter._check_daily("scope-a", "deploy", 2)
    assert exc.value.code == "QUOTA_EXCEEDED"

    limiter._check_daily("scope-b", "deploy", 2)

    remaining = limiter.get_daily_remaining("scope-a", "deploy", 2)
    assert remaining == {"used": 2, "remaining": 0, "limit": 2}


def test_get_daily_remaining_clamps_negative_limit(monkeypatch):
    monkeypatch.delenv("DXCP_DDB_TABLE", raising=False)
    limiter = rate_limit.RateLimiter()
    _freeze_day(monkeypatch)

    limiter._check_daily("scope-a", "deploy", 1)
    remaining = limiter.get_daily_remaining("scope-a", "deploy", -5)
    assert remaining["limit"] == 0
    assert remaining["remaining"] == 0


def test_build_register_uses_runtime_quota_override(monkeypatch):
    monkeypatch.delenv("DXCP_DDB_TABLE", raising=False)
    limiter = rate_limit.RateLimiter()
    _freeze_day(monkeypatch)

    limiter.set_runtime_build_register_quota(1)
    limiter.check_mutate("ci-actor-1", "build_register")
    with pytest.raises(PolicyError) as exc:
        limiter.check_mutate("ci-actor-1", "build_register")
    assert exc.value.code == "QUOTA_EXCEEDED"


def test_live_refresh_falls_back_to_env_when_build_register_quota_missing(monkeypatch):
    class _FakeSSMClient:
        def get_parameters(self, Names, WithDecryption=True):
            return {
                "Parameters": [
                    {"Name": "/dxcp/config/read_rpm", "Value": "120"},
                    {"Name": "/dxcp/config/mutate_rpm", "Value": "20"},
                ]
            }

    class _FakeBoto3:
        def client(self, service_name: str, **kwargs):
            if service_name != "ssm":
                raise RuntimeError("unexpected client")
            return _FakeSSMClient()

    monkeypatch.setenv("DXCP_LAMBDA", "1")
    monkeypatch.setenv("DXCP_SSM_PREFIX", "/dxcp/config")
    monkeypatch.setenv("DXCP_DAILY_QUOTA_BUILD_REGISTER", "42")
    rate_limit.SETTINGS.ssm_prefix = "/dxcp/config"
    monkeypatch.setattr(rate_limit, "boto3", _FakeBoto3())
    monkeypatch.delenv("DXCP_DDB_TABLE", raising=False)
    limiter = rate_limit.RateLimiter()

    limits = limiter.get_live_throttling_settings()
    assert limits["read_rpm"] == 120
    assert limits["mutate_rpm"] == 20
    assert limits["daily_quota_build_register"] == 42
