# Backstage Integration -- Governance-Aligned Model

This document defines the architectural and governance boundaries
between:

-   **DXCP** --- Delivery Experience Control Plane\
-   **Backstage** --- Internal Developer Portal

This integration must preserve DXCP's role as the authoritative delivery
control plane.

DXCP is not extended by Backstage.\
Backstage is a client of DXCP.

------------------------------------------------------------------------

# DXCP Identity (Reaffirmed)

DXCP exists to:

-   Make software delivery safe by default
-   Act as the authoritative source of truth for delivery state
-   Enforce delivery policy centrally
-   Abstract execution engine complexity
-   Provide consistent, explainable delivery outcomes

DXCP is NOT:

-   A CI system
-   A build system
-   A pipeline editor
-   A developer portal
-   A catalog manager
-   A UI extension surface

Backstage integration must not change these boundaries.

------------------------------------------------------------------------

# Backstage Role

Backstage exists to:

-   Own catalog identity
-   Provide service discovery
-   Improve cross-tool visibility
-   Offer workflow entry points

Backstage is not:

-   A delivery authority
-   A policy engine
-   A deployment orchestrator
-   A delivery state store

Backstage must never become an alternate deployment path.

------------------------------------------------------------------------

# Governance Boundary

The integration enforces the following invariant:

Backstage renders.\
DXCP evaluates and enforces.

All delivery actions initiated from Backstage must:

1.  Flow through DXCP APIs
2.  Be evaluated against DXCP policy
3.  Be recorded in DXCP audit history
4.  Reflect DXCP's authoritative state

Backstage must not:

-   Cache canonical delivery state
-   Recompute allowed actions
-   Interpret policy independently
-   Modify delivery strategy
-   Modify guardrails

DXCP remains the sole authority over delivery outcomes.

------------------------------------------------------------------------

# Architectural Invariants

1.  **Single Control Plane**\
    All deployments converge through DXCP.

2.  **No Parallel Governance**\
    Backstage must not introduce alternative policy paths.

3.  **Execution Engine Abstraction Preserved**\
    Backstage must never depend on underlying engine details.

4.  **Authoritative State Ownership**\
    Deployment status, history, and policy evaluation originate in DXCP.

5.  **Portal as Lens, Not Brain**\
    Backstage surfaces DXCP decisions but does not create them.

------------------------------------------------------------------------

# Integration Scope (Governed)

Permitted:

-   Read-only delivery status display
-   Allowed actions display (as evaluated by DXCP)
-   Optional action initiation (deploy, rollback, validate)
-   Insights rendering (derived from DXCP records)

Explicitly Out of Scope:

-   Editing delivery recipes
-   Managing environment strategy
-   Modifying policy definitions
-   Viewing execution engine internals
-   Replicating audit logs
-   Acting as policy decision authority

------------------------------------------------------------------------

# Identity and Mapping

Backstage owns service identity.

DXCP recognizes services via explicit mapping, e.g.:

dxcp.io/service: demo-service

DXCP validates service existence and governance alignment.

Identity authority remains in Backstage.\
Delivery authority remains in DXCP.

------------------------------------------------------------------------

# Authorization Model

Backstage authenticates to DXCP using standard OIDC Bearer tokens.

DXCP enforces:

-   Role validation
-   Policy evaluation
-   Environment constraints
-   Concurrency limits
-   Guardrail checks

Backstage may render permitted actions.\
DXCP decides whether they execute.

------------------------------------------------------------------------

# Enterprise Integrity Clause

This integration must:

-   Reinforce DXCP as the delivery authority
-   Avoid duplicating governance logic
-   Preserve policy centralization
-   Survive execution engine evolution
-   Prevent scope drift into portal-managed delivery

If DXCP evolves internally, Backstage integration must remain stable and
abstracted from engine-level changes.

------------------------------------------------------------------------

# Strategic Positioning

The integration should communicate:

"This service is governed by DXCP."

It must never imply:

"Deployment happens in Backstage."

DXCP is the control plane.\
Backstage is the visibility layer.

The boundary is deliberate and non-negotiable.
