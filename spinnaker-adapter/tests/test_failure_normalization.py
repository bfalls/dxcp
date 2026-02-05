import sys
from pathlib import Path


def _adapter():
    root = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(root))
    from spinnaker_adapter.adapter import SpinnakerAdapter

    return SpinnakerAdapter(base_url="http://spinnaker.local", mode="http")


def _extract_failures(execution: dict) -> list[dict]:
    return _adapter()._extract_failures(execution, "FAILED")


def _assert_safe_text(failure: dict) -> None:
    for key in ("summary", "actionHint", "detail"):
        value = failure.get(key)
        if isinstance(value, str):
            assert "spinnaker" not in value.lower()


def test_maps_artifact_bucket_mismatch() -> None:
    execution = {
        "stages": [
            {
                "type": "dxcpDeploy",
                "name": "deploy-artifact",
                "status": "TERMINAL",
                "context": {"error": "artifact_bucket_mismatch"},
            }
        ]
    }
    failures = _extract_failures(execution)
    assert failures and failures[0]["category"] == "ARTIFACT"
    assert failures[0]["summary"] == "Build artifact could not be validated."
    _assert_safe_text(failures[0])


def test_maps_timeout_message() -> None:
    execution = {"statusMessage": "Deployment timed out after 30 minutes"}
    failures = _extract_failures(execution)
    assert failures and failures[0]["category"] == "TIMEOUT"
    assert failures[0]["summary"] == "Deployment timed out."
    _assert_safe_text(failures[0])


def test_maps_rollback_no_previous_artifact() -> None:
    execution = {
        "name": "rollback-demo-service",
        "stages": [
            {
                "type": "dxcpRollback",
                "name": "rollback-artifact",
                "status": "TERMINAL",
                "context": {"error": "no_previous_artifact"},
            }
        ],
    }
    failures = _extract_failures(execution)
    assert failures and failures[0]["category"] == "ROLLBACK"
    assert failures[0]["summary"] == "No prior version is available to roll back."
    _assert_safe_text(failures[0])


def test_unknown_maps_to_unknown() -> None:
    execution = {"message": "unexpected failure in execution"}
    failures = _extract_failures(execution)
    assert failures and failures[0]["category"] == "UNKNOWN"
    assert failures[0]["summary"] == "Deployment failed for an unknown reason."
    _assert_safe_text(failures[0])
