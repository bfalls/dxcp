import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import SectionCard from '../components/SectionCard.jsx'
import NewExperiencePageHeader from './NewExperiencePageHeader.jsx'
import { NewExplanation, NewStateBlock } from './NewExperienceStatePrimitives.jsx'
import { useNewExperienceAlertRail } from './NewExperienceShell.jsx'
import { loadApplicationDetailData, loadApplicationsChooserData } from './newExperienceApplicationsData.js'

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

function buildApplicationReturnTo(applicationName) {
  return {
    kind: 'application',
    title: 'Opened from Application',
    to: `/new/applications/${applicationName}`,
    label: 'Back to Application',
    scopeSummary: 'Return to the application record without losing application-level context.'
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

function ApplicationDetail({ role, api }) {
  const { applicationName = 'payments-api' } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const isReadOnly = role === 'OBSERVER'
  const isPlatformAdmin = role === 'PLATFORM_ADMIN'
  const returnTo = location.state?.returnTo || null
  const newDeployRoute = `/new/applications/${applicationName}/deploy`
  const deploymentsRoute = `/new/deployments?service=${encodeURIComponent(applicationName)}`
  const [detailState, setDetailState] = useState({
    kind: 'loading',
    viewModel: null,
    degradedReasons: [],
    errorMessage: ''
  })

  const refreshDetail = useCallback(
    async (options = {}) => {
      setDetailState((current) => ({
        kind: current.kind === 'ready' || current.kind === 'degraded' ? 'refreshing' : 'loading',
        viewModel: current.viewModel,
        degradedReasons: [],
        errorMessage: ''
      }))
      const nextState = await loadApplicationDetailData(api, applicationName, role, options)
      setDetailState(nextState)
    },
    [api, applicationName, role]
  )

  useEffect(() => {
    let active = true
    const load = async () => {
      setDetailState({ kind: 'loading', viewModel: null, degradedReasons: [], errorMessage: '' })
      const nextState = await loadApplicationDetailData(api, applicationName, role)
      if (active) {
        setDetailState(nextState)
      }
    }
    load()
    return () => {
      active = false
    }
  }, [api, applicationName, role])

  const viewModel = detailState.viewModel
  const isLoading = detailState.kind === 'loading'
  const isRefreshing = detailState.kind === 'refreshing'
  const isFailure = detailState.kind === 'failure'
  const isUnavailable = detailState.kind === 'unavailable'
  const isDegraded = detailState.kind === 'degraded'
  const alertRailItems = useMemo(() => {
    if (isFailure) {
      return [
        {
          id: 'application-detail-failure',
          tone: 'danger',
          title: 'Application detail could not be loaded',
          body: detailState.errorMessage || 'DXCP could not load this application record right now. Refresh to try again.'
        }
      ]
    }
    if (isUnavailable) {
      return [
        {
          id: 'application-detail-unavailable',
          tone: 'danger',
          title: 'Application route is unavailable',
          body: detailState.errorMessage || 'This application is not available from the accessible DXCP application set on this route.'
        }
      ]
    }
    if (isDegraded) {
      return [
        {
          id: 'application-detail-degraded',
          tone: 'warning',
          title: 'Supporting application reads are degraded',
          body:
            'Application identity remains available, but one or more supporting reads are stale or missing. Open deployment detail for authoritative deployment records before acting on uncertain supporting state.'
        }
      ]
    }
    return []
  }, [detailState.errorMessage, isDegraded, isFailure, isUnavailable])

  useNewExperienceAlertRail(alertRailItems)

  const secondaryActions = [
    { label: 'Open Applications', to: '/new/applications', description: 'Return to the application chooser.' },
    { label: 'Open Deployments', to: deploymentsRoute, description: 'Browse recent deployments for this application.' },
    { label: isRefreshing ? 'Refreshing...' : 'Refresh', onClick: () => refreshDetail({ bypassCache: true }), disabled: isRefreshing || isLoading }
  ]

  const primaryAction = {
    label: 'Deploy',
    state: viewModel?.actionPosture?.state || (isReadOnly ? 'read-only' : 'unavailable'),
    onClick:
      viewModel?.actionPosture?.state === 'available'
        ? () => navigate(newDeployRoute)
        : undefined,
    description: viewModel?.actionPosture?.note || 'Deploy handoff is unavailable on this route.'
  }

  const deploymentReturnTo = buildApplicationReturnTo(applicationName)

  return (
    <div className="new-application-page">
      <NewExperiencePageHeader
        title="Application"
        objectIdentity={applicationName}
        role={role}
        stateSummaryItems={viewModel?.stateSummaryItems || [{ label: 'Application state', value: isLoading ? 'Loading' : 'Unavailable' }]}
        primaryAction={primaryAction}
        secondaryActions={secondaryActions}
        actionNote={viewModel?.actionPosture?.note || 'Application detail is loading.'}
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

      {isFailure ? (
        <NewStateBlock
          eyebrow="Failure"
          title="Application detail could not be loaded"
          tone="danger"
          actions={[
            { label: 'Refresh', onClick: () => refreshDetail({ bypassCache: true }) },
            { label: 'Open Applications', to: '/new/applications', secondary: true }
          ]}
        >
          {detailState.errorMessage || 'DXCP could not load this application record right now. Refresh to try again.'}
        </NewStateBlock>
      ) : null}

      {isUnavailable ? (
        <NewStateBlock
          eyebrow="Unavailable route"
          title="Application detail is not available on this route"
          tone="danger"
          actions={[
            { label: 'Open Applications', to: '/new/applications' },
            { label: 'Open Legacy', to: '/services', secondary: true }
          ]}
        >
          {detailState.errorMessage || 'This application is not available from the accessible DXCP application set on this route.'}
        </NewStateBlock>
      ) : null}

      {!isFailure && !isUnavailable ? (
        <div className="new-application-layout">
          <div className="new-application-primary">
            <SectionCard className="new-application-card">
              <div className="new-section-header">
                <div>
                  <h3>Application summary</h3>
                  <p className="helper">Application identity and core DXCP summary stay first so this route reads as an object page, not a dashboard.</p>
                </div>
              </div>

              {isLoading ? (
                <NewStateBlock eyebrow="Loading" title="Loading application summary">
                  DXCP is loading the application record so summary, running state, and recent deployment state stay tied to real application data.
                </NewStateBlock>
              ) : (
                <dl className="new-object-summary-grid" aria-label="Application summary">
                  <dt>Application owner</dt>
                  <dd>{viewModel?.summary.owner}</dd>
                  <dt>Deployment group</dt>
                  <dd>{viewModel?.summary.deploymentGroup}</dd>
                  <dt>Environment</dt>
                  <dd>{viewModel?.summary.environment}</dd>
                  <dt>Application summary</dt>
                  <dd>{viewModel?.summary.summary}</dd>
                </dl>
              )}
            </SectionCard>

            <SectionCard className="new-application-card">
            <div className="new-section-header">
              <div>
                <h3>Current running summary</h3>
                <p className="helper">Current running state stays primary and remains tied to the application record rather than a deployment feed.</p>
              </div>
              <div className="links">
                <Link className="link secondary" to={newDeployRoute}>
                  Open deploy workflow
                </Link>
                {viewModel?.currentRunning?.deploymentId ? (
                  <Link
                    className="link"
                    to={`/new/deployments/${viewModel.currentRunning.deploymentId}`}
                    state={{ returnTo: deploymentReturnTo }}
                  >
                    Open current deployment detail
                  </Link>
                ) : null}
              </div>
            </div>

            {isLoading ? (
              <NewStateBlock eyebrow="Loading" title="Loading current running state">
                DXCP is loading running-state data for this application.
              </NewStateBlock>
            ) : viewModel?.currentRunning?.kind === 'ready' ? (
              <>
                <dl className="new-object-summary-grid" aria-label="Current running summary">
                  <dt>Current version</dt>
                  <dd>{viewModel.currentRunning.version}</dd>
                  <dt>Environment</dt>
                  <dd>{viewModel.currentRunning.environment}</dd>
                  <dt>Recorded</dt>
                  <dd>{viewModel.currentRunning.recordedLabel}</dd>
                  <dt>Deployment</dt>
                  <dd>
                    {viewModel.currentRunning.deploymentId ? (
                      <Link
                        className="link"
                        to={`/new/deployments/${viewModel.currentRunning.deploymentId}`}
                        state={{ returnTo: deploymentReturnTo }}
                      >
                        Deployment {viewModel.currentRunning.deploymentId}
                      </Link>
                    ) : (
                      'Not recorded'
                    )}
                  </dd>
                </dl>

                <div className="new-running-callout">
                  <strong>
                    DXCP currently records {viewModel.currentRunning.version} as the running version for {applicationName} in {viewModel.currentRunning.environment}.
                  </strong>
                  <p className="helper">{viewModel.currentRunning.note}</p>
                </div>
              </>
            ) : (
              <NewExplanation title="Running state is unavailable" tone="warning">
                {viewModel?.currentRunning?.explanation}
              </NewExplanation>
            )}
            </SectionCard>

            <SectionCard className="new-application-card">
            <div className="new-section-header">
              <div>
                <h3>Recent deployment state</h3>
                <p className="helper">Recent deployment state stays restrained and only exposes the latest signals needed for the next handoff.</p>
              </div>
            </div>

            {isDegraded ? (
              <NewExplanation title="Supporting reads are degraded" tone="warning">
                Recent application context remains usable, but one or more supporting reads are stale or missing. Open deployment detail for the authoritative deployment record before acting on uncertain supporting state.
              </NewExplanation>
            ) : null}

            {isLoading ? (
              <NewStateBlock eyebrow="Loading" title="Loading recent deployment state">
                DXCP is loading recent deployment records for this application.
              </NewStateBlock>
            ) : viewModel?.recentDeploymentSummary?.kind === 'empty' ? (
              <NewStateBlock eyebrow="Empty" title="No recent deployment state is available">
                DXCP has not returned recent deployment records for this application in the selected environment yet.
              </NewStateBlock>
            ) : (
              <div className="new-activity-list">
                {viewModel?.recentDeploymentSummary?.items.map((item) => (
                  <div key={item.key} className="new-activity-row">
                    <span className={`badge ${item.tone}`}>{item.state}</span>
                    <div className="new-activity-copy">
                      <strong>{item.label}</strong>
                      <span>{item.detail}</span>
                    </div>
                    <span>{item.timestamp}</span>
                    {item.deploymentId ? (
                      <Link
                        className="link"
                        to={`/new/deployments/${item.deploymentId}`}
                        state={{ returnTo: deploymentReturnTo }}
                      >
                        Open deployment {item.deploymentId}
                      </Link>
                    ) : (
                      <span className="helper">No deployment detail available</span>
                    )}
                  </div>
                ))}
              </div>
            )}
            </SectionCard>
          </div>

          <aside className="new-application-support">
            <SectionCard className="new-application-card new-application-support-card">
              <h3>Supporting context</h3>
              <p className="helper">This stays compact so the object identity and current state remain primary.</p>

              <dl className="new-application-support-grid">
                <dt>Release path</dt>
                <dd>Deploy through the current DXCP deploy workflow for this application.</dd>
                <dt>Deployment group</dt>
                <dd>{viewModel?.summary.deploymentGroup || 'Not assigned'}</dd>
              </dl>

              <div className="new-explanation-stack">
                <NewExplanation title="Guardrail posture" tone={viewModel?.guardrails?.length ? 'neutral' : 'warning'}>
                  {viewModel?.guardrails?.length
                    ? `Guardrails remain visible on the application record so deploy limits and next steps stay understandable before you open the deploy workflow. ${viewModel.guardrails.join('. ')}.`
                    : 'Guardrail context could not be fully resolved for this application on this route.'}
                </NewExplanation>
                <NewExplanation title={isPlatformAdmin ? 'Diagnostics access' : 'Permission-limited detail'} tone="neutral">
                  {viewModel?.diagnosticsBoundary}
                </NewExplanation>
              </div>
            </SectionCard>
          </aside>
        </div>
      ) : null}
    </div>
  )
}

export default function NewExperienceApplicationsPage({ role = 'UNKNOWN', api }) {
  const { applicationName } = useParams()

  if (applicationName) {
    return <ApplicationDetail role={role} api={api} />
  }

  return <ApplicationsChooser role={role} api={api} />
}
