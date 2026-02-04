import re
from urllib.parse import urlsplit


_TOKEN_PATTERNS = [
    re.compile(r"(Authorization\s*:\s*)([^\n\r]+)", re.IGNORECASE),
    re.compile(r"(Bearer\s+)\S+", re.IGNORECASE),
    re.compile(r"((?:access|id|refresh)_token=)[^&\s]+", re.IGNORECASE),
    re.compile(r"(token=)[^&\s]+", re.IGNORECASE),
    re.compile(r"(api_key=)[^&\s]+", re.IGNORECASE),
    re.compile(r"(cookie=)[^;\s]+", re.IGNORECASE),
    re.compile(r"(set-cookie:)[^\n\r]+", re.IGNORECASE),
]


def redact_url(value: str) -> str:
    if not value:
        return ""
    try:
        parsed = urlsplit(value)
    except ValueError:
        return "<redacted-url>"
    if not parsed.scheme or not parsed.netloc:
        return "<redacted-url>"
    return f"{parsed.scheme}://{parsed.netloc}/..."


def redact_text(value: str) -> str:
    if not value:
        return value
    redacted = value
    for pattern in _TOKEN_PATTERNS:
        redacted = pattern.sub(r"\1[REDACTED]", redacted)
    redacted = re.sub(r"https?://[^\s]+", lambda match: redact_url(match.group(0)), redacted)
    return redacted
