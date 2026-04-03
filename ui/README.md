# DXCP UI (Phase 5)

This is a minimal React UI for DXCP with deploy, deployments list, detail, failures, and rollback.

## Local run

Install dependencies:

```
cd dxcp/ui
npm install
```

Start dev server:

```
npm run dev
```

Open http://127.0.0.1:5173

## Tests

Run UI tests:

```
npm run test:run
```

## Configuration

Create `ui/.env.local` with the Auth0 and API configuration:

```
VITE_API_BASE=http://127.0.0.1:8000
VITE_AUTH0_DOMAIN=<tenant>.us.auth0.com
VITE_AUTH0_CLIENT_ID=<client_id>
VITE_AUTH0_AUDIENCE=https://dxcp-api
VITE_AUTH0_ROLES_CLAIM=https://dxcp.example/claims/roles
VITE_SERVICE_URL_BASE=
```

Notes:
- Environment is selected from /v1/environments and scopes deploy, running state, and deployment history.
- Version input is validated locally before submit.
- Rollback prompts for confirmation and uses idempotency keys.
- Services come from the backend registry (/v1/services).
- Production uses /config.json for runtime Auth0 and API configuration (see docs/AUTH.md).

## Shared UI Components

Before creating a new UI primitive, check the existing shared components first and reuse them where possible.

Core shared components in `ui/src/components`:
- `AlertRail.jsx`: global alert rail and alert presentation shell.
- `AppShell.jsx`: primary shell wrapper for legacy app layout.
- `DefinitionGrid.jsx`: labeled value grid for compact detail summaries.
- `HeaderStatus.jsx`: small status treatment in page headers.
- `InfoTooltip.jsx`: lightweight inline help / info disclosure.
- `LayoutContainer.jsx`: bounded page-width layout container.
- `LoadingText.jsx`: loading text treatment.
- `OperationalDataList.jsx`: shared operational list/table control used by collection-style screens such as Applications and Environment Service routing.
- `PageHeader.jsx`: legacy page header composition.
- `SectionCard.jsx`: standard section surface/card wrapper.
- `TwoColumn.jsx`: primary/supporting two-column layout primitive.

New experience shared primitives in `ui/src/new-experience`:
- `NewBackToCollectionButton.jsx`: reusable back-to-collection pattern button with a leading chevron for collection-to-detail flows.
- `NewExperiencePageHeader.jsx`: reusable page/object header for `/new/*` screens.
- `NewExperienceShell.jsx`: new experience shell and alert/sticky rail integration helpers.
- `NewExperienceStatePrimitives.jsx`: shared explanation blocks and state blocks for loading/empty/failure/degraded states.
- `NewExperienceAdminWorkspaceShell.jsx`: admin workspace shell and subsection strip.
- `NewQuietIconButton.jsx`: reusable low-emphasis icon-only action button for lightweight page actions such as refresh.
- `NewRefreshButton.jsx`: reusable standard refresh action for new-experience page and panel toolbars.
- `NewSegmentedTabs.jsx`: reusable compact segmented tab control for rounded enterprise panels.

Reuse guidance:
- Prefer composition with these primitives over creating one-off wrappers.
- If a new pattern is needed more than once, promote it into one of these shared locations instead of duplicating local markup.
- When adding a new shared primitive, update this README so future Codex sessions can discover it quickly.
