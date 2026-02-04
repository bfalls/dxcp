# Observability

## Correlation IDs

Required:
- DXCP reads the `X-Request-Id` header if provided.
- DXCP generates a UUID if `X-Request-Id` is missing.
- DXCP echoes `X-Request-Id` in every response.
- Error responses include `request_id`.

Optional:
- Clients should send `X-Request-Id` for traceability.

## Log Events

DXCP logs to stdout/stderr using key=value format.

Required fields:
- event
- request_id

Common fields (when applicable):
- actor_id
- actor_role
- delivery_group_id
- service_name
- recipe_id
- environment
- outcome (SUCCESS|DENIED|FAILED)
- engine
- operation
- duration_ms

Event types:
- deploy_intent_submitted
- deploy_intent_denied
- spinnaker_health_failed
- spinnaker_call_started
- spinnaker_call_succeeded
- spinnaker_call_failed
- engine_error

## Operator guidance

Required:
- Search by `request_id` to correlate API errors, audit events, and engine calls.

Optional:
- Filter by `event=deploy_intent_submitted` to find successful deploy submissions.
- Filter by `event=spinnaker_call_failed` to find engine failures.

## Example queries (generic)

- Find a request:
  - `request_id=<id>`

- Find all engine failures:
  - `event=spinnaker_call_failed`
