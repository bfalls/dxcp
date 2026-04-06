import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import InfoTooltip from '../components/InfoTooltip.jsx'
import LoadingText from '../components/LoadingText.jsx'
import OperationalDataList from '../components/OperationalDataList.jsx'
import SectionCard from '../components/SectionCard.jsx'
import NewExperiencePageHeader from './NewExperiencePageHeader.jsx'
import NewExperienceAdminWorkspaceShell, { NewExperienceAdminSectionStrip } from './NewExperienceAdminWorkspaceShell.jsx'
import NewRefreshButton from './NewRefreshButton.jsx'
import NewSectionDivider from './NewSectionDivider.jsx'
import NewSegmentedTabs from './NewSegmentedTabs.jsx'
import { NewExplanation, NewStateBlock } from './NewExperienceStatePrimitives.jsx'
import {
  displayConfigSource,
  displayConnectionMode,
  displayEngineType,
  displayEnvironmentType,
  displayLifecycleStatus,
  displayValidationStatus
} from './newExperienceDisplayLabels.js'
import { useNewExperienceAlertRail, useNewExperienceStickyRail } from './NewExperienceShell.jsx'
import {
  createAdminEnvironment,
  loadAdminEngineAdapterWorkspace,
  loadAdminData,
  createAdminRecipe,
  deleteAdminEnvironment,
  deleteAdminRecipe,
  loadAdminRecipeWorkspace,
  loadAdminEnvironmentWorkspace,
  loadAdminServiceEnvironmentRouting,
  saveAdminEngineAdapter,
  saveAdminServiceEnvironmentRouting,
  updateAdminEnvironment,
  updateAdminRecipe,
  validateAdminEngineAdapter
} from './newExperienceAdminData.js'

const ADMIN_TABS = [
  {
    id: 'engine-adapters',
    label: 'Engine',
    description: 'Configure the deployment engine connection DXCP uses for governed delivery execution.'
  },
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

const DEFAULT_TAB = 'engine-adapters'

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

function lifecycleBadgeClass(state) {
  if (state === 'retired') return 'new-admin-status-pill'
  if (state === 'disabled') return 'new-admin-status-pill is-disabled'
  return 'new-admin-status-pill is-enabled'
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

function parseDeliveryGroupOwners(ownerValue) {
  if (!ownerValue) return []
  return String(ownerValue)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function summarizeDeliveryGroupOwners(ownerValue) {
  const owners = parseDeliveryGroupOwners(ownerValue)
  if (owners.length === 0) return 'Owners not provided'
  if (owners.length === 1) return owners[0]
  if (owners.length === 2) return owners.join(', ')
  return `${owners[0]}, ${owners[1]} +${owners.length - 2}`
}

function formatDeliveryGroupGuardrails(guardrails) {
  const maxConcurrentDeployments = Number(guardrails?.maxConcurrentDeployments)
  const dailyDeployQuota = Number(guardrails?.dailyDeployQuota)
  const dailyRollbackQuota = Number(guardrails?.dailyRollbackQuota)

  return [
    Number.isFinite(maxConcurrentDeployments) ? `Max ${maxConcurrentDeployments} concurrent` : null,
    Number.isFinite(dailyDeployQuota) ? `Deploy ${dailyDeployQuota}/day` : null,
    Number.isFinite(dailyRollbackQuota) ? `Rollback ${dailyRollbackQuota}/day` : null
  ]
    .filter(Boolean)
    .join(' | ')
}

function DeliveryGroupsSummary({ groups }) {
  const serviceCount = groups.reduce((total, group) => total + (Array.isArray(group.services) ? group.services.length : 0), 0)
  const recipeCount = groups.reduce(
    (total, group) => total + (Array.isArray(group.allowedRecipes) ? group.allowedRecipes.length : 0),
    0
  )

  return (
    <div className="new-admin-inline-summary" aria-label="Delivery group summary">
      <div className="new-admin-inline-summary-item">
        <span>Configured</span>
        <strong>{groups.length}</strong>
      </div>
      <div className="new-admin-inline-summary-item">
        <span>Services</span>
        <strong>{serviceCount}</strong>
      </div>
      <div className="new-admin-inline-summary-item">
        <span>Allowed recipes</span>
        <strong>{recipeCount}</strong>
      </div>
    </div>
  )
}

function DeliveryGroupsPanel({ api }) {
  const [workspaceState, setWorkspaceState] = useState({ kind: 'loading', viewModel: null, errorMessage: '' })
  const [searchTerm, setSearchTerm] = useState('')

  const loadWorkspace = useCallback(async (options = {}) => {
    setWorkspaceState((current) => ({
      kind: current.kind === 'ready' || current.kind === 'degraded' || current.kind === 'empty' ? 'refreshing' : 'loading',
      viewModel: current.viewModel,
      errorMessage: ''
    }))
    const result = await loadAdminData(api, options)
    setWorkspaceState(result)
  }, [api])

  useEffect(() => {
    loadWorkspace()
  }, [loadWorkspace])

  const groups = useMemo(() => workspaceState.viewModel?.groups || [], [workspaceState.viewModel?.groups])
  const degradedReasons = useMemo(
    () => workspaceState.viewModel?.degradedReasons || [],
    [workspaceState.viewModel?.degradedReasons]
  )
  const visibleGroups = useMemo(() => {
    const normalizedSearchTerm = searchTerm.trim().toLowerCase()
    if (!normalizedSearchTerm) return groups
    return groups.filter((group) =>
      [
        group.id,
        group.name,
        group.owner,
        ...(Array.isArray(group.services) ? group.services : []),
        ...(Array.isArray(group.allowedRecipes) ? group.allowedRecipes : [])
      ]
        .join(' ')
        .toLowerCase()
        .includes(normalizedSearchTerm)
    )
  }, [groups, searchTerm])
  const hasNoSearchResults = groups.length > 0 && visibleGroups.length === 0

  if (workspaceState.kind === 'loading') {
    return (
      <SectionCard className="new-admin-card">
        <div className="new-card-loading" aria-label="Loading delivery groups" aria-live="polite" aria-busy="true">
          <LoadingText>Loading...</LoadingText>
          <div className="new-card-loading-lines" aria-hidden="true">
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
          title="Delivery-group administration could not be loaded"
          tone="danger"
          actions={[{ label: 'Retry', onClick: () => loadWorkspace({ bypassCache: true }) }]}
        >
          {workspaceState.errorMessage || 'DXCP could not load delivery-group administration data right now.'}
        </NewStateBlock>
      </SectionCard>
    )
  }

  return (
    <div className="new-admin-stack">
      <SectionCard className="new-admin-card">
        <div className="new-admin-panel-header">
          <div>
            <h3>Delivery Groups</h3>
            <p>Review governance boundaries, service membership, ownership, and recipe authorization.</p>
          </div>
          <div className="new-admin-toolbar-actions">
            <NewRefreshButton
              onClick={() => loadWorkspace({ bypassCache: true })}
              busy={workspaceState.kind === 'refreshing'}
            />
          </div>
        </div>
        <DeliveryGroupsSummary groups={groups} />
        {degradedReasons.length > 0 ? (
          <NewExplanation title="Supporting admin reads are degraded" tone="warning">
            {degradedReasons.join(' ')}
          </NewExplanation>
        ) : null}

        <div className="new-admin-surface-card">
          <div className="new-section-header new-collection-header">
            <div>
              <h3>Delivery group list</h3>
            </div>
          </div>

          <div className="new-applications-chooser-toolbar">
            <label className="new-applications-search" htmlFor="admin-delivery-group-search">
              <span>Search</span>
              <input
                id="admin-delivery-group-search"
                type="search"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search delivery groups"
                aria-label="Search delivery groups"
              />
            </label>
          </div>

          {groups.length === 0 ? (
            <NewStateBlock
              eyebrow="Empty"
              title="No delivery groups configured"
              actions={[{ label: 'Refresh', onClick: () => loadWorkspace({ bypassCache: true }) }]}
            >
              DXCP did not return any delivery-group policy rows for this environment.
            </NewStateBlock>
          ) : hasNoSearchResults ? (
            <NewStateBlock
              eyebrow="No results"
              title="No delivery groups match this search"
              tone="warning"
              actions={[{ label: 'Clear search', onClick: () => setSearchTerm('') }]}
            >
              Try a different delivery-group ID, name, owner, service, or recipe identifier.
            </NewStateBlock>
          ) : (
            <div className="new-admin-stack">
              {visibleGroups.map((group) => (
                <section key={group.id} className="new-admin-surface-card" aria-label={`${group.name || group.id} delivery group`}>
                  <div className="new-section-header">
                    <div>
                      <h3>{group.name || group.id}</h3>
                      <p>{group.description || 'No description provided.'}</p>
                    </div>
                  </div>
                  <dl className="new-object-summary-grid">
                    <dt>Group ID</dt>
                    <dd>{group.id}</dd>
                    <dt>Owners</dt>
                    <dd>{summarizeDeliveryGroupOwners(group.owner)}</dd>
                    <dt>Services</dt>
                    <dd>{Array.isArray(group.services) && group.services.length > 0 ? group.services.join(', ') : 'No services assigned'}</dd>
                    <dt>Allowed recipes</dt>
                    <dd>
                      {Array.isArray(group.allowedRecipes) && group.allowedRecipes.length > 0
                        ? group.allowedRecipes.join(', ')
                        : 'No allowed recipes configured'}
                    </dd>
                    <dt>Guardrails</dt>
                    <dd>{formatDeliveryGroupGuardrails(group.guardrails)}</dd>
                  </dl>
                </section>
              ))}
            </div>
          )}
        </div>
      </SectionCard>
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
      [row.id, row.displayName, displayEnvironmentType(row.type), displayLifecycleStatus(row.lifecycleState)]
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
        <div className="new-card-loading" aria-label="Loading environments" aria-live="polite" aria-busy="true">
          <LoadingText>Loading...</LoadingText>
          <div className="new-card-loading-lines" aria-hidden="true">
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
              <NewRefreshButton
                onClick={() => loadWorkspace({ bypassCache: true })}
                busy={workspaceState.kind === 'refreshing'}
              />
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
                        <span className="new-operational-text">{`${displayEnvironmentType(row.type)} environment`}</span>
                      </div>
                    )
                  }
                  if (column.key === 'id') return <span className="new-operational-text">{row.id}</span>
                  if (column.key === 'type') return <span className="new-operational-text">{displayEnvironmentType(row.type)}</span>
                  if (column.key === 'lifecycle') return <span className={lifecycleBadgeClass(row.lifecycleState)}>{displayLifecycleStatus(row.lifecycleState)}</span>
                  if (column.key === 'actions') {
                    return (
                      <div className="new-admin-inline-actions">
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
        backToCollection={{ label: 'Back to Environments', onClick: openListView }}
        primaryAction={{
          label: isCreating ? 'Create environment' : 'Save changes',
          onClick: saveEnvironment,
          disabled: isCreating ? !draft.id.trim() || !draft.displayName.trim() : !hasDetailChanges
        }}
        secondaryActions={[
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
          <dd>{displayEnvironmentType(draft.type)}</dd>
          <dt>Lifecycle</dt>
          <dd>{displayLifecycleStatus(draft.lifecycleState)}</dd>
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
  return <RecipesWorkspace api={api} />
}

function createEngineAdapterDraft(adapter) {
  const config = adapter?.config || {}
  return {
    engineType: adapter?.engineType || 'SPINNAKER',
    mode: config.mode || 'http',
    gateUrl: config.gateUrl || '',
    gateHeaderName: config.gateHeaderName || '',
    gateHeaderValue: '',
    gateHeaderValueConfigured: config.gateHeaderValueConfigured === true,
    auth0Domain: config.auth0Domain || '',
    auth0ClientId: config.auth0ClientId || '',
    auth0ClientSecret: '',
    auth0ClientSecretConfigured: config.auth0ClientSecretConfigured === true,
    auth0Audience: config.auth0Audience || '',
    auth0Scope: config.auth0Scope || '',
    auth0RefreshSkewSeconds: String(config.auth0RefreshSkewSeconds ?? 60),
    mtlsCertPath: config.mtlsCertPath || '',
    mtlsKeyPath: config.mtlsKeyPath || '',
    mtlsCaPath: config.mtlsCaPath || '',
    mtlsServerName: config.mtlsServerName || '',
    engineLambdaUrl: config.engineLambdaUrl || '',
    engineLambdaToken: '',
    engineLambdaTokenConfigured: config.engineLambdaTokenConfigured === true
  }
}

function buildEngineAdapterPayload(draft) {
  const refreshSkew = Number(draft.auth0RefreshSkewSeconds)
  return {
    engine_type: draft.engineType,
    config: {
      mode: draft.mode,
      gate_url: draft.gateUrl.trim(),
      gate_header_name: draft.gateHeaderName.trim(),
      ...(draft.gateHeaderValue.trim() ? { gate_header_value: draft.gateHeaderValue } : {}),
      auth0_domain: draft.auth0Domain.trim(),
      auth0_client_id: draft.auth0ClientId.trim(),
      ...(draft.auth0ClientSecret.trim() ? { auth0_client_secret: draft.auth0ClientSecret } : {}),
      auth0_audience: draft.auth0Audience.trim(),
      auth0_scope: draft.auth0Scope.trim(),
      auth0_refresh_skew_seconds: Number.isFinite(refreshSkew) ? refreshSkew : draft.auth0RefreshSkewSeconds,
      mtls_cert_path: draft.mtlsCertPath.trim(),
      mtls_key_path: draft.mtlsKeyPath.trim(),
      mtls_ca_path: draft.mtlsCaPath.trim(),
      mtls_server_name: draft.mtlsServerName.trim(),
      engine_lambda_url: draft.engineLambdaUrl.trim(),
      ...(draft.engineLambdaToken.trim() ? { engine_lambda_token: draft.engineLambdaToken } : {})
    }
  }
}

function engineAdapterConfigSummary(adapter, validationState) {
  const config = adapter?.config || {}
  return {
    mode: displayConnectionMode(config.mode || 'http'),
    gateUrl: config.gateUrl || 'Not configured',
    validation: displayValidationStatus(validationState?.result?.status || 'Not checked')
  }
}

function renderValidationItems(items) {
  return Array.isArray(items) && items.length > 0
    ? items.map((item, index) => (
        <p key={`${item.field || 'item'}-${index}`} className="new-operational-text">
          {item.message || item.text || String(item)}
        </p>
      ))
    : null
}

function EngineAdaptersPanel({ api }) {
  const [workspaceState, setWorkspaceState] = useState({ kind: 'loading', viewModel: null, errorMessage: '' })
  const [draft, setDraft] = useState(() => createEngineAdapterDraft())
  const [detailTab, setDetailTab] = useState('details')
  const [message, setMessage] = useState({ tone: '', title: '', body: '' })
  const [validationState, setValidationState] = useState({ busy: false, result: null, errorMessage: '' })

  const loadWorkspace = useCallback(async (options = {}) => {
    setWorkspaceState((current) => ({
      kind: current.kind === 'ready' ? 'refreshing' : 'loading',
      viewModel: current.viewModel,
      errorMessage: ''
    }))
    const result = await loadAdminEngineAdapterWorkspace(api, options)
    setWorkspaceState(result)
    if (result.kind === 'ready') {
      setDraft(createEngineAdapterDraft(result.viewModel?.adapter))
    }
  }, [api])

  useEffect(() => {
    loadWorkspace()
  }, [loadWorkspace])

  const adapter = workspaceState.viewModel?.adapter || null
  const summary = engineAdapterConfigSummary(adapter, validationState)
  const isMtlSMode = draft.mode === 'mtls'
  const isStubMode = draft.mode === 'stub'
  const hasChanges = useMemo(() => {
    if (!adapter) return false
    const base = createEngineAdapterDraft(adapter)
    return JSON.stringify(buildEngineAdapterPayload(draft)) !== JSON.stringify(buildEngineAdapterPayload(base))
  }, [adapter, draft])

  const runValidation = async () => {
    setValidationState({ busy: true, result: null, errorMessage: '' })
    const result = await validateAdminEngineAdapter(api, buildEngineAdapterPayload(draft))
    if (!result.ok) {
      setValidationState({ busy: false, result: null, errorMessage: result.errorMessage })
      return
    }
    setValidationState({ busy: false, result: result.result, errorMessage: '' })
  }

  const saveAdapter = async () => {
    const result = await saveAdminEngineAdapter(api, buildEngineAdapterPayload(draft))
    if (!result.ok) {
      const errors = Array.isArray(result.details?.errors) ? result.details.errors.map((item) => item.message).join(' ') : ''
      setMessage({
        tone: 'danger',
        title: 'Engine adapter settings could not be saved.',
        body: [result.errorMessage, errors].filter(Boolean).join(' ')
      })
      return
    }
    setMessage({
      tone: 'neutral',
      title: 'Engine adapter settings saved.',
      body: 'DXCP updated the primary deployment engine profile and applied the runtime adapter configuration.'
    })
    setValidationState((current) => ({ ...current, result: null, errorMessage: '' }))
    await loadWorkspace({ bypassCache: true })
  }

  if (workspaceState.kind === 'loading') {
    return (
      <SectionCard className="new-admin-card">
        <div className="new-card-loading" aria-label="Loading engine adapters" aria-live="polite" aria-busy="true">
          <LoadingText>Loading...</LoadingText>
          <div className="new-card-loading-lines" aria-hidden="true">
            <div className="new-card-loading-line new-card-loading-line-1" />
            <div className="new-card-loading-line new-card-loading-line-2" />
            <div className="new-card-loading-line new-card-loading-line-3" />
          </div>
        </div>
      </SectionCard>
    )
  }

  if (workspaceState.kind === 'failure' || !adapter) {
    return (
      <SectionCard className="new-admin-card">
        <NewStateBlock
          eyebrow="Failure"
          title="Engine adapter settings could not be loaded"
          tone="danger"
          actions={[{ label: 'Retry', onClick: () => loadWorkspace({ bypassCache: true }) }]}
        >
          {workspaceState.errorMessage || 'DXCP could not load engine adapter settings right now.'}
        </NewStateBlock>
      </SectionCard>
    )
  }

  return (
    <div className="new-admin-stack">
      <SectionCard className="new-admin-card">
        <div className="new-admin-panel-header">
          <div>
            <h3>Deployment Engine</h3>
            <p>Configure the active deployment engine connection DXCP uses for governed execution.</p>
          </div>
          <div className="new-admin-toolbar-actions">
            <NewRefreshButton onClick={() => loadWorkspace({ bypassCache: true })} busy={workspaceState.kind === 'refreshing'} />
            <button className="button" type="button" onClick={runValidation} disabled={validationState.busy}>
              {validationState.busy ? 'Validating...' : 'Validate connection'}
            </button>
            <button className="button" type="button" onClick={saveAdapter} disabled={!hasChanges}>
              Save changes
            </button>
          </div>
        </div>
        {message.title ? <NewExplanation title={message.title} tone={message.tone || 'neutral'}>{message.body}</NewExplanation> : null}
        {validationState.errorMessage ? (
          <NewExplanation title="Validation could not run" tone="danger">{validationState.errorMessage}</NewExplanation>
        ) : null}
        {validationState.result ? (
          <NewExplanation
            title={
              validationState.result.status === 'VALID'
                ? 'Connection validated'
                : validationState.result.status === 'WARNING'
                  ? 'Validation returned warnings'
                  : 'Connection is invalid'
            }
            tone={
              validationState.result.status === 'VALID'
                ? 'neutral'
                : validationState.result.status === 'WARNING'
                  ? 'warning'
                  : 'danger'
            }
          >
            <>
              <p>{validationState.result.summary}</p>
              {renderValidationItems(validationState.result.errors)}
              {renderValidationItems(validationState.result.warnings)}
            </>
          </NewExplanation>
        ) : null}
      </SectionCard>

      <SectionCard className="new-admin-surface-card">
        <div className="new-section-header"><div><h3>Summary</h3></div></div>
        <dl className="new-object-summary-grid">
          <dt>Engine type</dt><dd>{displayEngineType(adapter.engineType)}</dd>
          <dt>Gate</dt><dd>{summary.gateUrl}</dd>
          <dt>Connection mode</dt><dd>{summary.mode}</dd>
          <dt>Validation</dt><dd>{summary.validation}</dd>
        </dl>
      </SectionCard>

      <NewSegmentedTabs
        ariaLabel="Engine adapter detail tabs"
        activeTab={detailTab}
        onChange={setDetailTab}
        tabs={[
          { id: 'details', label: 'Details' },
          { id: 'connection', label: 'Connection' },
          { id: 'review', label: 'Review' }
        ]}
      />

      <SectionCard className="new-admin-surface-card">
        {detailTab === 'details' ? (
          <>
            <div className="new-section-header"><div><h3>Configured Engine</h3></div></div>
            <div className="new-intent-entry-grid">
              <label className="new-field" htmlFor="admin-engine-type">
                <span>Engine type</span>
                <select id="admin-engine-type" value={draft.engineType} onChange={(event) => setDraft((current) => ({ ...current, engineType: event.target.value }))}>
                  {adapter.engineOptions.map((option) => (
                    <option key={option.id} value={option.id} disabled={option.availability !== 'active'}>
                      {option.label || displayEngineType(option.id)}{option.availability !== 'active' ? ' (Not yet supported)' : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label className="new-field" htmlFor="admin-engine-source">
                <span>Config source</span>
                <input id="admin-engine-source" value={displayConfigSource(adapter.source)} disabled />
              </label>
              <label className="new-field" htmlFor="admin-engine-mode">
                <span>Mode</span>
                <select id="admin-engine-mode" value={draft.mode} onChange={(event) => setDraft((current) => ({ ...current, mode: event.target.value }))}>
                  <option value="http">HTTP</option>
                  <option value="mtls">mTLS</option>
                  <option value="stub">Stub (local only)</option>
                </select>
              </label>
            </div>
          </>
        ) : detailTab === 'connection' ? (
          <div className="new-admin-stack new-engine-adapter-connection-sections">
            <div className="new-section-header"><div><h3>Connection</h3></div></div>
            <div className="new-intent-entry-grid new-engine-adapter-connection-grid">
              <label className="new-field" htmlFor="admin-engine-gate-url"><span>Gate URL</span><input id="admin-engine-gate-url" value={draft.gateUrl} onChange={(event) => setDraft((current) => ({ ...current, gateUrl: event.target.value }))} placeholder="https://gate.example.com" disabled={isStubMode} /></label>
              <label className="new-field" htmlFor="admin-engine-header-name"><span>Optional request header name</span><input id="admin-engine-header-name" value={draft.gateHeaderName} onChange={(event) => setDraft((current) => ({ ...current, gateHeaderName: event.target.value }))} placeholder="Authorization, X-Gate-Token" disabled={isStubMode} /></label>
              <label className="new-field new-engine-adapter-connection-grid-secondary" htmlFor="admin-engine-header-value"><span>Optional request header value</span><input id="admin-engine-header-value" type="password" value={draft.gateHeaderValue} onChange={(event) => setDraft((current) => ({ ...current, gateHeaderValue: event.target.value, gateHeaderValueConfigured: current.gateHeaderValueConfigured || event.target.value.trim().length > 0 }))} placeholder={draft.gateHeaderValueConfigured ? 'Configured. Enter a new value to replace it.' : 'Not configured'} disabled={isStubMode} /></label>
            </div>

            {!isMtlSMode && !isStubMode ? (
              <>
                <NewSectionDivider />
                <div className="new-section-header"><div><h3>Auth0 token acquisition</h3></div></div>
                <div className="new-intent-entry-grid">
                  <label className="new-field" htmlFor="admin-engine-auth0-domain"><span>Auth0 domain</span><input id="admin-engine-auth0-domain" value={draft.auth0Domain} onChange={(event) => setDraft((current) => ({ ...current, auth0Domain: event.target.value }))} /></label>
                  <label className="new-field" htmlFor="admin-engine-auth0-client-id"><span>Client ID</span><input id="admin-engine-auth0-client-id" value={draft.auth0ClientId} onChange={(event) => setDraft((current) => ({ ...current, auth0ClientId: event.target.value }))} /></label>
                  <label className="new-field" htmlFor="admin-engine-auth0-client-secret"><span>Client secret</span><input id="admin-engine-auth0-client-secret" type="password" value={draft.auth0ClientSecret} onChange={(event) => setDraft((current) => ({ ...current, auth0ClientSecret: event.target.value, auth0ClientSecretConfigured: current.auth0ClientSecretConfigured || event.target.value.trim().length > 0 }))} placeholder={draft.auth0ClientSecretConfigured ? 'Configured. Enter a new value to replace it.' : 'Not configured'} /></label>
                  <label className="new-field" htmlFor="admin-engine-auth0-audience"><span>Audience</span><input id="admin-engine-auth0-audience" value={draft.auth0Audience} onChange={(event) => setDraft((current) => ({ ...current, auth0Audience: event.target.value }))} /></label>
                  <label className="new-field" htmlFor="admin-engine-auth0-scope"><span>Scope</span><input id="admin-engine-auth0-scope" value={draft.auth0Scope} onChange={(event) => setDraft((current) => ({ ...current, auth0Scope: event.target.value }))} /></label>
                  <label className="new-field" htmlFor="admin-engine-auth0-refresh-skew"><span>Refresh skew seconds</span><input id="admin-engine-auth0-refresh-skew" value={draft.auth0RefreshSkewSeconds} onChange={(event) => setDraft((current) => ({ ...current, auth0RefreshSkewSeconds: event.target.value }))} /></label>
                </div>
              </>
            ) : null}

            {isMtlSMode ? (
              <>
                <NewSectionDivider />
                <div className="new-section-header">
                  <div>
                    <h3 className="new-section-heading-with-help">
                      <span>mTLS</span>
                      <InfoTooltip label="mTLS details" className="new-label-with-help-tooltip">
                        <span className="info-tooltip-title">mTLS runtime settings</span>
                        <span>These values are used by the deployed DXCP API runtime when it opens a machine-to-machine TLS connection to Spinnaker Gate. File paths refer to files on the runtime host.</span>
                      </InfoTooltip>
                    </h3>
                  </div>
                </div>
                <div className="new-intent-entry-grid">
                  <label className="new-field" htmlFor="admin-engine-mtls-cert"><NewLabelWithHelp label="Client cert path" tooltipLabel="Client cert path details" title="Client certificate path" body="Path on the deployed DXCP API runtime filesystem to the client certificate DXCP presents to the Gate mTLS endpoint." /><input id="admin-engine-mtls-cert" value={draft.mtlsCertPath} onChange={(event) => setDraft((current) => ({ ...current, mtlsCertPath: event.target.value }))} /></label>
                  <label className="new-field" htmlFor="admin-engine-mtls-key"><NewLabelWithHelp label="Client key path" tooltipLabel="Client key path details" title="Client private key path" body="Path on the deployed DXCP API runtime filesystem to the private key paired with the client certificate used for Gate mTLS." /><input id="admin-engine-mtls-key" value={draft.mtlsKeyPath} onChange={(event) => setDraft((current) => ({ ...current, mtlsKeyPath: event.target.value }))} /></label>
                  <label className="new-field" htmlFor="admin-engine-mtls-ca"><NewLabelWithHelp label="CA path" tooltipLabel="CA path details" title="Certificate authority path" body="Optional path on the deployed DXCP API runtime filesystem to the CA bundle or root certificate DXCP should trust when verifying the Gate server certificate." /><input id="admin-engine-mtls-ca" value={draft.mtlsCaPath} onChange={(event) => setDraft((current) => ({ ...current, mtlsCaPath: event.target.value }))} /></label>
                  <label className="new-field" htmlFor="admin-engine-mtls-server-name"><NewLabelWithHelp label="Server name" tooltipLabel="Server name details" title="TLS server name" body="Optional TLS server name used for SNI and certificate hostname validation when the Gate endpoint expects a specific internal name instead of the external URL host." /><input id="admin-engine-mtls-server-name" value={draft.mtlsServerName} onChange={(event) => setDraft((current) => ({ ...current, mtlsServerName: event.target.value }))} /></label>
                </div>
              </>
            ) : null}

            <NewSectionDivider />
            <div className="new-section-header"><div><h3>Advanced runtime invoke</h3></div></div>
            <div className="new-intent-entry-grid">
              <label className="new-field" htmlFor="admin-engine-lambda-url"><span>Engine lambda URL</span><input id="admin-engine-lambda-url" value={draft.engineLambdaUrl} onChange={(event) => setDraft((current) => ({ ...current, engineLambdaUrl: event.target.value }))} /></label>
              <label className="new-field" htmlFor="admin-engine-lambda-token"><span>Engine lambda token</span><input id="admin-engine-lambda-token" type="password" value={draft.engineLambdaToken} onChange={(event) => setDraft((current) => ({ ...current, engineLambdaToken: event.target.value, engineLambdaTokenConfigured: current.engineLambdaTokenConfigured || event.target.value.trim().length > 0 }))} placeholder={draft.engineLambdaTokenConfigured ? 'Configured. Enter a new value to replace it.' : 'Not configured'} /></label>
            </div>
          </div>
        ) : (
          <div className="new-admin-stack">
            <div className="new-admin-editor-note">
              <strong>Review before save</strong>
              <p>Engine adapter changes affect the control-plane connection path DXCP uses for governed deployments. Review mode, reachability, token posture, and runtime invoke settings before saving.</p>
            </div>
            <dl className="new-object-summary-grid">
              <dt>Engine type</dt><dd>{displayEngineType(draft.engineType)}</dd>
              <dt>Connection mode</dt><dd>{displayConnectionMode(draft.mode)}</dd>
              <dt>Gate URL</dt><dd>{draft.gateUrl || 'Not configured'}</dd>
              <dt>Request header</dt><dd>{draft.gateHeaderName ? `${draft.gateHeaderName}${draft.gateHeaderValueConfigured || draft.gateHeaderValue ? ' (configured)' : ' (value missing)'}` : 'Not configured'}</dd>
              <dt>Auth0</dt><dd>{draft.auth0Domain || draft.auth0ClientId || draft.auth0Audience ? 'Configured' : 'Not configured'}</dd>
              <dt>mTLS</dt><dd>{draft.mode === 'mtls' ? (draft.mtlsCertPath && draft.mtlsKeyPath ? 'Configured' : 'Incomplete') : 'Not used'}</dd>
              <dt>Engine lambda</dt><dd>{draft.engineLambdaUrl ? 'Configured' : 'Not configured'}</dd>
            </dl>
          </div>
        )}
      </SectionCard>
    </div>
  )
}

function createEmptyRecipeDraft() {
  return {
    id: '',
    name: '',
    description: '',
    effectiveBehaviorSummary: '',
    status: 'active',
    engineType: 'SPINNAKER',
    spinnakerApplication: '',
    deployPipeline: '',
    rollbackPipeline: '',
    changeReason: ''
  }
}

function recipeStatusLabel(status) {
  return displayLifecycleStatus(status)
}

function recipeUsageSummary(recipe) {
  const usage = recipe?.usage || {}
  const parts = []
  if (usage.routedReferenceCount) parts.push(`${usage.routedReferenceCount} routed`)
  if (usage.deliveryGroupReferenceCount) parts.push(`${usage.deliveryGroupReferenceCount} allowed`)
  return parts.length > 0 ? parts.join(' / ') : 'Unreferenced'
}

function NewLabelWithHelp({ label, tooltipLabel, title, body }) {
  return (
    <span className="new-label-with-help">
      <span>{label}</span>
      <InfoTooltip label={tooltipLabel} className="new-label-with-help-tooltip">
        <span className="info-tooltip-title">{title}</span>
        <span>{body}</span>
      </InfoTooltip>
    </span>
  )
}

function recipeDraftValidationMessage(draft) {
  if (!draft.id.trim()) return 'Recipe ID is required before DXCP can save this recipe.'
  if (!draft.name.trim()) return 'Recipe name is required before DXCP can save this recipe.'
  if (!draft.effectiveBehaviorSummary.trim()) return 'Effective behavior summary is required before DXCP can save this recipe.'
  if (!draft.deployPipeline.trim()) return 'Deploy pipeline is required before DXCP can save this recipe.'
  if (!draft.spinnakerApplication.trim()) return 'Spinnaker application is required when engine binding is configured.'
  return ''
}

function RecipeSummaryStrip({ recipes }) {
  const activeCount = recipes.filter((recipe) => recipe.status !== 'deprecated').length
  const deprecatedCount = recipes.filter((recipe) => recipe.status === 'deprecated').length
  const referencedCount = recipes.filter((recipe) => (recipe.usage?.totalReferences || 0) > 0).length

  return (
    <div className="new-admin-inline-summary" aria-label="Recipe summary">
      <div className="new-admin-inline-summary-item">
        <span>Configured</span>
        <strong>{recipes.length}</strong>
      </div>
      <div className="new-admin-inline-summary-item">
        <span>Active</span>
        <strong>{activeCount}</strong>
      </div>
      <div className="new-admin-inline-summary-item">
        <span>Deprecated</span>
        <strong>{deprecatedCount}</strong>
      </div>
      <div className="new-admin-inline-summary-item">
        <span>Referenced</span>
        <strong>{referencedCount}</strong>
      </div>
    </div>
  )
}

const RECIPE_COLUMNS = [
  { key: 'recipe', label: 'Recipe', width: 'minmax(260px, 2fr)' },
  { key: 'id', label: 'ID', width: 'minmax(160px, 1fr)' },
  { key: 'summary', label: 'Behavior', width: 'minmax(280px, 2.4fr)' },
  { key: 'usage', label: 'Usage', width: 'minmax(140px, 0.9fr)' },
  { key: 'status', label: 'Status', width: 'minmax(120px, 0.8fr)', cellClassName: 'operational-list-cell-status' }
]

const RECIPE_USAGE_ROUTE_COLUMNS = [
  { key: 'service', label: 'Service', width: 'minmax(220px, 1.2fr)' },
  { key: 'environment', label: 'Environment', width: 'minmax(220px, 1fr)' }
]

const RECIPE_USAGE_GROUP_COLUMNS = [
  { key: 'group', label: 'Delivery group', width: 'minmax(240px, 1.2fr)' },
  { key: 'id', label: 'ID', width: 'minmax(180px, 1fr)' }
]

function RecipesWorkspace({ api }) {
  const [workspaceState, setWorkspaceState] = useState({ kind: 'loading', viewModel: null, errorMessage: '' })
  const [draft, setDraft] = useState(createEmptyRecipeDraft)
  const [editingId, setEditingId] = useState('')
  const [viewMode, setViewMode] = useState('list')
  const [detailTab, setDetailTab] = useState('details')
  const [message, setMessage] = useState({ tone: '', title: '', body: '' })
  const [searchTerm, setSearchTerm] = useState('')

  const loadWorkspace = useCallback(async (options = {}) => {
    setWorkspaceState((current) => ({
      kind: current.kind === 'ready' || current.kind === 'degraded' ? 'refreshing' : 'loading',
      viewModel: current.viewModel,
      errorMessage: ''
    }))
    const result = await loadAdminRecipeWorkspace(api, options)
    setWorkspaceState(result)
  }, [api])

  useEffect(() => {
    loadWorkspace()
  }, [loadWorkspace])

  const recipes = useMemo(() => workspaceState.viewModel?.recipes || [], [workspaceState.viewModel?.recipes])
  const degradedReasons = useMemo(
    () => workspaceState.viewModel?.degradedReasons || [],
    [workspaceState.viewModel?.degradedReasons]
  )
  const selectedRecipe = useMemo(() => recipes.find((recipe) => recipe.id === editingId) || null, [editingId, recipes])
  const visibleRecipes = useMemo(() => {
    const normalizedSearchTerm = searchTerm.trim().toLowerCase()
    if (!normalizedSearchTerm) return recipes
    return recipes.filter((recipe) =>
      [
        recipe.name,
        recipe.id,
        recipe.summary,
        recipe.status,
        recipe.spinnakerApplication,
        recipe.deployPipeline,
        recipe.rollbackPipeline
      ]
        .join(' ')
        .toLowerCase()
        .includes(normalizedSearchTerm)
    )
  }, [recipes, searchTerm])

  const isCreating = viewMode === 'create'
  const currentUsage = selectedRecipe?.usage || { routes: [], deliveryGroups: [], totalReferences: 0 }
  const hasNoSearchResults = recipes.length > 0 && visibleRecipes.length === 0
  const deprecatingRoutedRecipe =
    selectedRecipe &&
    selectedRecipe.status !== 'deprecated' &&
    draft.status === 'deprecated' &&
    (currentUsage.routedReferenceCount || 0) > 0

  useEffect(() => {
    if (viewMode !== 'detail') return
    if (selectedRecipe) return
    setViewMode('list')
    setEditingId('')
    setDraft(createEmptyRecipeDraft())
  }, [selectedRecipe, viewMode])

  const openListView = () => {
    setViewMode('list')
    setEditingId('')
    setDraft(createEmptyRecipeDraft())
    setDetailTab('details')
  }

  const beginCreate = () => {
    setViewMode('create')
    setEditingId('')
    setDraft(createEmptyRecipeDraft())
    setDetailTab('details')
    setMessage({ tone: '', title: '', body: '' })
  }

  const openDetail = (recipe) => {
    setViewMode('detail')
    setEditingId(recipe.id)
    setDetailTab('details')
    setDraft({
      id: recipe.id,
      name: recipe.name || '',
      description: recipe.description || '',
      effectiveBehaviorSummary: recipe.summary || '',
      status: recipe.status || 'active',
      engineType: recipe.engineType || 'SPINNAKER',
      spinnakerApplication: recipe.spinnakerApplication || '',
      deployPipeline: recipe.deployPipeline || '',
      rollbackPipeline: recipe.rollbackPipeline || '',
      changeReason: ''
    })
    setMessage({ tone: '', title: '', body: '' })
  }

  const hasDetailChanges = useMemo(() => {
    if (isCreating) {
      return (
        draft.id.trim().length > 0 ||
        draft.name.trim().length > 0 ||
        draft.description.trim().length > 0 ||
        draft.effectiveBehaviorSummary.trim().length > 0 ||
        draft.status !== 'active' ||
        draft.spinnakerApplication.trim().length > 0 ||
        draft.deployPipeline.trim().length > 0 ||
        draft.rollbackPipeline.trim().length > 0 ||
        draft.changeReason.trim().length > 0
      )
    }
    if (!selectedRecipe) return false
    return (
      draft.name.trim() !== (selectedRecipe.name || '').trim() ||
      draft.description.trim() !== (selectedRecipe.description || '').trim() ||
      draft.effectiveBehaviorSummary.trim() !== (selectedRecipe.summary || '').trim() ||
      draft.status !== (selectedRecipe.status || 'active') ||
      draft.spinnakerApplication.trim() !== (selectedRecipe.spinnakerApplication || '').trim() ||
      draft.deployPipeline.trim() !== (selectedRecipe.deployPipeline || '').trim() ||
      draft.rollbackPipeline.trim() !== (selectedRecipe.rollbackPipeline || '').trim() ||
      draft.changeReason.trim().length > 0
    )
  }, [draft, isCreating, selectedRecipe])

  const saveRecipe = async () => {
    const validationMessage = recipeDraftValidationMessage(draft)
    if (validationMessage) {
      setMessage({ tone: 'danger', title: 'Recipe details are incomplete.', body: validationMessage })
      return
    }

    const payload = {
      id: draft.id.trim(),
      name: draft.name.trim(),
      description: draft.description.trim() || null,
      effective_behavior_summary: draft.effectiveBehaviorSummary.trim(),
      status: draft.status === 'deprecated' ? 'deprecated' : 'active',
      spinnaker_application: draft.spinnakerApplication.trim(),
      deploy_pipeline: draft.deployPipeline.trim(),
      rollback_pipeline: draft.rollbackPipeline.trim() || null
    }
    if (draft.changeReason.trim()) payload.change_reason = draft.changeReason.trim()

    const result = isCreating
      ? await createAdminRecipe(api, payload)
      : await updateAdminRecipe(api, editingId, payload)

    if (!result.ok) {
      setMessage({
        tone: 'danger',
        title: isCreating ? 'Recipe could not be created.' : 'Recipe could not be saved.',
        body: result.errorMessage
      })
      return
    }

    await loadWorkspace({ bypassCache: true })
    setDraft((current) => ({ ...current, changeReason: '' }))
    if (isCreating) {
      setEditingId(payload.id)
      setViewMode('detail')
      setMessage({
        tone: 'neutral',
        title: 'Recipe created.',
        body: 'DXCP saved the recipe as an admin-owned execution pattern. Normal deploy still reaches it only through routing and delivery-group authorization.'
      })
      return
    }
    setMessage({
      tone: deprecatingRoutedRecipe ? 'warning' : 'neutral',
      title: deprecatingRoutedRecipe ? 'Recipe updated with active routing references.' : 'Recipe updated.',
      body: deprecatingRoutedRecipe
        ? 'DXCP saved the deprecation. Future deploys through those routes will now be blocked until routing is updated.'
        : 'DXCP saved the recipe changes.'
    })
  }

  const handleDeleteRecipe = async (recipe) => {
    if (!recipe?.id) return
    const result = await deleteAdminRecipe(api, recipe.id)
    if (!result.ok) {
      const references = Array.isArray(result.details?.references) ? result.details.references : []
      const blockedByRouting = result.details?.reference_type === 'service_environment_routing'
      const detailText = blockedByRouting
        ? references.map((reference) => `${reference.service_id} / ${reference.environment_id}`).filter(Boolean).join(', ')
        : references.map((reference) => reference.delivery_group_id).filter(Boolean).join(', ')
      setMessage({
        tone: result.code === 'RECIPE_IN_USE' ? 'warning' : 'danger',
        title: result.code === 'RECIPE_IN_USE' ? 'Delete blocked.' : 'Recipe could not be deleted.',
        body:
          result.code === 'RECIPE_IN_USE'
            ? blockedByRouting
              ? `DXCP blocked delete because this recipe is still selected by service-environment routing. Remove or replace those routes first${detailText ? `: ${detailText}.` : '.'}`
              : `DXCP blocked delete because this recipe is still authorized by delivery-group allowed_recipes. Remove that authorization first${detailText ? `: ${detailText}.` : '.'}`
            : result.errorMessage
      })
      openDetail(recipe)
      return
    }
    if (editingId === recipe.id) openListView()
    setMessage({
      tone: 'neutral',
      title: 'Recipe deleted.',
      body: 'DXCP removed the recipe because no current routing or delivery-group authorization still depended on it.'
    })
    await loadWorkspace({ bypassCache: true })
  }

  if (workspaceState.kind === 'loading') {
    return (
      <SectionCard className="new-admin-card">
        <div className="new-card-loading" aria-label="Loading recipes" aria-live="polite" aria-busy="true">
          <LoadingText>Loading...</LoadingText>
          <div className="new-card-loading-lines" aria-hidden="true">
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
          title="Recipe administration could not be loaded"
          tone="danger"
          actions={[{ label: 'Retry', onClick: () => loadWorkspace({ bypassCache: true }) }]}
        >
          {workspaceState.errorMessage || 'DXCP could not load recipe administration data right now.'}
        </NewStateBlock>
      </SectionCard>
    )
  }

  if (viewMode === 'list') {
    return (
      <div className="new-admin-stack">
        <SectionCard className="new-admin-card">
          <div className="new-admin-panel-header">
            <div><h3>Recipes</h3></div>
            <div className="new-admin-toolbar-actions">
              <NewRefreshButton onClick={() => loadWorkspace({ bypassCache: true })} busy={workspaceState.kind === 'refreshing'} />
              <button className="button" type="button" onClick={beginCreate}>Create recipe</button>
            </div>
          </div>
          <RecipeSummaryStrip recipes={recipes} />
          {degradedReasons.length > 0 ? (
            <NewExplanation title="Supporting admin reads are degraded" tone="warning">{degradedReasons.join(' ')}</NewExplanation>
          ) : null}
          {message.title ? (
            <NewExplanation title={message.title} tone={message.tone || 'neutral'}>{message.body}</NewExplanation>
          ) : null}
          <div className="new-admin-surface-card">
            <div className="new-section-header new-collection-header"><div><h3>Recipe list</h3></div></div>
            <div className="new-applications-chooser-toolbar">
              <label className="new-applications-search" htmlFor="admin-recipe-search">
                <span>Search</span>
                <input
                  id="admin-recipe-search"
                  type="search"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Search recipes"
                  aria-label="Search recipes"
                />
              </label>
            </div>
            {recipes.length === 0 ? (
              <NewStateBlock eyebrow="Empty" title="No recipes configured" actions={[{ label: 'Create recipe', onClick: beginCreate }]}>
                Create an admin-owned execution pattern to define delivery behavior and engine binding for governed routing.
              </NewStateBlock>
            ) : hasNoSearchResults ? (
              <NewStateBlock eyebrow="No results" title="No recipes match this search" tone="warning" actions={[{ label: 'Clear search', onClick: () => setSearchTerm('') }]}>
                Try a different recipe name, identifier, behavior summary, or engine binding value.
              </NewStateBlock>
            ) : (
              <OperationalDataList
                ariaLabel="Recipe collection"
                columns={RECIPE_COLUMNS}
                rows={visibleRecipes}
                footerSummary={`${visibleRecipes.length} recipe${visibleRecipes.length === 1 ? '' : 's'}`}
                getRowKey={(recipe) => recipe.id}
                getRowAction={(recipe) => ({ label: `Open ${recipe.name || recipe.id}`, onClick: () => openDetail(recipe) })}
                renderCell={(recipe, column) => {
                  if (column.key === 'recipe') return <div className="new-application-name-cell"><span className="new-application-name">{recipe.name || recipe.id}</span><span className="new-operational-text">Admin-owned execution pattern</span></div>
                  if (column.key === 'id') return <span className="new-operational-text">{recipe.id}</span>
                  if (column.key === 'summary') return <span className="new-operational-text">{recipe.summary || 'No behavior summary provided.'}</span>
                  if (column.key === 'usage') return <span className="new-operational-text">{recipeUsageSummary(recipe)}</span>
                  if (column.key === 'status') return <span className={recipe.status === 'deprecated' ? 'new-admin-status-pill' : 'new-admin-status-pill is-enabled'}>{recipeStatusLabel(recipe.status)}</span>
                  return null
                }}
                renderSecondaryRow={() => (
                  <p className="operational-list-note">
                    Normal deploy reaches this recipe through service-environment routing. Delivery-group allowed_recipes still authorizes it separately.
                  </p>
                )}
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
        title={isCreating ? 'Create recipe' : 'Recipe'}
        objectIdentity={!isCreating ? (draft.name || draft.id) : undefined}
        backToCollection={{ label: 'Back to Recipes', onClick: openListView }}
        primaryAction={{
          label: isCreating ? 'Create recipe' : 'Save changes',
          onClick: saveRecipe,
          disabled: isCreating ? !draft.id.trim() || !draft.name.trim() : !hasDetailChanges
        }}
        secondaryActions={!isCreating ? [{ label: 'Delete', onClick: () => handleDeleteRecipe(selectedRecipe) }] : []}
        role="PLATFORM_ADMIN"
        showRoleNote={false}
        showActionNote={false}
      />
      {message.title ? <NewExplanation title={message.title} tone={message.tone || 'neutral'}>{message.body}</NewExplanation> : null}
      <SectionCard className="new-admin-surface-card">
        <div className="new-section-header"><div><h3>Summary</h3></div></div>
        <dl className="new-object-summary-grid">
          <dt>Recipe ID</dt><dd>{isCreating ? 'Assigned on create' : draft.id}</dd>
          <dt>Status</dt><dd>{recipeStatusLabel(draft.status)}</dd>
          <dt>Revision</dt><dd>{selectedRecipe?.recipeRevision || (isCreating ? 'New' : '1')}</dd>
          <dt>Usage</dt><dd>{selectedRecipe ? recipeUsageSummary(selectedRecipe) : 'Unreferenced until routed or authorized'}</dd>
        </dl>
      </SectionCard>
      <NewSegmentedTabs
        ariaLabel="Recipe detail tabs"
        activeTab={detailTab}
        onChange={setDetailTab}
        tabs={[
          { id: 'details', label: 'Details' },
          { id: 'engine', label: 'Engine binding' },
          { id: 'usage', label: 'Usage', disabled: isCreating },
          { id: 'review', label: 'Review' }
        ]}
      />
      <SectionCard className="new-admin-surface-card">
        {detailTab === 'details' ? (
          <>
            <div className="new-section-header"><div><h3>{isCreating ? 'Definition and identity' : 'Recipe details'}</h3></div></div>
            <div className="new-admin-editor-note">
              <strong>{isCreating ? 'Choose a durable recipe ID' : 'Recipe ID is locked'}</strong>
              <p>{isCreating ? 'Use a stable identifier for the governed execution pattern. DXCP records this value on deployments and uses it in routing and policy.' : 'DXCP preserves the recipe ID so routing, diagnostics, records, and delivery-group authorization keep a stable execution-pattern reference.'}</p>
            </div>
            <div className="new-intent-entry-grid">
              <label className="new-field" htmlFor="admin-recipe-id"><span>Recipe ID</span><input id="admin-recipe-id" value={draft.id} disabled={!isCreating} onChange={(event) => setDraft((current) => ({ ...current, id: event.target.value }))} placeholder="progressive, canary, bluegreen" /></label>
              <label className="new-field" htmlFor="admin-recipe-name"><span>Name</span><input id="admin-recipe-name" value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} /></label>
              <label className="new-field" htmlFor="admin-recipe-status"><span>Status</span><select id="admin-recipe-status" value={draft.status} onChange={(event) => setDraft((current) => ({ ...current, status: event.target.value }))}><option value="active">Active</option><option value="deprecated">Deprecated</option></select></label>
              <label className="new-field" htmlFor="admin-recipe-description"><span>Description</span><input id="admin-recipe-description" value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} /></label>
              <label className="new-field" htmlFor="admin-recipe-summary" style={{ gridColumn: '1 / -1' }}><span>Effective behavior summary</span><textarea id="admin-recipe-summary" rows={3} value={draft.effectiveBehaviorSummary} onChange={(event) => setDraft((current) => ({ ...current, effectiveBehaviorSummary: event.target.value }))} /></label>
            </div>
          </>
        ) : detailTab === 'engine' ? (
          <>
            <div className="new-section-header"><div><h3>Engine binding</h3></div></div>
            <div className="new-admin-editor-note"><strong>Engine details remain admin-only</strong><p>Recipes define delivery behavior and engine binding. Normal deploy does not expose this mapping as an operator choice.</p></div>
            <div className="new-intent-entry-grid">
              <label className="new-field" htmlFor="admin-recipe-engine-type"><span>Engine type</span><input id="admin-recipe-engine-type" value={displayEngineType(draft.engineType)} disabled /></label>
              <label className="new-field" htmlFor="admin-recipe-app"><span>Spinnaker application</span><input id="admin-recipe-app" value={draft.spinnakerApplication} onChange={(event) => setDraft((current) => ({ ...current, spinnakerApplication: event.target.value }))} /></label>
              <label className="new-field" htmlFor="admin-recipe-deploy-pipeline"><span>Deploy pipeline</span><input id="admin-recipe-deploy-pipeline" value={draft.deployPipeline} onChange={(event) => setDraft((current) => ({ ...current, deployPipeline: event.target.value }))} /></label>
              <label className="new-field" htmlFor="admin-recipe-rollback-pipeline"><span>Rollback pipeline</span><input id="admin-recipe-rollback-pipeline" value={draft.rollbackPipeline} onChange={(event) => setDraft((current) => ({ ...current, rollbackPipeline: event.target.value }))} /></label>
            </div>
          </>
        ) : detailTab === 'usage' ? (
          <div className="new-admin-stack">
            <SectionCard className="new-admin-surface-card">
              <div className="new-section-header"><div><h3>Service-environment routes</h3></div></div>
              {currentUsage.routes.length === 0 ? <p className="new-operational-text">No service-environment routes currently select this recipe.</p> : <OperationalDataList ariaLabel="Recipe routing usage" columns={RECIPE_USAGE_ROUTE_COLUMNS} rows={currentUsage.routes} footerSummary={`${currentUsage.routes.length} routed reference${currentUsage.routes.length === 1 ? '' : 's'}`} getRowKey={(row) => `${row.serviceId}-${row.environmentId}`} renderCell={(row, column) => column.key === 'service' ? <span className="new-operational-text">{row.serviceId}</span> : <span className="new-operational-text">{row.environmentName || row.environmentId}</span>} />}
            </SectionCard>
            <SectionCard className="new-admin-surface-card">
              <div className="new-section-header"><div><h3>Delivery-group authorization</h3></div></div>
              {currentUsage.deliveryGroups.length === 0 ? <p className="new-operational-text">No delivery groups currently authorize this recipe in allowed_recipes.</p> : <OperationalDataList ariaLabel="Recipe delivery-group usage" columns={RECIPE_USAGE_GROUP_COLUMNS} rows={currentUsage.deliveryGroups} footerSummary={`${currentUsage.deliveryGroups.length} delivery group${currentUsage.deliveryGroups.length === 1 ? '' : 's'}`} getRowKey={(row) => row.deliveryGroupId} renderCell={(row, column) => column.key === 'group' ? <span className="new-operational-text">{row.deliveryGroupName || row.deliveryGroupId}</span> : <span className="new-operational-text">{row.deliveryGroupId}</span>} />}
            </SectionCard>
          </div>
        ) : (
          <div className="new-admin-stack">
            <div className="new-admin-editor-note"><strong>Review before save</strong><p>Recipe changes affect governed delivery behavior, routing outcomes, and delivery-group authorization posture. Review identity, behavior, and engine binding before saving.</p></div>
            {deprecatingRoutedRecipe ? <NewExplanation title="Active routing still points at this recipe" tone="warning">Saving this deprecation will cause future deploys through those routes to fail until routing is updated.</NewExplanation> : null}
            <dl className="new-object-summary-grid">
              <dt>Name</dt><dd>{draft.name || 'Not set'}</dd>
              <dt>Behavior summary</dt><dd>{draft.effectiveBehaviorSummary || 'Not set'}</dd>
              <dt>Engine binding</dt><dd>{draft.spinnakerApplication && draft.deployPipeline ? `${draft.spinnakerApplication} / ${draft.deployPipeline}` : 'Incomplete'}</dd>
              <dt>Rollback pipeline</dt><dd>{draft.rollbackPipeline || 'Not configured'}</dd>
            </dl>
            <label className="new-field" htmlFor="admin-recipe-change-reason"><span>Change reason</span><textarea id="admin-recipe-change-reason" rows={3} value={draft.changeReason} onChange={(event) => setDraft((current) => ({ ...current, changeReason: event.target.value }))} placeholder="Optional review note for why this recipe changed" /></label>
          </div>
        )}
      </SectionCard>
    </div>
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
    panel = <DeliveryGroupsPanel api={api} />
  } else if (activeTab === 'recipes') {
    panel = <RecipesPanel api={api} />
  } else if (activeTab === 'engine-adapters') {
    panel = <EngineAdaptersPanel api={api} />
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
