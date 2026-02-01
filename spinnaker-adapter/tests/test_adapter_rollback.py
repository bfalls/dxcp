import sys
from pathlib import Path


def _adapter():
    root = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(root))
    from spinnaker_adapter.adapter import SpinnakerAdapter

    return SpinnakerAdapter(base_url="http://spinnaker.local", mode="http")


def test_trigger_rollback_parameters():
    adapter = _adapter()
    adapter.engine_token = "should-not-be-sent"
    captured = {}

    def fake_request_json(method: str, url: str, body=None):
        captured["method"] = method
        captured["url"] = url
        captured["body"] = body
        return {"executionId": "exec-1"}, 200, {}

    adapter._request_json = fake_request_json

    payload = {"service": "demo-service", "version": "1.2.3", "targetVersion": "1.2.3"}
    result = adapter.trigger_rollback(payload, "idem-rollback-1")

    assert result["executionId"] == "exec-1"
    assert captured["method"] == "POST"
    assert captured["url"].endswith("/pipelines/dxcp-demo/rollback-demo-service")
    params = captured["body"]["parameters"]
    assert params["service"] == "demo-service"
    assert params["version"] == "1.2.3"
    assert params["targetVersion"] == "1.2.3"
    assert captured["body"]["idempotencyKey"] == "idem-rollback-1"
    assert "engineToken" not in params
