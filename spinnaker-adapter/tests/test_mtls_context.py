import sys
from pathlib import Path
from urllib.request import Request

import pytest


def _adapter_cls():
    root = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(root))
    from spinnaker_adapter.adapter import SpinnakerAdapter

    return SpinnakerAdapter


class _FakeContext:
    def __init__(self):
        self.check_hostname = False
        self.verify_mode = None
        self.loaded_verify_locations = []
        self.loaded_cert_chain = []

    def load_verify_locations(self, cafile=None, capath=None, cadata=None):
        self.loaded_verify_locations.append((cafile, capath, cadata))

    def load_cert_chain(self, certfile=None, keyfile=None, password=None):
        self.loaded_cert_chain.append((certfile, keyfile, password))


class _FakeOpener:
    def __init__(self, handlers):
        self.handlers = handlers

    def open(self, request, timeout=None):
        return {"request": request, "timeout": timeout}


def test_http_base_url_ignores_mtls_config():
    adapter_class = _adapter_cls()
    adapter = adapter_class(
        base_url="http://spinnaker.local",
        mode="http",
        mtls_ca_path="/tmp/ca.crt",
        mtls_cert_path="/tmp/client.crt",
        mtls_key_path="/tmp/client.key",
    )
    assert adapter._gate_ssl_context is None


def test_https_builds_context_and_loads_certificates(monkeypatch):
    adapter_class = _adapter_cls()
    import spinnaker_adapter.adapter as adapter_module

    fake_context = _FakeContext()
    monkeypatch.setattr(adapter_module.ssl, "create_default_context", lambda: fake_context)

    adapter = adapter_class(
        base_url="https://spinnaker.local",
        mode="http",
        mtls_ca_path="/tmp/ca.crt",
        mtls_cert_path="/tmp/client.crt",
        mtls_key_path="/tmp/client.key",
    )

    assert adapter._gate_ssl_context is fake_context
    assert fake_context.check_hostname is True
    assert fake_context.loaded_verify_locations == [("/tmp/ca.crt", None, None)]
    assert fake_context.loaded_cert_chain == [("/tmp/client.crt", "/tmp/client.key", None)]


def test_cert_without_key_raises():
    adapter_class = _adapter_cls()
    with pytest.raises(RuntimeError, match="cert and key must both be set"):
        adapter_class(
            base_url="https://spinnaker.local",
            mode="http",
            mtls_cert_path="/tmp/client.crt",
            mtls_key_path="",
        )


def test_https_server_name_uses_custom_https_handler(monkeypatch):
    adapter_class = _adapter_cls()
    import spinnaker_adapter.adapter as adapter_module

    fake_context = _FakeContext()
    monkeypatch.setattr(adapter_module.ssl, "create_default_context", lambda: fake_context)
    observed_handlers = []

    def fake_build_opener(*handlers):
        observed_handlers.extend(handlers)
        return _FakeOpener(handlers)

    monkeypatch.setattr(adapter_module, "build_opener", fake_build_opener)

    adapter = adapter_class(
        base_url="https://spinnaker.local",
        mode="http",
        mtls_server_name="gate.internal.example",
    )
    request = Request("https://spinnaker.local/health", method="GET")
    adapter._open_url(request, timeout_seconds=2, follow_redirects=False, use_gate_tls=True)

    assert any(type(handler).__name__ == "_ServerNameHTTPSHandler" for handler in observed_handlers)
