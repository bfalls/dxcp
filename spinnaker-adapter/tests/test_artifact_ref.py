import sys
from pathlib import Path

import pytest


def _adapter() -> "SpinnakerAdapter":
    root = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(root))
    from spinnaker_adapter.adapter import SpinnakerAdapter

    return SpinnakerAdapter()


def test_s3_artifact_ref_sets_bucket_and_key() -> None:
    adapter = _adapter()
    params = adapter._build_parameters(
        {
            "service": "demo-service",
            "version": "1.0.0",
            "artifactRef": "s3://demo-bucket/demo.zip",
        }
    )
    assert params["artifactRef"] == "s3://demo-bucket/demo.zip"
    assert params["s3Bucket"] == "demo-bucket"
    assert params["s3Key"] == "demo.zip"


def test_non_s3_artifact_ref_rejected() -> None:
    adapter = _adapter()
    with pytest.raises(ValueError, match="scheme"):
        adapter._build_parameters(
            {
                "service": "demo-service",
                "version": "1.0.0",
                "artifactRef": "gcs://demo-bucket/demo.zip",
            }
        )


def test_malformed_artifact_ref_rejected() -> None:
    adapter = _adapter()
    with pytest.raises(ValueError, match="artifactRef"):
        adapter._build_parameters(
            {
                "service": "demo-service",
                "version": "1.0.0",
                "artifactRef": "s3:/demo-bucket/demo.zip",
            }
        )
