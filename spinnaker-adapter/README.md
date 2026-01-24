# Spinnaker Adapter

This module encapsulates all Spinnaker interactions for the DXCP API.
It provides a small interface for triggering deployments, triggering rollbacks,
reading execution status, and normalizing failures.

Modes:
- stub: in-memory execution simulation (default)
- http: placeholder for calling real Spinnaker APIs

This adapter is intentionally thin and isolated from the DXCP API logic.
