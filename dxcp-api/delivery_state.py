from typing import Optional


IN_PROGRESS_STATES = {"PENDING", "ACTIVE", "IN_PROGRESS"}
TERMINAL_OUTCOMES = {"SUCCEEDED", "FAILED", "CANCELED", "ROLLED_BACK"}
DEPLOYMENT_KINDS = {"ROLL_FORWARD", "ROLLBACK", "PROMOTE"}


def normalize_deployment_kind(deployment_kind: Optional[str], rollback_of: Optional[str]) -> str:
    if deployment_kind in DEPLOYMENT_KINDS:
        return deployment_kind
    return "ROLLBACK" if rollback_of else "ROLL_FORWARD"


def base_outcome_from_state(state: Optional[str]) -> Optional[str]:
    if not state or state in IN_PROGRESS_STATES:
        return None
    if state in TERMINAL_OUTCOMES:
        return state
    return None


def resolve_outcome(
    state: Optional[str],
    stored_outcome: Optional[str],
    deployment_id: Optional[str] = None,
    latest_success_id: Optional[str] = None,
) -> Optional[str]:
    outcome = stored_outcome or base_outcome_from_state(state)
    if outcome == "SUCCEEDED" and latest_success_id and deployment_id and deployment_id != latest_success_id:
        return "SUPERSEDED"
    return outcome
