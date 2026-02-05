import sys
from pathlib import Path



ROOT = Path(__file__).resolve().parents[2]
SPINNAKER_ADAPTER = ROOT / "spinnaker-adapter"
if SPINNAKER_ADAPTER.is_dir():
    sys.path.insert(0, str(SPINNAKER_ADAPTER))

from spinnaker_adapter.adapter import SpinnakerAdapter


class FakeResponse:
    def __init__(self) -> None:
        self.status = 200
        self.headers = {}

    def read(self) -> bytes:
        return b"[]"

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        return None


def test_spinnaker_request_includes_request_id(monkeypatch):
    captured = {}

    def fake_urlopen(request, timeout=None):
        captured["headers"] = dict(request.header_items())
        return FakeResponse()

    import spinnaker_adapter.adapter as adapter_module
    monkeypatch.setattr(adapter_module, "urlopen", fake_urlopen)
    adapter = SpinnakerAdapter(
        base_url="https://spinnaker.example.com",
        mode="http",
        request_id_provider=lambda: "req-abc",
    )
    adapter.list_applications()
    header_value = None
    for key, value in captured["headers"].items():
        if key.lower() == "x-request-id":
            header_value = value
            break
    assert header_value == "req-abc"
