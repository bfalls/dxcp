import sys
from pathlib import Path

import pytest


root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root))

from lambda_handler import _parse_artifact_ref  # noqa: E402


def test_parse_s3_artifact_ref_accepts() -> None:
    artifact_ref, bucket, key = _parse_artifact_ref({"artifactRef": "s3://demo-bucket/demo.zip"})
    assert artifact_ref == "s3://demo-bucket/demo.zip"
    assert bucket == "demo-bucket"
    assert key == "demo.zip"


def test_parse_artifact_ref_rejects_non_s3() -> None:
    with pytest.raises(ValueError, match="scheme"):
        _parse_artifact_ref({"artifactRef": "gcs://demo-bucket/demo.zip"})


def test_parse_artifact_ref_rejects_malformed() -> None:
    with pytest.raises(ValueError, match="artifactRef"):
        _parse_artifact_ref({"artifactRef": "s3:/demo-bucket/demo.zip"})
