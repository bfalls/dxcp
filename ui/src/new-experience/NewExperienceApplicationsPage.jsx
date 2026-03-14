import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom'
import SectionCard from '../components/SectionCard.jsx'
import NewExperiencePageHeader from './NewExperiencePageHeader.jsx'
import { NewExplanation, NewStateBlock } from './NewExperienceStatePrimitives.jsx'
import { useNewExperienceAlertRail } from './NewExperienceShell.jsx'
import { loadApplicationsChooserData } from './newExperienceApplicationsData.js'

const APPLICATION_DETAIL_FIXTURE = {
  owner: 'Payments Platform',
  environment: 'sandbox',
  currentVersion: 'v1.32.1',
  currentOutcome: 'Succeeded',
  deploymentGroup: 'Payments Core',
  runningSince: '12 minutes',
  lastChange: 'Deployment 9831 completed 12 minutes ago.',
  activeDeployment: {
    id: '9842',
    version: 'v1.33.0',
    summary: 'A newer candidate is progressing through sandbox now.',
    startedAt: 'Started 2 minutes ago'
  },
  recentState: [
    {
      label: 'Active deployment',
      state: 'Active',
      detail: 'v1.33.0 is moving through sandbox.',
      timestamp: 'Started 2 minutes ago',
      linkLabel: 'Open active deployment',
      to: '/new/deployments/9842'
    },
    {
      label: 'Latest completed deployment',
      state: 'Succeeded',
      detail: 'v1.32.1 became current in sandbox.',
      timestamp: '12 minutes ago',
      linkLabel: 'Open deployment 9831',
      to: '/new/deployments/9831'
    },
    {
      label: 'Recent state signal',
      state: 'Stable',
      detail: 'No rollback has been recorded in the last 7 days.',
      timestamp: 'As of this refresh'
    }
  ],
  support: {
    releasePath: 'Deploy through the current DXCP deploy workflow.',
    policyPosture: 'One active deployment at a time in sandbox.',
    diagnostics: 'Detailed execution diagnostics remain limited to platform admins.'
  }
}

function toneForState(state) {
  if (state === 'Succeeded' || state === 'Stable') return 'info'
  if (state === 'Active') return 'warn'
  return 'neutral'
}

function roleAccessLabel(role) {
  if (role === 'PLATFORM_ADMIN') return 'Platform-admin access'
  if (role === 'OBSERVER') return 'Read-only application access'
  if (role === 'DELIVERY_OWNER') return 'Delivery-owner access'
  return 'Role-based access'
}

function roleSearchPlaceholder(role) {
  if (role === 'OBSERVER') return 'Search accessible applications'
  return 'Search applications'
}

function buildChooserReturnTo(location, visibleCount, searchTerm) {
  const query = location.search || ''
  const suffix = searchTerm ? ` matching "${searchTerm}"` : ''
  return {
    kind: 'applications-chooser',
    to: `/new/applications${query}`,
    label: 'Back to Applications',
    scopeSummary: `${visibleCount} accessible application${visibleCount === 1 ? '' : 's'}${suffix}.`
  }
}

function ApplicationChooserCard({ application, returnTo, isReadOnly }) {
  const detailRoute = `/new/applications/${application.name}`
  const actionCopy = isReadOnly ? 'Open Application in read-only mode' : 'Open Application'

  return (
    <article className="new-application-chooser-card">
      <div className="new-application-chooser-main">
        <div className="new-application-chooser-heading">
          <div>
            <h3>{application.name}</h3>
            <p>{application.summary}</p>
          </div>
          <span className={`badge ${application.recentStateTone}`}>{application.recentState}</span>
        </div>

        <dl className="new-application-chooser-meta" aria-label={`${application.name} summary`}>
          <div>
            <dt>Owner</dt>
            <dd>{application.owner}</dd>
          </div>
          <div>
            <dt>Deployment group</dt>
            <dd>{application.deploymentGroup}</dd>
          </div>
          <div>
            <dt>Current environment</dt>
            <dd>{application.environment}</dd>
          </div>
        </dl>

        <p className="new-application-chooser-note">{application.recentStateDetail}</p>
      </div>

      <div className="new-application-chooser-action">
        <Link className="button" to={detailRoute} state={{ returnTo }}>
          {actionCopy}
        </Link>
      </div>
    </article>
  )
}

function ApplicationsChooser({ role, api }) {
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const searchTerm = searchParams.get('q') || ''
  const isReadOnly = role === 'OBSERVER'
  const [chooserState, setChooserState] = useState({
    kind: 'loading',
    applications: [],
    degradedReasons: [],
    errorMessage: ''
  })

  const refreshChooserData = useCallback(
    async (options = {}) => {
      setChooserState((current) => ({
        kind: current.kind === 'ready' || current.kind === 'degraded' ? 'refreshing' : 'loading',
        applications: current.applications || [],
        degradedReasons: [],
        errorMessage: ''
      }))
      const nextState = await loadApplicationsChooserData(api, options)
      setChooserState(nextState)
    },
    [api]
  )

  useEffect(() => {
    let active = true
    const load = async () => {
      setChooserState({ kind: 'loading', applications: [], degradedReasons: [], errorMessage: '' })
      const nextState = await loadApplicationsChooserData(api)
      if (active) {
        setChooserState(nextState)
      }
    }
    load()
    return () => {
      active = false
    }
  }, [api])

  const visibleApplications = useMemo(() => chooserState.applications || [], [chooserState.applications])
  const normalizedSearchTerm = searchTerm.trim().toLowerCase()
  const filteredApplications = useMemo(() => {
    if (!normalizedSearchTerm) return visibleApplications
    return visibleApplications.filter((application) => {
      const haystack = [
        application.name,
        application.summary,
        application.owner,
        application.deploymentGroup,
        application.environment
      ]
        .join(' ')
        .toLowerCase()
      return haystack.includes(normalizedSearchTerm)
    })
  }, [normalizedSearchTerm, visibleApplications])

  const isLoading = chooserState.kind === 'loading'
  const isRefreshing = chooserState.kind === 'refreshing'
  const isFailure = chooserState.kind === 'failure'
  const isDegraded = chooserState.kind === 'degraded'
  const hasVisibleApplications = visibleApplications.length > 0
  const hasNoResults = hasVisibleApplications && filteredApplications.length === 0
  const chooserReturnTo = buildChooserReturnTo(location, filteredApplications.length, searchTerm)
  const alertRailItems = useMemo(
    () => {
      if (isFailure) {
        return [
          {
            id: 'applications-load-failure',
            tone: 'danger',
            title: 'Applications could not be loaded',
            body: chooserState.errorMessage || 'DXCP could not load accessible applications right now. Refresh to try again.'
          }
        ]
      }
      if (isDegraded) {
        return [
          {
            id: 'applications-degraded-read',
            tone: 'warning',
            title: 'Supporting reads are degraded',
            body:
              'Application visibility remains usable for selection, but supporting access data may lag. Open the application record for the authoritative object page before making a delivery decision.'
          }
        ]
      }
      return []
    },
    [chooserState.errorMessage, isDegraded, isFailure]
  )

  useNewExperienceAlertRail(alertRailItems)

  const handleSearchChange = (event) => {
    const nextSearchParams = new URLSearchParams(searchParams)
    const nextValue = event.target.value
    if (nextValue) {
      nextSearchParams.set('q', nextValue)
    } else {
      nextSearchParams.delete('q')
    }
    setSearchParams(nextSearchParams)
  }

  const clearSearch = () => {
    const nextSearchParams = new URLSearchParams(searchParams)
    nextSearchParams.delete('q')
    setSearchParams(nextSearchParams)
  }

  const jumpToChooser = () => {
    const chooserSection = document.getElementById('new-applications-chooser-surface')
    if (chooserSection) {
      chooserSection.scrollIntoView({ block: 'start', behavior: 'smooth' })
    }
  }

  return (
    <div className="new-applications-chooser-page">
      <NewExperiencePageHeader
        title="Applications"
        objectIdentity="Choose an application to continue in DXCP"
        role={role}
        stateSummaryItems={[
          {
            label: 'Accessible applications',
            value:
              isLoading
                ? 'Loading'
                : isFailure
                  ? 'Unavailable'
                  : isDegraded
                    ? 'Degraded read'
                    : filteredApplications.length > 0
                      ? 'Browse available applications'
                      : 'Empty'
          },
          { label: 'Visible now', value: `${filteredApplications.length}` },
          { label: 'Access posture', value: roleAccessLabel(role) }
        ]}
        primaryAction={{ label: 'Choose below', state: 'available', onClick: jumpToChooser }}
        secondaryActions={[
          { label: isRefreshing ? 'Refreshing...' : 'Refresh', onClick: () => refreshChooserData({ bypassCache: true }), disabled: isRefreshing || isLoading },
          { label: 'Open Deployments', to: '/new/deployments', description: 'Browse recent deployment activity.' }
        ]}
        actionNote={
          isReadOnly
            ? 'Observers can choose and open accessible application records here, but deploy actions remain read-only on later routes.'
            : 'Choose an application first so deployment and history actions stay anchored to the application record rather than a generic workflow entry.'
        }
      />

      <SectionCard className="new-applications-chooser-card" id="new-applications-chooser-surface">
        <div className="new-section-header new-collection-header">
          <div>
            <h3>Application selection</h3>
            <p className="helper">
              Application identity stays primary. Supporting metadata is intentionally restrained so the route reads as a workflow entry, not a dashboard.
            </p>
          </div>
        </div>

        <div className="new-applications-chooser-toolbar">
          <label className="new-applications-search">
            <span>Search</span>
            <input
              type="search"
              value={searchTerm}
              onChange={handleSearchChange}
              placeholder={roleSearchPlaceholder(role)}
              aria-label="Search applications"
              disabled={isLoading || isFailure}
            />
          </label>
          <div className="new-deployments-results-summary" aria-live="polite">
            {isLoading
              ? 'Loading accessible applications so the chooser can stay anchored to real application access.'
              : isFailure
                ? 'Application access could not be read. Refresh to try again, or continue in the legacy experience if needed.'
                : isDegraded
                  ? 'Visible applications remain available to open, but freshness and supporting evidence may lag until application access reads recover.'
                  : 'Choose an application to continue in its object record. The collection stays restrained so the next step remains obvious.'}
          </div>
        </div>

        {isDegraded ? (
          <NewExplanation title="Supporting reads are degraded" tone="warning">
            Application visibility remains usable for selection, but supporting access data may lag. Open the application record for the authoritative object page before making a delivery decision.
          </NewExplanation>
        ) : null}

        {isLoading ? (
          <NewStateBlock eyebrow="Loading" title="Loading accessible applications">
            DXCP is loading the applications you can open from this route now.
          </NewStateBlock>
        ) : isFailure ? (
          <NewStateBlock
            eyebrow="Failure"
            title="Accessible applications could not be loaded"
            tone="danger"
            actions={[
              { label: 'Refresh', onClick: () => refreshChooserData({ bypassCache: true }) },
              { label: 'Open Legacy', to: '/services', secondary: true }
            ]}
          >
            {chooserState.errorMessage || 'DXCP could not load accessible applications right now. Refresh to try again.'}
          </NewStateBlock>
        ) : !hasVisibleApplications ? (
          <NewStateBlock
            eyebrow="Empty"
            title="No accessible applications are available"
            actions={[
              { label: 'Open Deployments', to: '/new/deployments', secondary: true },
              { label: 'Open Legacy', to: '/services', secondary: true }
            ]}
          >
            No application access records are available for the current user. The chooser remains the correct entry route even when the available collection is empty.
          </NewStateBlock>
        ) : hasNoResults ? (
          <NewStateBlock
            eyebrow="No results"
            title="No applications match this search"
            tone="warning"
            actions={[
              { label: 'Clear search', onClick: clearSearch },
              { label: 'Open Deployments', to: '/new/deployments', secondary: true }
            ]}
          >
            Try a different application name, owner, deployment group, or environment. This is different from an empty chooser because accessible application records exist outside the current search.
          </NewStateBlock>
        ) : (
          <div className="new-applications-chooser-list">
            {filteredApplications.map((application) => (
              <ApplicationChooserCard
                key={application.name}
                application={application}
                returnTo={chooserReturnTo}
                isReadOnly={isReadOnly}
              />
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  )
}

function ApplicationDetail({ role }) {
  const { applicationName = 'payments-api' } = useParams()
  const location = useLocation()
  const isReadOnly = role === 'OBSERVER'
  const isPlatformAdmin = role === 'PLATFORM_ADMIN'
  const returnTo = location.state?.returnTo || null
  const newDeployRoute = `/new/applications/${applicationName}/deploy`

  const secondaryActions = [
    { label: 'Open Applications', to: '/new/applications', description: 'Return to the application chooser.' },
    { label: 'Open Deployments', to: '/new/deployments', description: 'Browse recent deployments without leaving the new experience.' },
    { label: 'Refresh', disabled: false }
  ]

  const primaryAction = {
    label: 'Deploy',
    state: isReadOnly ? 'read-only' : 'blocked',
    description: isReadOnly ? 'Observers can inspect deploy readiness but cannot deploy.' : 'Deploy is blocked by an active deployment.'
  }

  return (
    <div className="new-application-page">
      <NewExperiencePageHeader
        title="Application"
        objectIdentity={applicationName}
        role={role}
        stateSummaryItems={[
          { label: 'Environment', value: APPLICATION_DETAIL_FIXTURE.environment },
          { label: 'Current version', value: APPLICATION_DETAIL_FIXTURE.currentVersion },
          { label: 'Recent state', value: APPLICATION_DETAIL_FIXTURE.currentOutcome }
        ]}
        primaryAction={primaryAction}
        secondaryActions={secondaryActions}
        actionNote={
          isReadOnly
            ? 'You can inspect current state and deployment history here, but only delivery owners can deploy from this workflow.'
            : 'Another deployment is already active for sandbox. Open that deployment or use the current deploy workflow when the active work completes.'
        }
      />

      {returnTo?.kind === 'applications-chooser' ? (
        <SectionCard className="new-detail-context-card">
          <div className="new-detail-context-row">
            <div>
              <strong>Opened from Applications</strong>
              <p className="helper">
                {returnTo.scopeSummary || 'Return to the chooser without losing the application-selection context.'}
              </p>
            </div>
            <Link className="link" to={returnTo.to}>
              {returnTo.label || 'Back to Applications'}
            </Link>
          </div>
        </SectionCard>
      ) : null}

      {applicationName !== 'payments-api' ? (
        <NewExplanation title="Application detail stays preview-only on this route" tone="warning">
          You reached the application object route from the real applications chooser. Real application-detail data wiring remains in a later slice, so the object route keeps its existing proof structure for now.
        </NewExplanation>
      ) : null}

      <div className="new-application-layout">
        <div className="new-application-primary">
          <SectionCard className="new-application-card">
            <div className="new-section-header">
              <div>
                <h3>Current running summary</h3>
                <p className="helper">Current state stays first so this page reads as the application record, not a browse surface.</p>
              </div>
              <div className="links">
                <Link className="link secondary" to={newDeployRoute}>
                  Open deploy workflow
                </Link>
                <Link className="link" to="/new/deployments/9831">
                  Open current deployment detail
                </Link>
              </div>
            </div>

            <dl className="new-object-summary-grid" aria-label="Application identity and current running summary">
              <dt>Application owner</dt>
              <dd>{APPLICATION_DETAIL_FIXTURE.owner}</dd>
              <dt>Deployment group</dt>
              <dd>{APPLICATION_DETAIL_FIXTURE.deploymentGroup}</dd>
              <dt>Environment</dt>
              <dd>{APPLICATION_DETAIL_FIXTURE.environment}</dd>
              <dt>Current version</dt>
              <dd>{APPLICATION_DETAIL_FIXTURE.currentVersion}</dd>
              <dt>Current state</dt>
              <dd>{APPLICATION_DETAIL_FIXTURE.currentOutcome}</dd>
              <dt>Running since</dt>
              <dd>{APPLICATION_DETAIL_FIXTURE.runningSince}</dd>
            </dl>

            <div className="new-running-callout">
              <strong>{APPLICATION_DETAIL_FIXTURE.lastChange}</strong>
              <p className="helper">{APPLICATION_DETAIL_FIXTURE.activeDeployment.summary}</p>
              <Link className="link" to="/new/deployments/9842">
                Open deployment {APPLICATION_DETAIL_FIXTURE.activeDeployment.id}
              </Link>
            </div>
          </SectionCard>

          <SectionCard className="new-application-card">
            <div className="new-section-header">
              <div>
                <h3>Recent state summary</h3>
                <p className="helper">Recent deployment state stays compact and only exposes the latest signals needed for the next handoff.</p>
              </div>
            </div>

            <NewExplanation title="Supporting reads are degraded" tone="warning">
              Recent state is current enough to orient the next action, but supporting evidence may lag. Open the deployment detail route for the authoritative record.
            </NewExplanation>

            <div className="new-activity-list">
              {APPLICATION_DETAIL_FIXTURE.recentState.map((item) => (
                <div key={item.label} className="new-activity-row">
                  <span className={`badge ${toneForState(item.state)}`}>{item.state}</span>
                  <div className="new-activity-copy">
                    <strong>{item.label}</strong>
                    <span>{item.detail}</span>
                  </div>
                  <span>{item.timestamp}</span>
                  {item.to ? (
                    <Link className="link" to={item.to}>
                      {item.linkLabel}
                    </Link>
                  ) : (
                    <span className="helper">No detail handoff needed</span>
                  )}
                </div>
              ))}
            </div>
          </SectionCard>
        </div>

        <aside className="new-application-support">
          <SectionCard className="new-application-card new-application-support-card">
            <h3>Supporting context</h3>
            <p className="helper">This stays compact so the object identity and current state remain primary.</p>

            <dl className="new-application-support-grid">
              <dt>Release path</dt>
              <dd>{APPLICATION_DETAIL_FIXTURE.support.releasePath}</dd>
              <dt>Policy posture</dt>
              <dd>{APPLICATION_DETAIL_FIXTURE.support.policyPosture}</dd>
            </dl>

            <div className="new-explanation-stack">
              <NewExplanation title="Guardrail posture" tone="neutral">
                Guardrails remain visible on the application record so deploy limits and next steps stay understandable before you open the deploy workflow.
              </NewExplanation>
              <NewExplanation title={isPlatformAdmin ? 'Diagnostics access' : 'Permission-limited detail'} tone="neutral">
                {isPlatformAdmin
                  ? 'Platform-admin diagnostics remain secondary to the normalized deployment record on this route.'
                  : APPLICATION_DETAIL_FIXTURE.support.diagnostics}
              </NewExplanation>
            </div>
          </SectionCard>
        </aside>
      </div>
    </div>
  )
}

export default function NewExperienceApplicationsPage({ role = 'UNKNOWN', api }) {
  const { applicationName } = useParams()

  if (applicationName) {
    return <ApplicationDetail role={role} />
  }

  return <ApplicationsChooser role={role} api={api} />
}
