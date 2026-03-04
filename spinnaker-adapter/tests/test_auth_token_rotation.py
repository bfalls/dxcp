import json
import sys
from urllib.error import HTTPError
from pathlib import Path


def _adapter():
    root = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(root))
    from spinnaker_adapter.adapter import SpinnakerAdapter

    return SpinnakerAdapter(
        base_url="https://spinnaker.example.com/gate",
        mode="http",
        auth0_domain="dev.example.auth0.com",
        auth0_client_id="client-id",
        auth0_client_secret="client-secret",
        auth0_audience="https://spinnaker-gate",
    )


class _FakeResponse:
    def __init__(self, status: int, payload: dict):
        self.status = status
        self.headers = {}
        self._payload = payload

    def read(self) -> bytes:
        return json.dumps(self._payload).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return None


class _FakeOpener:
    def __init__(self, fn):
        self._fn = fn

    def open(self, request, timeout=None):
        return self._fn(request, timeout)


def test_mints_once_and_reuses_until_refresh(monkeypatch):
    adapter = _adapter()
    calls = {"token": 0, "api": 0}

    def fake_urlopen(request, timeout=None):
        url = request.full_url
        if url.endswith("/oauth/token"):
            calls["token"] += 1
            return _FakeResponse(200, {"access_token": "token-a", "expires_in": 3600})
        calls["api"] += 1
        return _FakeResponse(200, [])

    import spinnaker_adapter.adapter as adapter_module
    monkeypatch.setattr(adapter_module, "urlopen", fake_urlopen)
    monkeypatch.setattr(adapter_module, "build_opener", lambda *handlers: _FakeOpener(fake_urlopen))

    adapter.list_applications()
    adapter.list_applications()

    assert calls["token"] == 1
    assert calls["api"] == 2


def test_refreshes_after_expiry(monkeypatch):
    adapter = _adapter()
    adapter.auth0_refresh_skew_seconds = 0
    calls = {"token": 0}

    def fake_urlopen(request, timeout=None):
        url = request.full_url
        if url.endswith("/oauth/token"):
            calls["token"] += 1
            if calls["token"] == 1:
                return _FakeResponse(200, {"access_token": "token-a", "expires_in": 3600})
            return _FakeResponse(200, {"access_token": "token-b", "expires_in": 3600})
        return _FakeResponse(200, [])

    import spinnaker_adapter.adapter as adapter_module
    monkeypatch.setattr(adapter_module, "urlopen", fake_urlopen)
    monkeypatch.setattr(adapter_module, "build_opener", lambda *handlers: _FakeOpener(fake_urlopen))

    adapter.list_applications()
    adapter._cached_access_token_exp_epoch = int(__import__("time").time()) - 1
    adapter.list_applications()

    assert calls["token"] == 2


def test_no_auth_header_when_auth_not_configured(monkeypatch):
    adapter = _adapter()
    adapter.auth0_domain = ""
    adapter.auth0_client_id = ""
    adapter.auth0_client_secret = ""
    adapter.auth0_audience = ""

    def fake_urlopen(request, timeout=None):
        if request.full_url.endswith("/oauth/token"):
            return _FakeResponse(200, {"access_token": "unused", "expires_in": 3600})
        headers = dict((k.lower(), v) for k, v in request.header_items())
        assert "authorization" not in headers
        return _FakeResponse(200, [])

    import spinnaker_adapter.adapter as adapter_module
    monkeypatch.setattr(adapter_module, "urlopen", fake_urlopen)
    monkeypatch.setattr(adapter_module, "build_opener", lambda *handlers: _FakeOpener(fake_urlopen))

    adapter.list_applications()


def test_redirect_is_blocked(monkeypatch):
    adapter = _adapter()
    adapter._cached_access_token = "cached-token"
    adapter._cached_access_token_exp_epoch = 32503680000

    def fake_urlopen(request, timeout=None):
        raise HTTPError(
            url=request.full_url,
            code=302,
            msg="Found",
            hdrs={"Location": "https://auth.example.com/login"},
            fp=None,
        )

    import spinnaker_adapter.adapter as adapter_module
    monkeypatch.setattr(adapter_module, "build_opener", lambda *handlers: _FakeOpener(fake_urlopen))

    try:
        adapter.list_applications()
        raise AssertionError("expected RuntimeError")
    except RuntimeError as exc:
        assert "redirect blocked" in str(exc).lower()


def test_canonical_https_redirect_is_blocked(monkeypatch):
    adapter = _adapter()
    adapter._cached_access_token = "gate-token"
    adapter._cached_access_token_exp_epoch = 32503680000
    calls = {"count": 0, "urls": [], "methods": []}

    def fake_urlopen(request, timeout=None):
        calls["count"] += 1
        calls["urls"].append(request.full_url)
        calls["methods"].append(getattr(request, "get_method", lambda: "GET")())
        if calls["count"] == 1:
            raise HTTPError(
                url=request.full_url,
                code=302,
                msg="Found",
                hdrs={"Location": "https://spinnaker.example.com:9443/gate/applications?expand=true"},
                fp=None,
            )
        return _FakeResponse(200, [])

    import spinnaker_adapter.adapter as adapter_module
    monkeypatch.setattr(adapter_module, "build_opener", lambda *handlers: _FakeOpener(fake_urlopen))

    try:
        adapter.list_applications()
        raise AssertionError("expected RuntimeError")
    except RuntimeError as exc:
        assert "redirect blocked" in str(exc).lower()
        assert "redirect_class=gate_api" in str(exc)
    assert calls["count"] == 1
    assert calls["urls"] == ["https://spinnaker.example.com/gate/applications?expand=true"]
    assert calls["methods"] == ["GET"]


def test_oauth_redirect_is_not_retried(monkeypatch):
    adapter = _adapter()
    adapter._cached_access_token = "gate-token"
    adapter._cached_access_token_exp_epoch = 32503680000
    calls = {"count": 0}

    def fake_urlopen(request, timeout=None):
        calls["count"] += 1
        raise HTTPError(
            url=request.full_url,
            code=302,
            msg="Found",
            hdrs={"Location": "https://spinnaker.example.com/oauth2/authorization/gate"},
            fp=None,
        )

    import spinnaker_adapter.adapter as adapter_module
    monkeypatch.setattr(adapter_module, "build_opener", lambda *handlers: _FakeOpener(fake_urlopen))

    try:
        adapter.list_applications()
        raise AssertionError("expected RuntimeError")
    except RuntimeError as exc:
        assert "redirect blocked" in str(exc).lower()
        assert "redirect_class=oauth_login" in str(exc)
    assert calls["count"] == 1


def test_auth0_takes_precedence_over_explicit_header(monkeypatch):
    adapter = _adapter()
    adapter.header_name = "X-Legacy-Gate-Header"
    adapter.header_value = "legacy-static-token"
    observed = {"x-legacy-gate-header": "", "authorization": ""}

    def fake_urlopen(request, timeout=None):
        if request.full_url.endswith("/oauth/token"):
            return _FakeResponse(200, {"access_token": "minted-token", "expires_in": 3600})
        headers = dict((k.lower(), v) for k, v in request.header_items())
        observed["x-legacy-gate-header"] = headers.get("x-legacy-gate-header", "")
        observed["authorization"] = headers.get("authorization", "")
        return _FakeResponse(200, [])

    import spinnaker_adapter.adapter as adapter_module
    monkeypatch.setattr(adapter_module, "urlopen", fake_urlopen)
    monkeypatch.setattr(adapter_module, "build_opener", lambda *handlers: _FakeOpener(fake_urlopen))

    adapter.list_applications()
    assert observed["x-legacy-gate-header"] == "minted-token"
    assert observed["authorization"] == ""
    assert "legacy-static-token" not in observed["x-legacy-gate-header"]


def test_auth0_uses_authorization_header_by_default(monkeypatch):
    adapter = _adapter()
    observed = {"authorization": ""}

    def fake_urlopen(request, timeout=None):
        if request.full_url.endswith("/oauth/token"):
            return _FakeResponse(200, {"access_token": "minted-token", "expires_in": 3600})
        headers = dict((k.lower(), v) for k, v in request.header_items())
        observed["authorization"] = headers.get("authorization", "")
        return _FakeResponse(200, [])

    import spinnaker_adapter.adapter as adapter_module
    monkeypatch.setattr(adapter_module, "urlopen", fake_urlopen)
    monkeypatch.setattr(adapter_module, "build_opener", lambda *handlers: _FakeOpener(fake_urlopen))

    adapter.list_applications()
    assert observed["authorization"] == "Bearer minted-token"


def test_mutating_request_sets_spinnaker_user_from_bearer_sub(monkeypatch):
    adapter = _adapter()
    jwt_payload = {"sub": "svc-client@clients", "exp": 32503680000}
    jwt_token = ".".join(
        [
            "eyJhbGciOiJub25lIn0",
            __import__("base64").urlsafe_b64encode(json.dumps(jwt_payload).encode("utf-8")).decode("ascii").rstrip("="),
            "",
        ]
    )
    adapter._cached_access_token = jwt_token
    adapter._cached_access_token_exp_epoch = 32503680000
    seen = {}

    def fake_urlopen(request, timeout=None):
        seen.update(dict((k.lower(), v) for k, v in request.header_items()))
        return _FakeResponse(200, {"id": "exec-1"})

    import spinnaker_adapter.adapter as adapter_module
    monkeypatch.setattr(adapter_module, "build_opener", lambda *handlers: _FakeOpener(fake_urlopen))
    adapter._request_json(
        "POST",
        "https://spinnaker.example.com/pipelines/app/pipeline",
        body={"type": "manual"},
        operation="test_mutating",
    )
    assert seen.get("x-spinnaker-user") == "svc-client@clients"


def test_read_request_sets_spinnaker_user_from_user_bearer(monkeypatch):
    adapter = _adapter()
    adapter.auth0_domain = ""
    adapter.auth0_client_id = ""
    adapter.auth0_client_secret = ""
    adapter.auth0_audience = ""
    jwt_payload = {"email": "owner@example.com", "sub": "auth0|owner-1", "exp": 32503680000}
    user_token = ".".join(
        [
            "eyJhbGciOiJub25lIn0",
            __import__("base64").urlsafe_b64encode(json.dumps(jwt_payload).encode("utf-8")).decode("ascii").rstrip("="),
            "",
        ]
    )
    seen = {}

    def fake_urlopen(request, timeout=None):
        seen.update(dict((k.lower(), v) for k, v in request.header_items()))
        return _FakeResponse(200, [])

    import spinnaker_adapter.adapter as adapter_module
    monkeypatch.setattr(adapter_module, "urlopen", fake_urlopen)
    monkeypatch.setattr(adapter_module, "build_opener", lambda *handlers: _FakeOpener(fake_urlopen))

    adapter.list_applications(user_bearer_token=user_token)
    assert seen.get("x-spinnaker-user") == "owner@example.com"


def test_user_bearer_token_does_not_override_machine_authorization_header(monkeypatch):
    adapter = _adapter()
    observed = {"authorization": ""}

    def fake_urlopen(request, timeout=None):
        if request.full_url.endswith("/oauth/token"):
            return _FakeResponse(200, {"access_token": "minted-token", "expires_in": 3600})
        headers = dict((k.lower(), v) for k, v in request.header_items())
        observed["authorization"] = headers.get("authorization", "")
        return _FakeResponse(200, [])

    import spinnaker_adapter.adapter as adapter_module
    monkeypatch.setattr(adapter_module, "urlopen", fake_urlopen)
    monkeypatch.setattr(adapter_module, "build_opener", lambda *handlers: _FakeOpener(fake_urlopen))

    adapter.list_applications(user_bearer_token="user-token")
    assert observed["authorization"] == "Bearer minted-token"


def test_user_bearer_token_preserves_custom_header(monkeypatch):
    adapter = _adapter()
    adapter.auth0_domain = ""
    adapter.auth0_client_id = ""
    adapter.auth0_client_secret = ""
    adapter.auth0_audience = ""
    adapter.header_name = "X-Legacy-Gate-Header"
    adapter.header_value = "legacy-static-token"
    observed = {"authorization": "", "x-legacy-gate-header": ""}

    def fake_urlopen(request, timeout=None):
        headers = dict((k.lower(), v) for k, v in request.header_items())
        observed["authorization"] = headers.get("authorization", "")
        observed["x-legacy-gate-header"] = headers.get("x-legacy-gate-header", "")
        return _FakeResponse(200, [])

    import spinnaker_adapter.adapter as adapter_module
    monkeypatch.setattr(adapter_module, "urlopen", fake_urlopen)
    monkeypatch.setattr(adapter_module, "build_opener", lambda *handlers: _FakeOpener(fake_urlopen))

    adapter.list_applications(user_bearer_token="user-token")
    assert observed["authorization"] == ""
    assert observed["x-legacy-gate-header"] == "legacy-static-token"


def test_user_bearer_token_used_when_no_machine_auth(monkeypatch):
    adapter = _adapter()
    adapter.auth0_domain = ""
    adapter.auth0_client_id = ""
    adapter.auth0_client_secret = ""
    adapter.auth0_audience = ""
    observed = {"authorization": ""}

    def fake_urlopen(request, timeout=None):
        headers = dict((k.lower(), v) for k, v in request.header_items())
        observed["authorization"] = headers.get("authorization", "")
        return _FakeResponse(200, [])

    import spinnaker_adapter.adapter as adapter_module
    monkeypatch.setattr(adapter_module, "urlopen", fake_urlopen)
    monkeypatch.setattr(adapter_module, "build_opener", lambda *handlers: _FakeOpener(fake_urlopen))

    adapter.list_applications(user_bearer_token="user-token")
    assert observed["authorization"] == "Bearer user-token"


def test_mtls_mode_requires_explicit_user_principal(monkeypatch):
    adapter = _adapter()
    adapter.auth0_domain = ""
    adapter.auth0_client_id = ""
    adapter.auth0_client_secret = ""
    adapter.auth0_audience = ""
    adapter._gate_ssl_context = object()
    try:
        adapter.list_applications(user_bearer_token="user-token")
        raise AssertionError("expected RuntimeError")
    except RuntimeError as exc:
        assert "x-spinnaker-user is required" in str(exc).lower()


def test_mtls_mode_sets_user_header_and_omits_authorization(monkeypatch):
    adapter = _adapter()
    adapter._gate_ssl_context = object()
    observed = {"authorization": "", "x-spinnaker-user": ""}

    def fake_urlopen(request, timeout=None):
        headers = dict((k.lower(), v) for k, v in request.header_items())
        observed["authorization"] = headers.get("authorization", "")
        observed["x-spinnaker-user"] = headers.get("x-spinnaker-user", "")
        return _FakeResponse(200, [])

    import spinnaker_adapter.adapter as adapter_module
    monkeypatch.setattr(adapter_module, "urlopen", fake_urlopen)
    monkeypatch.setattr(adapter_module, "build_opener", lambda *handlers: _FakeOpener(fake_urlopen))

    adapter.list_applications(user_principal="owner@example.com")
    assert observed["authorization"] == ""
    assert observed["x-spinnaker-user"] == "owner@example.com"


def test_trigger_uses_user_bearer_principal_for_manual_user(monkeypatch):
    adapter = _adapter()
    jwt_payload = {"email": "owner@example.com", "sub": "auth0|owner-1", "exp": 32503680000}
    user_token = ".".join(
        [
            "eyJhbGciOiJub25lIn0",
            __import__("base64").urlsafe_b64encode(json.dumps(jwt_payload).encode("utf-8")).decode("ascii").rstrip("="),
            "",
        ]
    )
    observed = {"user": ""}

    def fake_urlopen(request, timeout=None):
        if request.full_url.endswith("/oauth/token"):
            return _FakeResponse(200, {"access_token": "minted-token", "expires_in": 3600})
        payload = json.loads((request.data or b"{}").decode("utf-8"))
        observed["user"] = payload.get("user", "")
        return _FakeResponse(200, {"ref": "pipeline/execution/exec-1"})

    import spinnaker_adapter.adapter as adapter_module
    monkeypatch.setattr(adapter_module, "urlopen", fake_urlopen)
    monkeypatch.setattr(adapter_module, "build_opener", lambda *handlers: _FakeOpener(fake_urlopen))

    adapter.trigger_deploy(
        {
            "service": "demo-service",
            "version": "0.1.1",
            "spinnakerApplication": "demo-service",
            "spinnakerPipeline": "demo-deploy",
            "artifactRef": "s3://bucket/path.zip",
        },
        "idmp-1",
        user_bearer_token=user_token,
    )
    assert observed["user"] == "owner@example.com"


def test_trigger_uses_explicit_spinnaker_user_header_when_no_user_token(monkeypatch):
    adapter = _adapter()
    adapter.auth0_domain = ""
    adapter.auth0_client_id = ""
    adapter.auth0_client_secret = ""
    adapter.auth0_audience = ""
    adapter.header_name = "X-Spinnaker-User"
    adapter.header_value = "svc-ci"
    observed = {"user": ""}

    def fake_urlopen(request, timeout=None):
        payload = json.loads((request.data or b"{}").decode("utf-8"))
        observed["user"] = payload.get("user", "")
        return _FakeResponse(200, {"ref": "pipeline/execution/exec-2"})

    import spinnaker_adapter.adapter as adapter_module
    monkeypatch.setattr(adapter_module, "urlopen", fake_urlopen)
    monkeypatch.setattr(adapter_module, "build_opener", lambda *handlers: _FakeOpener(fake_urlopen))

    adapter.trigger_deploy(
        {
            "service": "demo-service",
            "version": "0.1.2",
            "spinnakerApplication": "demo-service",
            "spinnakerPipeline": "demo-deploy",
            "artifactRef": "s3://bucket/path.zip",
        },
        "idmp-2",
    )
    assert observed["user"] == "svc-ci"
