from typing import Any, Optional

from models import CiPublisher


def _as_claim_list(value: Any) -> list[str]:
    if isinstance(value, str):
        item = value.strip()
        return [item] if item else []
    if isinstance(value, list):
        values: list[str] = []
        for item in value:
            if isinstance(item, str):
                normalized = item.strip()
                if normalized:
                    values.append(normalized)
        return values
    return []


def _normalized_rule_values(values: Optional[list[str]]) -> list[str]:
    if not values:
        return []
    return [item.strip() for item in values if isinstance(item, str) and item.strip()]


def _claim_matches(claim_value: Optional[str], allowed_values: Optional[list[str]]) -> bool:
    allowed = _normalized_rule_values(allowed_values)
    if not allowed:
        return True
    if not isinstance(claim_value, str):
        return False
    return claim_value in allowed


def _subject_prefix_matches(subject: Optional[str], prefixes: Optional[list[str]]) -> bool:
    allowed = _normalized_rule_values(prefixes)
    if not allowed:
        return True
    if not isinstance(subject, str):
        return False
    return any(subject.startswith(prefix) for prefix in allowed)


def _audience_matches(claim_aud: Any, allowed_audiences: Optional[list[str]]) -> bool:
    allowed = set(_normalized_rule_values(allowed_audiences))
    if not allowed:
        return True
    claims_aud = set(_as_claim_list(claim_aud))
    return bool(claims_aud.intersection(allowed))


def _publisher_constraint_count(publisher: CiPublisher) -> int:
    constrained_fields = [
        publisher.issuers,
        publisher.audiences,
        publisher.authorized_party_azp,
        publisher.subjects,
        publisher.subject_prefixes,
        publisher.emails,
    ]
    return sum(1 for value in constrained_fields if _normalized_rule_values(value))


def match_ci_publisher(claims: dict, publishers: list[CiPublisher]) -> Optional[str]:
    """
    Return matching CI publisher name for the given claims.

    Matching logic:
    - A publisher matches only if all configured constraints pass.
    - Unset/empty constraints are ignored.
    - If multiple publishers match, pick the most specific publisher
      (largest number of constrained rule fields). Ties are broken by
      lexicographically smallest publisher name.
    """
    if not isinstance(claims, dict) or not publishers:
        return None

    iss = claims.get("iss")
    aud = claims.get("aud")
    sub = claims.get("sub")
    azp = claims.get("azp")
    email = claims.get("email") or claims.get("https://dxcp.example/claims/email")

    matches: list[CiPublisher] = []
    for publisher in publishers:
        if not _claim_matches(iss, publisher.issuers):
            continue
        if not _audience_matches(aud, publisher.audiences):
            continue
        if not _claim_matches(azp, publisher.authorized_party_azp):
            continue
        if not _claim_matches(sub, publisher.subjects):
            continue
        if not _subject_prefix_matches(sub, publisher.subject_prefixes):
            continue
        if not _claim_matches(email, publisher.emails):
            continue
        matches.append(publisher)

    if not matches:
        return None

    matches.sort(key=lambda item: (-_publisher_constraint_count(item), item.name))
    return matches[0].name
