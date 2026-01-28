# Spinnaker Adapter

This module encapsulates all Spinnaker interactions for the DXCP API.
It provides a small interface for triggering deployments, triggering rollbacks,
reading execution status, and normalizing failures.

Modes:
- http: calls real Spinnaker Gate APIs (default)
- stub: disabled in DXCP production/demo configuration

This adapter is intentionally thin and isolated from the DXCP API logic.
