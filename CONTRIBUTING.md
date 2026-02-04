# Contributing to DXCP

Thanks for your interest in DXCP.

DXCP is an opinionated delivery experience control plane. This repo is intended to look and feel like an enterprise internal platform product, not a loose collection of experiments. Contributions should preserve conceptual integrity and avoid introducing new "modes" or bypasses.

## Before you start

Read these first:
- README.md
- docs/PRODUCT_VISION.md
- docs/DECISIONS.md
- docs/ARCHITECTURE.md
- docs/DOMAIN_MODEL.md
- docs/API_DESIGN.md
- docs/UI_SPEC.md

If you propose a change that conflicts with docs/DECISIONS.md, update the decision record (or justify why the decision should change).

## Contribution types that are welcome

- Bug fixes with tests
- Documentation fixes and clarifications
- Small UX improvements that reduce cognitive load
- Guardrail improvements (safety, serialization, validation)
- API and UI consistency improvements
- Backstage integration improvements (read-first surfaces)

## Contribution types that are not welcome (without discussion)

- New core domain concepts or renames (Service, DeliveryGroup, Recipe)
- New execution engines (Spinnaker is the engine)
- Infrastructure provisioning expansion beyond the current scope
- Introducing demo-only bypasses or backdoors
- Broad refactors that are not tied to a product goal

If you want to propose a larger change, open an issue first and describe:
- The user problem
- The proposed change
- The non-goals and tradeoffs

## How to run locally

Local run steps are documented in README.md.
Please follow the README as the source of truth.

If you change local run behavior, you must update README.md and any affected docs under docs/.

## Branching and PR workflow

1) Create a topic branch:
- feat/<short-name>
- fix/<short-name>
- docs/<short-name>

2) Keep PRs small:
- One primary change per PR
- Avoid drive-by edits unless they are directly related

3) Include in every PR:
- What changed (short)
- Why (user/product impact)
- How to test (exact commands)
- Risk and rollback notes (if behavior changes)

## Code quality expectations

DXCP optimizes for:
- Clarity over cleverness
- Conservative defaults
- Explicit guardrails
- Auditable behavior

Guidelines:
- Keep modules small and readable
- Prefer explicit names over abbreviations
- Avoid adding dependencies unless necessary
- Avoid global state unless it is immutable configuration
- No secrets in logs, configs, or fixtures

## Tests

If you change behavior, add or update tests.

Minimum expectations:
- API: unit tests for validation, authz, and error codes
- UI: unit tests for role gating and critical behaviors (for example, settings and polling)
- Docs: update any contract documentation that changed

Run tests locally before opening a PR.

## API and UI contracts

DXCP is an API-first product. If you change:
- Request/response shapes
- Error codes
- Authorization rules
- Settings semantics

You must update the relevant docs:
- docs/API_DESIGN.md
- docs/UI_SPEC.md
- docs/DOMAIN_MODEL.md
- docs/ADMIN_SURFACES.md

## Commit messages

Use short, direct messages:
- "fix: <what>"
- "feat: <what>"
- "docs: <what>"

Examples:
- "fix: enforce recipe allowlist in delivery group"
- "feat: add config sanity endpoint"
- "docs: align domain model with api responses"

## Reporting security issues

Do not open public issues for security-sensitive problems.
Instead, contact the maintainer directly (see CODEOWNERS or repo owner).

## License

By contributing, you agree that your contributions will be licensed under the LICENSE file in this repository.
