import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import SectionCard from '../components/SectionCard.jsx'
import NewExperiencePageHeader from './NewExperiencePageHeader.jsx'
import NewExperienceAdminWorkspaceShell, { NewExperienceAdminSectionStrip } from './NewExperienceAdminWorkspaceShell.jsx'
import { NewExplanation, NewStateBlock } from './NewExperienceStatePrimitives.jsx'
import { useNewExperienceAlertRail, useNewExperienceStickyRail } from './NewExperienceShell.jsx'
import { loadAccessibleEnvironmentOptions } from './newExperienceApplicationsData.js'

const ADMIN_TABS = [
  {
    id: 'delivery-groups',
    label: 'Delivery Groups',
    description: 'Define governance boundaries, ownership, and rollout guardrails for groups of services.'
  },
  {
    id: 'recipes',
    label: 'Recipes',
    description: 'Manage reusable deployment behaviors and the rollout patterns available to delivery groups.'
  },
  {
    id: 'environments',
    label: 'Environments',
    description: 'Establish the platform environments that delivery policy and routing will build on.'
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

function EnvironmentSummary({ rows }) {
  const enabledCount = rows.filter((row) => row.isEnabled).length
  const productionCount = rows.filter((row) => row.type === 'prod').length
  const nonProductionCount = rows.length - productionCount

  return (
    <div className="new-admin-summary-grid">
      <div className="new-admin-summary-item">
        <span>Configured environments</span>
        <strong>{rows.length}</strong>
        <p>Foundation objects available for policy and routing.</p>
      </div>
      <div className="new-admin-summary-item">
        <span>Enabled now</span>
        <strong>{enabledCount}</strong>
        <p>Environments currently open for governance configuration.</p>
      </div>
      <div className="new-admin-summary-item">
        <span>Topology mix</span>
        <strong>{productionCount}/{nonProductionCount}</strong>
        <p>{productionCount} production and {nonProductionCount} non-production environments.</p>
      </div>
    </div>
  )
}

function EnvironmentsPanel({ api }) {
  const [state, setState] = useState({ kind: 'loading', rows: [], errorMessage: '' })

  const loadEnvironments = useCallback(async () => {
    setState((current) => ({ kind: current.kind === 'ready' ? 'refreshing' : 'loading', rows: current.rows, errorMessage: '' }))
    const result = await loadAccessibleEnvironmentOptions(api)
    if (result.kind === 'failure') {
      setState({ kind: 'failure', rows: [], errorMessage: result.errorMessage || 'DXCP could not load environment foundation data.' })
      return
    }
    const rows = (result.environmentOptions || []).map((environment) => ({
      id: String(environment?.name || '').trim(),
      displayName: String(environment?.display_name || environment?.label || environment?.name || '').trim(),
      type: environment?.type === 'prod' ? 'prod' : 'non_prod',
      isEnabled: true
    })).filter((row) => row.id)
    setState({ kind: rows.length > 0 ? 'ready' : 'empty', rows, errorMessage: '' })
  }, [api])

  useEffect(() => {
    loadEnvironments()
  }, [loadEnvironments])

  if (state.kind === 'loading') {
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

  if (state.kind === 'failure') {
    return (
      <SectionCard className="new-admin-card">
        <div className="new-admin-panel-header">
          <div>
            <span className="new-admin-panel-eyebrow">Foundation setup</span>
            <h3>Environments</h3>
            <p>Establish the platform environments that delivery policy and routing will build on.</p>
          </div>
        </div>
        <NewStateBlock
          eyebrow="Data unavailable"
          title="Environment foundation could not be loaded"
          tone="warning"
          actions={[{ label: 'Retry', onClick: loadEnvironments }]}
        >
          {state.errorMessage}
        </NewStateBlock>
      </SectionCard>
    )
  }

  if (state.kind === 'empty') {
    return (
      <SectionCard className="new-admin-card">
        <div className="new-admin-panel-header">
          <div>
            <span className="new-admin-panel-eyebrow">Foundation setup</span>
            <h3>Environments</h3>
            <p>Establish the platform environments that delivery policy and routing will build on.</p>
          </div>
        </div>
        <NewExplanation title="No environments configured" tone="warning">
          The workspace is ready, but no environments have been defined yet. This tab will become the operating surface for environment setup in the next phase.
        </NewExplanation>
        <div className="new-admin-empty-card">
          <strong>Environment foundation is empty</strong>
          <p>Define your first environment to unlock delivery group policy, service routing, and governed rollout paths.</p>
        </div>
      </SectionCard>
    )
  }

  return (
    <SectionCard className="new-admin-card">
      <div className="new-admin-panel-header">
        <div>
          <span className="new-admin-panel-eyebrow">Foundation setup</span>
          <h3>Environments</h3>
          <p>Establish the platform environments that delivery policy and routing will build on.</p>
        </div>
        <button className="button secondary" type="button" onClick={loadEnvironments}>
          {state.kind === 'refreshing' ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      <EnvironmentSummary rows={state.rows} />

      <div className="new-admin-environment-list" role="list" aria-label="Configured environments">
        {state.rows.map((row) => (
          <article key={row.id} className="new-admin-environment-item" role="listitem">
            <div className="new-admin-environment-main">
              <div className="new-admin-environment-name-row">
                <strong>{row.displayName}</strong>
                <span className={`new-admin-status-pill${row.isEnabled ? ' is-enabled' : ' is-disabled'}`}>
                  {row.isEnabled ? 'Enabled' : 'Disabled'}
                </span>
              </div>
              <p>{row.type === 'prod' ? 'Production environment foundation' : 'Non-production environment foundation'}</p>
            </div>
            <dl className="new-admin-environment-meta">
              <div>
                <dt>ID</dt>
                <dd>{row.id}</dd>
              </div>
              <div>
                <dt>Type</dt>
                <dd>{row.type === 'prod' ? 'Production' : 'Non-production'}</dd>
              </div>
            </dl>
          </article>
        ))}
      </div>

      <div className="new-admin-empty-card">
        <strong>Phase 1 foundation view</strong>
        <p>This tab is now the canonical home for environment administration. Create, edit, and binding workflows can land here in the next phase without reopening the page architecture.</p>
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
  const activeTabDefinition = ADMIN_TABS.find((tab) => tab.id === activeTab) || ADMIN_TABS[2]

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
        emptyTitle="Delivery group governance is being refit for the new workspace"
        emptyBody="This panel will host the delivery group editor and review flow without forcing Admin to scroll through unrelated governance tasks."
      />
    )
  } else if (activeTab === 'recipes') {
    panel = (
      <PlaceholderPanel
        eyebrow="Deployment patterns"
        title="Recipes"
        description="Manage reusable deployment behaviors and the rollout patterns available to delivery groups."
        emptyTitle="Recipe administration is being staged into this workspace"
        emptyBody="This panel is reserved for deployment strategy review, lifecycle management, and reference visibility in a dedicated task surface."
      />
    )
  } else if (activeTab === 'environments') {
    panel = <EnvironmentsPanel api={api} />
  } else if (activeTab === 'system-settings') {
    panel = (
      <PlaceholderPanel
        eyebrow="Platform controls"
        title="System Settings"
        description="Configure platform-wide guardrails, operational limits, and administrative posture."
        emptyTitle="Platform settings are being moved into this workspace"
        emptyBody="Global rate limits, mutation posture, and administrative controls will land here as a dedicated governance panel."
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
