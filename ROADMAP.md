# DXCP Roadmap

This roadmap outlines the intended evolution of DXCP as an enterprise delivery experience control plane.
It reflects direction and priorities, not fixed commitments or timelines.

## Current State

DXCP implements a complete, end-to-end delivery intent model with:
- Services, Delivery Groups, and Recipes as first-class domain concepts
- Role-based access control and policy enforcement
- Governed deployment initiation backed by Spinnaker
- Enterprise authentication (OIDC/Auth0)
- Operational guardrails and configurable UI behavior
- Backstage integration hooks

The focus has been on conceptual integrity, safety, and product shape.

---

## Near-Term (Next Phases)

### Operational Maturity
- Expanded failure taxonomy and classification
- Clearer rollback visibility and outcomes
- Improved deployment timelines and auditability
- Read-only operational views for observers and stakeholders

### Admin Experience
- Richer admin surfaces for Delivery Group configuration
- Validation and preview of guardrails before enforcement
- Safer defaults and clearer policy feedback in the UI

### Backstage Integration
- Backstage entity linking for Services and Delivery Groups
- Surfacing DXCP delivery state inside Backstage
- DXCP as a read-first control surface within existing IDPs

---

## Mid-Term

### Policy and Governance
- More expressive guardrails (time windows, environment conditions)
- Policy simulation and dry-run support
- Explicit approval and escalation workflows (without becoming a workflow engine)

### Extensibility
- Additional artifact sources beyond the initial implementations
- Cleaner engine abstraction to support non-Spinnaker backends
- Pluggable evaluation hooks for organization-specific rules

---

## Long-Term Direction

### Platform Evolution
- DXCP as a system of record for delivery intent and outcomes
- Cross-service delivery insights and trend analysis
- Stronger integration with internal developer portals and ownership systems

### Scale and Adoption
- Support for large numbers of services and delivery groups
- Clear ownership boundaries for platform teams vs application teams
- Patterns for federated adoption across organizations

---

## Explicit Non-Commitments

- DXCP is not planned to become a CI system.
- DXCP will not replace execution engines.
- DXCP will not become a generic workflow DSL.
- DXCP prioritizes governed, paved-road delivery over unlimited flexibility.

---

## Feedback and Direction

DXCP is actively developed.
Feedback from teams evaluating or piloting the platform is welcome and helps shape future phases.
