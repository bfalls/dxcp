import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SPINNAKER_ADAPTER = ROOT / "spinnaker-adapter"
if SPINNAKER_ADAPTER.is_dir():
    sys.path.insert(0, str(SPINNAKER_ADAPTER))

from spinnaker_adapter.redaction import redact_text, redact_url


def test_redact_text_masks_tokens():
    raw = "Authorization: Bearer secret-token-123 access_token=abc123 cookie=sessionid=xyz"
    redacted = redact_text(raw)
    assert "secret-token-123" not in redacted
    assert "abc123" not in redacted
    assert "sessionid=xyz" not in redacted
    assert "[REDACTED]" in redacted


def test_redact_text_sanitizes_urls():
    raw = "Failed to call https://spinnaker.example.com/api/v1/pipelines?token=abc123"
    redacted = redact_text(raw)
    assert "token=abc123" not in redacted
    assert "https://spinnaker.example.com/..." in redacted


def test_redact_url_keeps_host_only():
    assert redact_url("https://spinnaker.example.com/api/v1/pipelines") == "https://spinnaker.example.com/..."
