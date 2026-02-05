import sys
from pathlib import Path


def _adapter():
    root = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(root))
    from spinnaker_adapter.adapter import SpinnakerAdapter

    return SpinnakerAdapter(base_url="http://spinnaker.local", mode="http")


def _extract_failures(execution: dict) -> list[dict]:
    return _adapter()._extract_failures(execution, "FAILED")


def test_contract_artifact_bucket_mismatch():
    execution = {"stages": [{"context": {"error": "artifact_bucket_mismatch"}}]}
    failure = _extract_failures(execution)[0]
    assert failure["category"] == "ARTIFACT"
    assert failure["summary"] == "Build artifact could not be validated."
    assert failure["actionHint"] == "Register the build in the approved artifact store and retry."


def test_contract_timeout():
    execution = {"statusMessage": "timeout while waiting for deployment"}
    failure = _extract_failures(execution)[0]
    assert failure["category"] == "TIMEOUT"
    assert failure["summary"] == "Deployment timed out."
    assert failure["actionHint"] == "Retry the deployment or contact the platform team."


def test_contract_unauthorized():
    execution = {"stages": [{"context": {"error": "unauthorized"}}]}
    failure = _extract_failures(execution)[0]
    assert failure["category"] == "POLICY"
    assert failure["summary"] == "Deployment was blocked by permissions."
    assert failure["actionHint"] == "Confirm your permissions or contact the platform team."
