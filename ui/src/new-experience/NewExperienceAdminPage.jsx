import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import OperationalDataList from '../components/OperationalDataList.jsx'
import SectionCard from '../components/SectionCard.jsx'
import NewExperiencePageHeader from './NewExperiencePageHeader.jsx'
import NewExperienceAdminWorkspaceShell, { NewExperienceAdminSectionStrip } from './NewExperienceAdminWorkspaceShell.jsx'
import NewSegmentedTabs from './NewSegmentedTabs.jsx'
import { NewExplanation, NewStateBlock } from './NewExperienceStatePrimitives.jsx'
import { useNewExperienceAlertRail, useNewExperienceStickyRail } from './NewExperienceShell.jsx'
import {
  createAdminEnvironment,
  deleteAdminEnvironment,
  loadAdminEnvironmentWorkspace,
  loadAdminServiceEnvironmentRouting,
  saveAdminServiceEnvironmentRouting,
  updateAdminEnvironment
} from './newExperienceAdminData.js'

const ADMIN_TABS = [
  {
    id: 'delivery-groups',
    label: 'Delivery Groups',
    description: 'Define governance boundaries, ownership, and rollout guardrails for groups of services.'
  },
  {
    id: 'recipes',
    label: 'Recipes',
    description: 'Manage reusable delivery behavior patterns and review where recipes fit in the platform model.'
  },
  {
    id: 'environments',
    label: 'Environments',
    description: 'Manage environment lifecycle and the routing that selects delivery behavior for new deploys.'
  },
  {
    id: 'system-settings',
    label: 'System Settings',
    description: 'Configure platform-wide guardrails, operational limits, and administrative posture.'
  }
]

const DEFAULT_TAB = 'delivery-groups'

function BlockedAdminState({ role }) {
  useNewExperienceAlertRail([
    {
      id: 'admin-blocked-access',
      tone: 'danger',
      title: 'Admin access required',
      body: 'This area is limited to platform administration. Use Applications, Deployments, or Insights for standard delivery work.'
    }
  ])

  return (
    <>
      <NewExperiencePageHeader
        title="Admin"
        objectIdentity="Admin workspace"
        role={role}
        stateSummaryItems={[{ label: 'Workspace access', value: 'Unavailable' }]}
        primaryAction={{ label: 'Admin', state: 'unavailable' }}
        secondaryActions={[
          { label: 'Open Applications', to: '/new/applications' },
          { label: 'Open Deployments', to: '/new/deployments' },
          { label: 'Open Insights', to: '/new/insights' }
        ]}
      />
      <NewStateBlock
        eyebrow="Blocked access"
        title="Admin access required"
        tone="danger"
        actions={[
          { label: 'Open Applications', to: '/new/applications' },
          { label: 'Open Deployments', to: '/new/deployments', secondary: true },
          { label: 'Open Insights', to: '/new/insights', secondary: true }
        ]}
      >
        This area is limited to platform administration. Use Applications, Deployments, or Insights for standard delivery work.
      </NewStateBlock>
    </>
  )
}

function lifecycleBadgeLabel(state) {
  if (state === 'retired') return 'Retired'
  if (state === 'disabled') return 'Disabled'
  return 'Active'
}

function lifecycleBadgeClass(state) {
  if (state === 'retired') return 'new-admin-status-pill'
  if (state === 'disabled') return 'new-admin-status-pill is-disabled'
  return 'new-admin-status-pill is-enabled'
}

function environmentTypeLabel(type) {
  return type === 'prod' ? 'Production' : 'Non-production'
}

function environmentLifecycleSummary(state) {
  if (state === 'retired') return 'Preserved for history, diagnostics, and auditability.'
  if (state === 'disabled') return 'Temporarily unavailable for new deploys.'
  return 'Available for new deploys.'
}

function createEmptyEnvironmentDraft() {
  return { id: '', displayName: '', type: 'non_prod', lifecycleState: 'active' }
}

function environmentDraftMatchesRow(draft, row) {
  if (!row) return false
  return (
    (draft.id || '').trim() === (row.id || '').trim() &&
    (draft.displayName || '').trim() === (row.displayName || '').trim() &&
    (draft.type || 'non_prod') === (row.type || 'non_prod') &&
    (draft.lifecycleState || 'active') === (row.lifecycleState || 'active')
  )
}

const ENVIRONMENT_COLUMNS = [
  { key: 'environment', label: 'Environment', width: 'minmax(260px, 2.2fr)' },
  { key: 'id', label: 'ID', width: 'minmax(140px, 1fr)' },
  { key: 'type', label: 'Type', width: 'minmax(130px, 0.9fr)' },
  { key: 'lifecycle', label: 'Lifecycle', width: 'minmax(120px, 0.8fr)', cellClassName: 'operational-list-cell-status' },
  { key: 'actions', label: 'Actions', width: 'minmax(180px, 1fr)', cellClassName: 'operational-list-cell-action', isAction: true }
]

const ENVIRONMENT_SERVICE_ROUTING_COLUMNS = [
  { key: 'service', label: 'Service', width: 'minmax(220px, 1.2fr)' },
  { key: 'recipe', label: 'Recipe', width: 'minmax(260px, 1.4fr)', isAction: true }
]

function EnvironmentSummary({ rows }) {
  const activeCount = rows.filter((row) => row.lifecycleState === 'active').length
  const disabledCount = rows.filter((row) => row.lifecycleState === 'disabled').length
  const retiredCount = rows.filter((row) => row.lifecycleState === 'retired').length

  return (
    <div className="new-admin-inline-summary" aria-label="Environment summary">
      <div className="new-admin-inline-summary-item">
        <span>Configured</span>
        <strong>{rows.length}</strong>
      </div>
      <div className="new-admin-inline-summary-item">
        <span>Active</span>
        <strong>{activeCount}</strong>
      </div>
      <div className="new-admin-inline-summary-item">
        <span>Disabled</span>
        <strong>{disabledCount}</strong>
      </div>
      <div className="new-admin-inline-summary-item">
        <span>Retired</span>
        <strong>{retiredCount}</strong>
      </div>
    </div>
  )
}

function EnvironmentsPanel({ api }) {
  const [workspaceState, setWorkspaceState] = useState({ kind: 'loading', viewModel: null, errorMessage: '' })
  const [draft, setDraft] = useState(createEmptyEnvironmentDraft)
  const [editingId, setEditingId] = useState('')
  const [viewMode, setViewMode] = useState('list')
  const [detailTab, setDetailTab] = useState('details')
  const [message, setMessage] = useState({ tone: '', title: '', body: '' })
  const [searchTerm, setSearchTerm] = useState('')
  const [environmentRoutingState, setEnvironmentRoutingState] = useState({ kind: 'idle', rows: [], errorMessage: '' })

  const loadWorkspace = useCallback(async (options = {}) => {
    setWorkspaceState((current) => ({
      kind: current.kind === 'ready' || current.kind === 'degraded' ? 'refreshing' : 'loading',
      viewModel: current.viewModel,
      errorMessage: ''
    }))
    const result = await loadAdminEnvironmentWorkspace(api, options)
    setWorkspaceState(result)
  }, [api])

  useEffect(() => {
    loadWorkspace()
  }, [loadWorkspace])

  const rows = useMemo(() => workspaceState.viewModel?.environments || [], [workspaceState.viewModel?.environments])
  const recipes = useMemo(() => workspaceState.viewModel?.recipes || [], [workspaceState.viewModel?.recipes])
  const services = useMemo(() => workspaceState.viewModel?.services || [], [workspaceState.viewModel?.services])
  const degradedReasons = useMemo(
    () => workspaceState.viewModel?.degradedReasons || [],
    [workspaceState.viewModel?.degradedReasons]
  )
  const visibleRows = useMemo(() => {
    const normalizedSearchTerm = searchTerm.trim().toLowerCase()
    if (!normalizedSearchTerm) return rows
    return rows.filter((row) =>
      [row.id, row.displayName, environmentTypeLabel(row.type), lifecycleBadgeLabel(row.lifecycleState)]
        .join(' ')
        .toLowerCase()
        .includes(normalizedSearchTerm)
    )
  }, [rows, searchTerm])
  const hasNoSearchResults = rows.length > 0 && visibleRows.length === 0
  const selectedEnvironment = useMemo(() => rows.find((row) => row.id === editingId) || null, [editingId, rows])
  const isCreating = viewMode === 'create'
  const isDetail = viewMode === 'detail' && Boolean(editingId)
  const hasDetailChanges = useMemo(() => {
    if (isCreating) {
      return (
        draft.id.trim().length > 0 ||
        draft.displayName.trim().length > 0 ||
        draft.type !== 'non_prod' ||
        draft.lifecycleState !== 'active'
      )
    }
    if (!isDetail || !selectedEnvironment) return false
    return !environmentDraftMatchesRow(draft, selectedEnvironment)
  }, [draft, isCreating, isDetail, selectedEnvironment])

  const loadEnvironmentRouting = useCallback(async (environmentId, options = {}) => {
    if (!environmentId) {
      setEnvironmentRoutingState({ kind: 'idle', rows: [], errorMessage: '' })
      return
    }
    if (services.length === 0) {
      setEnvironmentRoutingState({ kind: 'empty', rows: [], errorMessage: '' })
      return
    }
    setEnvironmentRoutingState((current) => ({
      kind: current.kind === 'ready' || current.kind === 'degraded' ? 'refreshing' : 'loading',
      rows: current.rows,
      errorMessage: ''
    }))
    const results = await Promise.all(
      services.map(async (serviceId) => ({
        serviceId,
        result: await loadAdminServiceEnvironmentRouting(api, serviceId, options)
      }))
    )
    const routingRows = []
    const failedServices = []
    results.forEach(({ serviceId, result }) => {
      if (result.kind === 'failure') {
        failedServices.push(serviceId)
        return
      }
      const matchedRow = (result.rows || []).find((row) => row.environmentId === environmentId)
      routingRows.push(
        matchedRow || {
          serviceId,
          environmentId,
          displayName: selectedEnvironment?.displayName || draft.displayName || environmentId,
          type: selectedEnvironment?.type || draft.type || 'non_prod',
          lifecycleState: selectedEnvironment?.lifecycleState || draft.lifecycleState || 'active',
          recipeId: ''
        }
      )
    })
    const orderedRows = routingRows.slice().sort((left, right) => left.serviceId.localeCompare(right.serviceId))
    if (failedServices.length === services.length) {
      setEnvironmentRoutingState({
        kind: 'failure',
        rows: [],
        errorMessage: 'DXCP could not load service-environment routing for this environment right now.'
      })
      return
    }
    if (orderedRows.length === 0) {
      setEnvironmentRoutingState({ kind: 'empty', rows: [], errorMessage: '' })
      return
    }
    setEnvironmentRoutingState({
      kind: failedServices.length > 0 ? 'degraded' : 'ready',
      rows: orderedRows,
      errorMessage:
        failedServices.length > 0
          ? `Some services could not be refreshed for this environment: ${failedServices.join(', ')}.`
          : ''
    })
  }, [api, draft.displayName, draft.lifecycleState, draft.type, selectedEnvironment?.displayName, selectedEnvironment?.lifecycleState, selectedEnvironment?.type, services])

  useEffect(() => {
    if (!isDetail) {
      setEnvironmentRoutingState({ kind: 'idle', rows: [], errorMessage: '' })
      return
    }
    loadEnvironmentRouting(editingId)
  }, [editingId, isDetail, loadEnvironmentRouting])

  useEffect(() => {
    if (viewMode !== 'detail') return
    if (selectedEnvironment) return
    setViewMode('list')
    setEditingId('')
    setDraft(createEmptyEnvironmentDraft())
  }, [selectedEnvironment, viewMode])

  const openListView = () => {
    setViewMode('list')
    setEditingId('')
    setDraft(createEmptyEnvironmentDraft())
    setDetailTab('details')
  }

  const beginCreate = () => {
    setViewMode('create')
    setEditingId('')
    setDraft(createEmptyEnvironmentDraft())
    setDetailTab('details')
    setMessage({ tone: '', title: '', body: '' })
  }

  const openDetail = (row) => {
    setViewMode('detail')
    setEditingId(row.id)
    setDetailTab('details')
    setDraft({
      id: row.id,
      displayName: row.displayName || row.id,
      type: row.type || 'non_prod',
      lifecycleState: row.lifecycleState || 'active'
    })
    setMessage({ tone: '', title: '', body: '' })
  }

  const saveEnvironment = async () => {
    if (!draft.id.trim() || !draft.displayName.trim()) {
      setMessage({
        tone: 'danger',
        title: 'Environment details are incomplete.',
        body: 'Environment ID and display name are required before DXCP can save this environment.'
      })
      return
    }
    const wasEditing = isDetail
    const environmentId = draft.id.trim()
    const payload = {
      environment_id: environmentId,
      display_name: draft.displayName.trim(),
      type: draft.type === 'prod' ? 'prod' : 'non_prod',
      lifecycle_state: draft.lifecycleState
    }
    const result = wasEditing
      ? await updateAdminEnvironment(api, editingId, {
          display_name: payload.display_name,
          type: payload.type,
          lifecycle_state: payload.lifecycle_state
        })
      : await createAdminEnvironment(api, payload)
    if (!result.ok) {
      setMessage({
        tone: 'danger',
        title: 'Environment could not be saved.',
        body: result.errorMessage
      })
      return
    }
    setViewMode('detail')
    setEditingId(environmentId)
    setDetailTab(wasEditing ? detailTab : 'details')
    setMessage({
      tone: 'neutral',
      title: wasEditing ? 'Environment updated.' : 'Environment created.',
      body: wasEditing
        ? 'DXCP saved the environment changes. Display name and lifecycle updates preserve historical environment identity.'
        : 'DXCP created the environment. It is now available for policy attachment and service-environment routing.'
    })
    await loadWorkspace({ bypassCache: true })
    await loadEnvironmentRouting(environmentId, { bypassCache: true })
  }

  const deleteEnvironment = async (row) => {
    if (!row?.id) return
    const result = await deleteAdminEnvironment(api, row.id)
    if (!result.ok) {
      const blockedReferences = Array.isArray(result.details?.references) ? result.details.references : []
      setMessage({
        tone: result.code === 'ENVIRONMENT_DELETE_BLOCKED_REFERENCED' ? 'warning' : 'danger',
        title: result.code === 'ENVIRONMENT_DELETE_BLOCKED_REFERENCED' ? 'Delete blocked.' : 'Environment could not be deleted.',
        body:
          result.code === 'ENVIRONMENT_DELETE_BLOCKED_REFERENCED'
            ? `DXCP blocked hard delete because this environment still has references. ${blockedReferences.map((item) => item.message).join(' ')} Retire it instead to remove it from new deploy use while preserving records and auditability.`
            : result.errorMessage
      })
      openDetail(row)
      return
    }
    if (editingId === row.id) {
      openListView()
    }
    setMessage({
      tone: 'neutral',
      title: 'Environment deleted.',
      body: 'DXCP removed the environment because no governance or historical references still depended on it.'
    })
    await loadWorkspace({ bypassCache: true })
  }

  const saveRoute = async (serviceId, environmentId, recipeId) => {
    const result = await saveAdminServiceEnvironmentRouting(api, serviceId, environmentId, recipeId)
    if (!result.ok) {
      setMessage({
        tone: 'danger',
        title: 'Routing could not be saved.',
        body: result.errorMessage
      })
      return
    }
    setMessage({
      tone: 'neutral',
      title: 'Routing saved.',
      body: 'DXCP updated the service-environment route. Normal deploy now resolves delivery behavior from this mapping, subject to delivery-group recipe policy.'
    })
    await loadEnvironmentRouting(environmentId, { bypassCache: true })
  }

  if (workspaceState.kind === 'loading') {
    return (
      <SectionCard className="new-admin-card">
        <div className="new-card-loading" aria-label="Loading environments">
          <div className="new-card-loading-lines">
            <div className="new-card-loading-line new-card-loading-line-1" />
            <div className="new-card-loading-line new-card-loading-line-2" />
            <div className="new-card-loading-line new-card-loading-line-3" />
          </div>
        </div>
      </SectionCard>
    )
  }

  if (workspaceState.kind === 'failure') {
    return (
      <SectionCard className="new-admin-card">
        <NewStateBlock
          eyebrow="Failure"
          title="Environment administration could not be loaded"
          tone="danger"
          actions={[{ label: 'Retry', onClick: () => loadWorkspace({ bypassCache: true }) }]}
        >
          {workspaceState.errorMessage || 'DXCP could not load environment administration data right now.'}
        </NewStateBlock>
      </SectionCard>
    )
  }

  if (viewMode === 'list') {
    return (
      <div className="new-admin-stack">
        <SectionCard className="new-admin-card">
          <div className="new-admin-panel-header">
            <div>
              <h3>Environments</h3>
            </div>
            <div className="new-admin-toolbar-actions">
              <button className="button secondary" type="button" onClick={() => loadWorkspace({ bypassCache: true })}>
                {workspaceState.kind === 'refreshing' ? 'Refreshing...' : 'Refresh'}
              </button>
              <button className="button" type="button" onClick={beginCreate}>
                Create environment
              </button>
            </div>
          </div>

          <EnvironmentSummary rows={rows} />
          {degradedReasons.length > 0 ? (
            <NewExplanation title="Supporting admin reads are degraded" tone="warning">
              {degradedReasons.join(' ')}
            </NewExplanation>
          ) : null}
          {message.title ? (
            <NewExplanation title={message.title} tone={message.tone || 'neutral'}>
              {message.body}
            </NewExplanation>
          ) : null}

          <div className="new-admin-surface-card">
            <div className="new-section-header new-collection-header">
              <div>
                <h3>Environment list</h3>
              </div>
            </div>

            <div className="new-applications-chooser-toolbar">
              <label className="new-applications-search" htmlFor="admin-environment-search">
                <span>Search</span>
                <input
                  id="admin-environment-search"
                  type="search"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Search environments"
                  aria-label="Search environments"
                />
              </label>
            </div>

            {rows.length === 0 ? (
              <NewStateBlock
                eyebrow="Empty"
                title="No environments configured"
                actions={[{ label: 'Create environment', onClick: beginCreate }]}
              >
                Create an environment to establish its lifecycle, make it available for routing, and preserve its identity across deployment history.
              </NewStateBlock>
            ) : hasNoSearchResults ? (
              <NewStateBlock
                eyebrow="No results"
                title="No environments match this search"
                tone="warning"
                actions={[{ label: 'Clear search', onClick: () => setSearchTerm('') }]}
              >
                Try a different environment name, identifier, type, or lifecycle value.
              </NewStateBlock>
            ) : (
              <OperationalDataList
                ariaLabel="Environment collection"
                columns={ENVIRONMENT_COLUMNS}
                rows={visibleRows}
                footerSummary={`${visibleRows.length} environment${visibleRows.length === 1 ? '' : 's'}`}
                getRowKey={(row) => row.id}
                getRowAction={(row) => ({ label: `Open ${row.displayName || row.id}`, onClick: () => openDetail(row) })}
                renderCell={(row, column) => {
                  if (column.key === 'environment') {
                    return (
                      <div className="new-application-name-cell">
                        <span className="new-application-name">{row.displayName || row.id}</span>
                        <span className="new-operational-text">{`${environmentTypeLabel(row.type)} environment`}</span>
                      </div>
                    )
                  }
                  if (column.key === 'id') return <span className="new-operational-text">{row.id}</span>
                  if (column.key === 'type') return <span className="new-operational-text">{environmentTypeLabel(row.type)}</span>
                  if (column.key === 'lifecycle') return <span className={lifecycleBadgeClass(row.lifecycleState)}>{lifecycleBadgeLabel(row.lifecycleState)}</span>
                  if (column.key === 'actions') {
                    return (
                      <div className="new-admin-inline-actions">
                        <button className="button secondary" type="button" onClick={() => openDetail(row)}>
                          View
                        </button>
                        <button className="button secondary" type="button" onClick={() => deleteEnvironment(row)}>
                          Delete
                        </button>
                      </div>
                    )
                  }
                  return null
                }}
                renderSecondaryRow={(row) => <p className="operational-list-note">{environmentLifecycleSummary(row.lifecycleState)}</p>}
              />
            )}
          </div>
        </SectionCard>
      </div>
    )
  }

  return (
    <div className="new-admin-stack">
      <NewExperiencePageHeader
        title={isCreating ? 'Create environment' : 'Environment'}
        objectIdentity={isDetail ? (draft.displayName || draft.id) : undefined}
        primaryAction={{
          label: isCreating ? 'Create environment' : 'Save changes',
          onClick: saveEnvironment,
          disabled: isCreating ? !draft.id.trim() || !draft.displayName.trim() : !hasDetailChanges
        }}
        secondaryActions={[
          { label: 'Back to Environments', onClick: openListView },
          ...(isDetail ? [{ label: 'Delete', onClick: () => deleteEnvironment(selectedEnvironment || { id: editingId }) }] : [])
        ]}
        role="PLATFORM_ADMIN"
        showRoleNote={false}
        showActionNote={false}
      />

      {message.title ? (
        <NewExplanation title={message.title} tone={message.tone || 'neutral'}>
          {message.body}
        </NewExplanation>
      ) : null}

      <SectionCard className="new-admin-surface-card">
        <div className="new-section-header"><div><h3>Summary</h3></div></div>
        <dl className="new-object-summary-grid">
          <dt>Environment ID</dt>
          <dd>{isCreating ? 'Assigned on create' : draft.id}</dd>
          <dt>Display name</dt>
          <dd>{draft.displayName || 'Not set'}</dd>
          <dt>Type</dt>
          <dd>{environmentTypeLabel(draft.type)}</dd>
          <dt>Lifecycle</dt>
          <dd>{lifecycleBadgeLabel(draft.lifecycleState)}</dd>
        </dl>
      </SectionCard>

      <NewSegmentedTabs
        ariaLabel="Environment detail tabs"
        activeTab={detailTab}
        onChange={setDetailTab}
        tabs={[
          { id: 'details', label: 'Details' },
          { id: 'routing', label: 'Service routing', disabled: isCreating }
        ]}
      />

      <SectionCard className="new-admin-surface-card">
        {detailTab === 'details' ? (
          <>
            <div className="new-section-header"><div><h3>{isCreating ? 'Name, review, and create' : 'Environment details'}</h3></div></div>
            <div className="new-admin-editor-note">
              <strong>{isDetail ? 'Environment ID is locked' : 'Choose a stable environment ID'}</strong>
              <p>
                {isDetail
                  ? 'DXCP preserves the ID so deploy history, routing, and diagnostics keep the same environment meaning.'
                  : 'Use a durable identifier such as sandbox, staging, or production. DXCP uses this value in APIs, history, and routing.'}
              </p>
            </div>

            <div className="new-intent-entry-grid">
              <label className="new-field" htmlFor="admin-environment-id">
                <span>Environment ID</span>
                <input id="admin-environment-id" data-testid="admin-environment-id-input" value={draft.id} disabled={isDetail} onChange={(event) => setDraft((current) => ({ ...current, id: event.target.value }))} placeholder="dev, staging, prod" />
              </label>
              <label className="new-field" htmlFor="admin-environment-display-name">
                <span>Display name</span>
                <input id="admin-environment-display-name" value={draft.displayName} onChange={(event) => setDraft((current) => ({ ...current, displayName: event.target.value }))} />
              </label>
              <label className="new-field" htmlFor="admin-environment-type">
                <span>Type</span>
                <select id="admin-environment-type" value={draft.type} onChange={(event) => setDraft((current) => ({ ...current, type: event.target.value }))}>
                  <option value="non_prod">Non-production</option>
                  <option value="prod">Production</option>
                </select>
              </label>
              <label className="new-field" htmlFor="admin-environment-lifecycle">
                <span>Lifecycle</span>
                <select id="admin-environment-lifecycle" value={draft.lifecycleState} onChange={(event) => setDraft((current) => ({ ...current, lifecycleState: event.target.value }))}>
                  <option value="active">Active</option>
                  <option value="disabled">Disabled</option>
                  <option value="retired">Retired</option>
                </select>
              </label>
            </div>

            {isCreating ? (
              <div className="new-admin-actions">
                <button className="button" type="button" data-testid="admin-environment-save" onClick={saveEnvironment}>
                  Create environment
                </button>
                <button className="button secondary" type="button" onClick={openListView}>
                  Cancel
                </button>
              </div>
            ) : null}
          </>
        ) : (
          <>
            <div className="new-section-header"><div><h3>Service routing</h3></div></div>
            {environmentRoutingState.kind === 'failure' ? (
              <NewStateBlock eyebrow="Failure" title="Routing could not be loaded" tone="warning">
                {environmentRoutingState.errorMessage}
              </NewStateBlock>
            ) : environmentRoutingState.kind === 'empty' ? (
              <NewStateBlock eyebrow="Empty" title="No routing rows are available">
                DXCP does not currently have any services to route for this environment.
              </NewStateBlock>
            ) : (
              <>
                {environmentRoutingState.kind === 'degraded' ? (
                  <NewExplanation title="Routing is partially degraded" tone="warning">
                    {environmentRoutingState.errorMessage}
                  </NewExplanation>
                ) : null}
                <OperationalDataList
                  ariaLabel="Environment service routing"
                  columns={ENVIRONMENT_SERVICE_ROUTING_COLUMNS}
                  rows={environmentRoutingState.rows || []}
                  footerSummary={`${(environmentRoutingState.rows || []).length} service route${(environmentRoutingState.rows || []).length === 1 ? '' : 's'}`}
                  getRowKey={(row) => `${row.serviceId}-${row.environmentId}`}
                  renderCell={(row, column) => {
                    if (column.key === 'service') {
                      return <div className="new-application-name-cell"><span className="new-application-name">{row.serviceId}</span><span className="new-operational-text">{row.recipeId ? 'Normal deploy resolves through this mapping.' : 'No recipe is currently routed for this service.'}</span></div>
                    }
                    if (column.key === 'recipe') {
                      return (
                        <label className="new-field new-admin-inline-field" htmlFor={`admin-route-${row.serviceId}`}>
                          <span>Recipe</span>
                          <select id={`admin-route-${row.serviceId}`} data-testid="admin-service-route-save" value={row.recipeId} disabled={draft.lifecycleState === 'retired'} onChange={(event) => saveRoute(row.serviceId, row.environmentId, event.target.value)}>
                            <option value="">Choose recipe</option>
                            {recipes.map((recipe) => <option key={recipe.id} value={recipe.id}>{recipe.name}</option>)}
                          </select>
                        </label>
                      )
                    }
                    return null
                  }}
                  renderSecondaryRow={() => <p className="operational-list-note">Delivery-group recipe policy still independently authorizes the routed recipe.</p>}
                />
              </>
            )}
          </>
        )}
      </SectionCard>
    </div>
  )
}

function RecipesPanel({ api }) {
  const [state, setState] = useState({ kind: 'loading', viewModel: null, errorMessage: '' })

  const load = useCallback(async (options = {}) => {
    setState((current) => ({
      kind: current.kind === 'ready' || current.kind === 'degraded' ? 'refreshing' : 'loading',
      viewModel: current.viewModel,
      errorMessage: ''
    }))
    const result = await loadAdminEnvironmentWorkspace(api, options)
    setState(result)
  }, [api])

  useEffect(() => {
    load()
  }, [load])

  if (state.kind === 'loading') {
    return (
      <SectionCard className="new-admin-card">
        <div className="new-card-loading" aria-label="Loading recipes">
          <div className="new-card-loading-lines">
            <div className="new-card-loading-line new-card-loading-line-1" />
            <div className="new-card-loading-line new-card-loading-line-2" />
            <div className="new-card-loading-line new-card-loading-line-3" />
          </div>
        </div>
      </SectionCard>
    )
  }

  if (state.kind === 'failure') {
    return (
      <SectionCard className="new-admin-card">
        <NewStateBlock eyebrow="Failure" title="Recipes could not be loaded" tone="danger">
          {state.errorMessage || 'DXCP could not load recipes right now.'}
        </NewStateBlock>
      </SectionCard>
    )
  }

  const recipes = state.viewModel?.recipes || []

  return (
    <SectionCard className="new-admin-card">
      <div className="new-admin-panel-header">
        <div>
          <span className="new-admin-panel-eyebrow">Execution patterns</span>
          <h3>Recipes</h3>
          <p>Recipes remain admin-owned delivery behavior definitions. Normal deploy uses them through routing and policy, not as a primary operator choice.</p>
        </div>
      </div>

      <div className="new-explanation-stack">
        <NewExplanation title="Recipe framing" tone="neutral">
          Recipes still matter for diagnostics, revisions, records, and controlled admin work. Service-environment routing selects the candidate recipe, and delivery-group allowed_recipes still authorizes it separately.
        </NewExplanation>
      </div>

      <div className="new-admin-environment-list" role="list" aria-label="Recipes">
        {recipes.map((recipe) => (
          <article key={recipe.id} className="new-admin-environment-item" role="listitem">
            <div className="new-admin-environment-main">
              <div className="new-admin-environment-name-row">
                <strong>{recipe.name}</strong>
                <span className={recipe.status === 'deprecated' ? 'new-admin-status-pill' : 'new-admin-status-pill is-enabled'}>
                  {recipe.status === 'deprecated' ? 'Deprecated' : 'Active'}
                </span>
              </div>
              <p>{recipe.summary || 'No behavior summary is available for this recipe.'}</p>
            </div>
            <dl className="new-admin-environment-meta">
              <div>
                <dt>ID</dt>
                <dd>{recipe.id}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{recipe.status}</dd>
              </div>
            </dl>
          </article>
        ))}
      </div>
    </SectionCard>
  )
}

function PlaceholderPanel({ eyebrow, title, description, emptyTitle, emptyBody }) {
  return (
    <SectionCard className="new-admin-card">
      <div className="new-admin-panel-header">
        <div>
          <span className="new-admin-panel-eyebrow">{eyebrow}</span>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
      </div>
      <div className="new-admin-empty-card">
        <strong>{emptyTitle}</strong>
        <p>{emptyBody}</p>
      </div>
    </SectionCard>
  )
}

export default function NewExperienceAdminPage({ role = 'UNKNOWN', api }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedTab = searchParams.get('tab')

  useEffect(() => {
    if (role !== 'PLATFORM_ADMIN') return
    if (ADMIN_TABS.some((tab) => tab.id === requestedTab)) return
    const nextParams = new URLSearchParams(searchParams)
    nextParams.set('tab', DEFAULT_TAB)
    setSearchParams(nextParams, { replace: true })
  }, [requestedTab, role, searchParams, setSearchParams])

  const activeTab = useMemo(
    () => (ADMIN_TABS.some((tab) => tab.id === requestedTab) ? requestedTab : DEFAULT_TAB),
    [requestedTab]
  )

  useNewExperienceAlertRail([])

  const handleSelectTab = useCallback((tabId) => {
    const nextParams = new URLSearchParams(searchParams)
    nextParams.set('tab', tabId)
    setSearchParams(nextParams)
  }, [searchParams, setSearchParams])

  const stickyAdminStrip = useMemo(
    () => (
      <NewExperienceAdminSectionStrip
        tabs={ADMIN_TABS}
        activeTab={activeTab}
        onSelectTab={handleSelectTab}
      />
    ),
    [activeTab, handleSelectTab]
  )

  useNewExperienceStickyRail(role === 'PLATFORM_ADMIN' ? stickyAdminStrip : null)

  if (role !== 'PLATFORM_ADMIN') {
    return <BlockedAdminState role={role} />
  }

  let panel = null
  if (activeTab === 'delivery-groups') {
    panel = (
      <PlaceholderPanel
        eyebrow="Policy boundaries"
        title="Delivery Groups"
        description="Define governance boundaries, ownership, and rollout guardrails for groups of services."
        emptyTitle="Delivery-group policy remains the independent guardrail"
        emptyBody="Routing chooses a candidate recipe, but Delivery Group policy still authorizes that recipe separately. Delivery-group editing remains available on the existing admin surface while the new workspace continues to absorb governance workflows."
      />
    )
  } else if (activeTab === 'recipes') {
    panel = <RecipesPanel api={api} />
  } else if (activeTab === 'environments') {
    panel = <EnvironmentsPanel api={api} />
  } else if (activeTab === 'system-settings') {
    panel = (
      <PlaceholderPanel
        eyebrow="Platform controls"
        title="System Settings"
        description="Configure platform-wide guardrails, operational limits, and administrative posture."
        emptyTitle="System settings remain unchanged in this stage"
        emptyBody="This stage focuses on Option A deploy alignment, explicit routing, and environment lifecycle governance without widening the platform-settings surface."
      />
    )
  }

  return (
    <div className="new-admin-page">
      <NewExperienceAdminWorkspaceShell>
        {panel}
      </NewExperienceAdminWorkspaceShell>
    </div>
  )
}
