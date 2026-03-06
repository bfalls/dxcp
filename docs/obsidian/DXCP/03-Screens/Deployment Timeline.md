# Deployment Timeline (Canonical Model)

DXCP deployments produce a chronological set of engine-agnostic events that describe
the lifecycle of a deployment.

This timeline is the primary UX for answering:
- What happened?
- What failed?
- What should I do next?
- Did this change what’s running?

DXCP is intent-first. The timeline must not require understanding engine internals.

---

## Purpose  
  
The **Deployment Timeline** defines the canonical event model used to  
explain a [[DXCP Core Vocabulary#Deployment|Deployment]] in DXCP.  
  
It is the core narrative element of the [[Deployment Screen]] and reflects  
the lifecycle defined in [[Deploy Workflow]].  
  
This note specifies:  
- canonical deployment events  
- event ordering  
- event categories  
- timeline UX patterns  
- timeline examples

---

## Timeline object

A DeploymentTimeline is an ordered list of DeploymentEvent entries attached to a DeploymentRecord.
Events are append-only operational evidence.

### DeploymentEvent (conceptual)
- id: stable identifier
- timestamp: ISO8601
- sequence: monotonic per DeploymentRecord (tie-break)
- category: SUBMISSION | GOVERNANCE | VALIDATION | EXECUTION | OUTCOME | FAILURE | DIAGNOSTIC
- type: canonical event type (see below)
- summary: one-line description (developer-readable)
- detail: optional short explanation (no raw engine dumps)
- relatedFailure: optional FailureModel reference (category/summary/actionHint)
- adminDiagnostics: optional (admin-only) references (engineExecutionUrl, request_id, operator_hint)

---

## Canonical event types

### A) Submission
- INTENT_SUBMITTED

### B) Governance (pre-engine)
- POLICY_CHECK_STARTED
- POLICY_CHECK_PASSED
- POLICY_CHECK_FAILED
- QUOTA_CHECK_STARTED
- QUOTA_CHECK_PASSED
- QUOTA_CHECK_FAILED
- CONCURRENCY_CHECK_STARTED
- CONCURRENCY_CHECK_PASSED
- CONCURRENCY_CHECK_FAILED

### C) Validation (pre-engine)
- VALIDATION_STARTED
- VALIDATION_PASSED
- VALIDATION_FAILED

### D) Execution (engine-agnostic)
- ENGINE_EXECUTION_REQUESTED
- ENGINE_EXECUTION_STARTED
- ENGINE_PROGRESS (repeatable, optional)
- ENGINE_EXECUTION_SUCCEEDED
- ENGINE_EXECUTION_FAILED
- ENGINE_EXECUTION_CANCELED

### E) Outcome + running state
- OUTCOME_SET (SUCCEEDED | FAILED | CANCELED | ROLLED_BACK | SUPERSEDED)
- RUNNING_STATE_UPDATED

### F) Failure observation
- FAILURE_OBSERVED (references FailureModel)

### G) Rollback lineage (on rollback deployment record)
- ROLLBACK_REQUESTED
- ROLLBACK_LINKED (rollbackOf = prior deployment id)

---

## Ordering rules

1) Sort by timestamp ascending
2) Tie-break: sequence ascending
3) Final tie-break: id ascending

Governance ordering must be reflected:
- Delivery group policy
- Compatibility validation
- Quota checks
- Concurrency checks
- Engine execution

If policy fails, later checks and engine execution events MUST NOT appear.

---

## Timeline UX patterns

### Default view (milestones)
Show milestones only:
- Intent submitted
- Governance result(s)
- Validation result
- Execution start + terminal result
- Outcome + running state update

Collapse repeatable progress into a single row (e.g., “Progress updates: 7”).

### Progressive disclosure
Each milestone row can expand to show:
- short detail text
- normalized failure(s) with category badge + action hint
- admin-only diagnostics (engine link, request_id)

### “Next step” behavior
If a failure exists, show exactly one recommended next action
(using FailureModel.actionHint) near the first failure observation.

### Rollback behavior
Rollback is a separate DeploymentRecord with its own timeline.
The header must show “Rollback of <deploymentId>” (via rollbackOf).

---

## ASCII examples

### Success
[12:01:03] ● Intent submitted
[12:01:04] ● Policy check passed
[12:01:04] ● Validation passed
[12:01:05] ● Quota check passed
[12:01:05] ● Concurrency check passed
[12:01:06] ● Execution started
[12:02:10] ● Execution succeeded
[12:02:10] ● Outcome: SUCCEEDED
[12:02:11] ● Running state updated → v1.8.3 is now running

### Blocked by policy
[09:14:22] ● Intent submitted
[09:14:22] ● Policy check failed → 403 RECIPE_NOT_ALLOWED
           └─ Action: Choose an approved recipe for this delivery group.

### Version not found
[10:33:01] ● Intent submitted
[10:33:02] ● Policy check passed
[10:33:02] ● Validation failed → 400 VERSION_NOT_FOUND
           └─ Action: Register the build version for this service, then retry.

### Concurrency limit
[14:07:11] ● Intent submitted
[14:07:11] ● Policy check passed
[14:07:12] ● Validation passed
[14:07:12] ● Quota check passed
[14:07:13] ● Concurrency check failed → 409 CONCURRENCY_LIMIT_REACHED
           └─ Action: Wait for the active deployment to finish.

### Execution failure observed
[16:20:00] ● Intent submitted
[16:20:01] ● Policy check passed
[16:20:01] ● Validation passed
[16:20:02] ● Quota check passed
[16:20:02] ● Concurrency check passed
[16:20:03] ● Execution started
[16:21:10] ▲ Failure observed (INFRASTRUCTURE): Capacity unavailable
           └─ Action: Retry later or switch to an approved recipe.
[16:22:45] ● Execution failed
[16:22:45] ● Outcome: FAILED