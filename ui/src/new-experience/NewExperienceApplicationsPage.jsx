import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import OperationalDataList from '../components/OperationalDataList.jsx'
import LoadingText from '../components/LoadingText.jsx'
import SectionCard from '../components/SectionCard.jsx'
import NewExperiencePageHeader from './NewExperiencePageHeader.jsx'
import { NewExplanation, NewPageContextRail, NewStateBlock } from './NewExperienceStatePrimitives.jsx'
import { useNewExperienceAlertRail, useNewExperiencePageChrome, useNewExperienceStickyRail } from './NewExperienceShell.jsx'
import { loadApplicationDetailData, loadApplicationsChooserData } from './newExperienceApplicationsData.js'

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
    scopeSummary: 'Return to the application without losing application-level context.'
  }
}

function ApplicationDetailCardLoading({ lines = 3 }) {
  return (
    <div className="new-card-loading" aria-live="polite" aria-busy="true">
      <LoadingText>Loading...</LoadingText>
      <div className="new-card-loading-lines" aria-hidden="true">
        {Array.from({ length: lines }).map((_, index) => (
          <span key={index} className={`new-card-loading-line new-card-loading-line-${index + 1}`} />
        ))}
      </div>
    </div>
  )
}

const APPLICATION_COLUMNS = [
  { key: 'application', label: 'Application', width: 'minmax(240px, 2.4fr)', cellClassName: 'operational-list-cell-application' },
  { key: 'owner', label: 'Owner', width: 'minmax(150px, 1.15fr)' },
  { key: 'deploymentGroup', label: 'Delivery Group', width: 'minmax(170px, 1.2fr)' },
  { key: 'status', label: 'Status', width: 'minmax(120px, 0.8fr)', cellClassName: 'operational-list-cell-status' }
]

function buildApplicationDetailRoute(application) {
  return `/new/applications/${application.name}`
}

function buildApplicationOpenAction(application, returnTo, isReadOnly) {
  const actionCopy = isReadOnly ? 'Open Application in read-only mode' : 'Open Application'

  return {
    to: buildApplicationDetailRoute(application),
    state: { returnTo },
    label: `${actionCopy} ${application.name}`
  }
}

function renderApplicationCell(application, column, returnTo, isReadOnly) {
  if (column.key === 'application') {
    return (
      <div className="new-application-name-cell">
        <strong className="new-application-name">{application.name}</strong>
        {application.summary ? (
          <span className="new-application-summary" title={application.summary}>
            {application.summary}
          </span>
        ) : null}
      </div>
    )
  }
  if (column.key === 'owner') {
    return (
      <span className="new-operational-text" title={application.owner}>
        {application.owner}
      </span>
    )
  }
  if (column.key === 'deploymentGroup') {
    return (
      <span className="new-operational-text" title={application.deploymentGroup}>
        {application.deploymentGroup}
      </span>
    )
  }
  if (column.key === 'status') {
    return <span className={`badge ${application.recentStateTone}`}>{application.recentState}</span>
  }
  return null
}

function ApplicationsChooser({ role, api }) {
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const searchTerm = searchParams.get('q') || ''
  const requestedEnvironmentName = searchParams.get('environment') || ''
  const isReadOnly = role === 'OBSERVER'
  const [chooserState, setChooserState] = useState({
    kind: 'loading',
    applications: [],
    environmentOptions: [],
    selectedEnvironmentName: '',
    selectedEnvironmentLabel: '',
    degradedReasons: [],
    errorMessage: ''
  })

  const refreshChooserData = useCallback(
    async (options = {}) => {
      setChooserState((current) => ({
        kind: current.kind === 'ready' || current.kind === 'degraded' ? 'refreshing' : 'loading',
        applications: current.applications || [],
        environmentOptions: current.environmentOptions || [],
        selectedEnvironmentName: current.selectedEnvironmentName || '',
        selectedEnvironmentLabel: current.selectedEnvironmentLabel || '',
        degradedReasons: [],
        errorMessage: ''
      }))
      const nextState = await loadApplicationsChooserData(api, { environmentName: requestedEnvironmentName, ...options })
      setChooserState(nextState)
    },
    [api, requestedEnvironmentName]
  )

  useEffect(() => {
    let active = true
    const load = async () => {
      setChooserState({
        kind: 'loading',
        applications: [],
        environmentOptions: [],
        selectedEnvironmentName: '',
        selectedEnvironmentLabel: '',
        degradedReasons: [],
        errorMessage: ''
      })
      const nextState = await loadApplicationsChooserData(api, { environmentName: requestedEnvironmentName })
      if (active) {
        setChooserState(nextState)
      }
    }
    load()
    return () => {
      active = false
    }
  }, [api, requestedEnvironmentName])

  const visibleApplications = useMemo(() => chooserState.applications || [], [chooserState.applications])
  const environmentOptions = chooserState.environmentOptions || []
  const selectedEnvironmentName = chooserState.selectedEnvironmentName || ''
  const selectedEnvironmentLabel = chooserState.selectedEnvironmentLabel || 'Not available'
  const normalizedSearchTerm = searchTerm.trim().toLowerCase()
  const filteredApplications = useMemo(() => {
    if (!normalizedSearchTerm) return visibleApplications
    return visibleApplications.filter((application) => {
      const haystack = [
        application.name,
        application.summary,
        application.owner,
        application.deploymentGroup,
        application.recentState,
        application.recentStateDetail
      ]
        .join(' ')
        .toLowerCase()
      return haystack.includes(normalizedSearchTerm)
    })
  }, [normalizedSearchTerm, visibleApplications])

  useEffect(() => {
    if (!selectedEnvironmentName || selectedEnvironmentName === requestedEnvironmentName) return
    const nextSearchParams = new URLSearchParams(searchParams)
    nextSearchParams.set('environment', selectedEnvironmentName)
    setSearchParams(nextSearchParams, { replace: true })
  }, [requestedEnvironmentName, searchParams, selectedEnvironmentName, setSearchParams])

  const isLoading = chooserState.kind === 'loading'
  const isRefreshing = chooserState.kind === 'refreshing'
  const isFailure = chooserState.kind === 'failure'
  const isDegraded = chooserState.kind === 'degraded'
  const hasVisibleApplications = visibleApplications.length > 0
  const hasNoResults = hasVisibleApplications && filteredApplications.length === 0
  const chooserReturnTo = buildChooserReturnTo(location, filteredApplications.length, searchTerm)
  const environmentSelectorDisabled = isLoading || isFailure || environmentOptions.length === 0
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

  const handleEnvironmentChange = (event) => {
    const nextSearchParams = new URLSearchParams(searchParams)
    const nextValue = event.target.value
    if (nextValue) {
      nextSearchParams.set('environment', nextValue)
    } else {
      nextSearchParams.delete('environment')
    }
    setSearchParams(nextSearchParams)
  }

  const chooserFooterSummary = `${filteredApplications.length} application${filteredApplications.length === 1 ? '' : 's'} in ${selectedEnvironmentLabel}`

  return (
    <div className="new-applications-chooser-page">
      <NewExperiencePageHeader
        title="Applications"
        role={role}
        secondaryActions={[
          { label: isRefreshing ? 'Refreshing...' : 'Refresh', onClick: () => refreshChooserData({ bypassCache: true }), disabled: isRefreshing || isLoading }
        ]}
      />

      <SectionCard className="new-applications-chooser-card" id="new-applications-chooser-surface">
        <div className="new-section-header new-collection-header">
          <div>
            <h3>Applications</h3>
          </div>
          <div className="new-applications-section-controls">
            <label className="new-applications-page-context-control new-applications-page-context-control-inline" htmlFor="new-applications-environment">
              <span>Environment</span>
              <select
                id="new-applications-environment"
                value={selectedEnvironmentName}
                onChange={handleEnvironmentChange}
                disabled={environmentSelectorDisabled}
                aria-label="Environment"
                data-testid="applications-environment-selector"
              >
                {environmentOptions.length === 0 ? (
                  <option value="">Environment unavailable</option>
                ) : null}
                {environmentOptions.map((environment) => (
                  <option key={environment.name} value={environment.name}>
                    {environment.label}
                  </option>
                ))}
              </select>
            </label>
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
        </div>

        {isDegraded ? (
          <NewExplanation title="Supporting reads are degraded" tone="warning">
            Application visibility remains usable for selection, but supporting access data may lag. Open the application record for the authoritative object page before making a delivery decision.
          </NewExplanation>
        ) : null}

        {isLoading ? (
          <OperationalDataList
            ariaLabel="Application collection"
            columns={APPLICATION_COLUMNS}
            isLoading
            loadingMessage="Loading..."
            rows={[]}
            getRowKey={(application) => application.name}
            renderCell={() => null}
          />
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
            No applications are available for the current user on this route.
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
            Try a different application name, owner, deployment group, or status.
          </NewStateBlock>
        ) : (
          <OperationalDataList
            ariaLabel="Application collection"
            columns={APPLICATION_COLUMNS}
            rows={filteredApplications}
            footerSummary={chooserFooterSummary}
            getRowKey={(application) => application.name}
            getRowAction={(application) => buildApplicationOpenAction(application, chooserReturnTo, isReadOnly)}
            renderCell={(application, column) => renderApplicationCell(application, column, chooserReturnTo, isReadOnly)}
            renderSecondaryRow={(application) => (
              <p className="operational-list-note">{application.recentStateDetail}</p>
            )}
          />
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
  const newDeployRoute = `/new/applications/${applicationName}/deploy`
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

  const secondaryActions = useMemo(() => ([
    { label: isRefreshing ? 'Refreshing...' : 'Refresh', onClick: () => refreshDetail({ bypassCache: true }), disabled: isRefreshing || isLoading }
  ]), [isLoading, isRefreshing, refreshDetail])

  const primaryAction = useMemo(() => ({
    label: 'Deploy',
    state: isLoading ? 'disabled' : (viewModel?.actionPosture?.state || (isReadOnly ? 'read-only' : 'unavailable')),
    onClick:
      viewModel?.actionPosture?.state === 'available'
        ? () => navigate(newDeployRoute)
        : undefined,
    description: isLoading ? '' : (viewModel?.actionPosture?.note || 'Deploy handoff is unavailable on this route.')
  }), [isLoading, isReadOnly, navigate, newDeployRoute, viewModel?.actionPosture?.note, viewModel?.actionPosture?.state])
  const pageIssue = !isLoading && !isFailure && !isUnavailable ? (viewModel?.actionPosture?.issue || null) : null
  const pageIssues = useMemo(() => (pageIssue ? [pageIssue] : []), [pageIssue])
  const pageChrome = useMemo(() => (
    <NewExperiencePageHeader
      title="Application"
      objectIdentity={applicationName}
      role={role}
      showRoleNote={false}
      stateSummaryItems={
          viewModel?.stateSummaryItems || [
            { label: 'Environment', value: '' },
            { label: 'Current version', value: '' },
            { label: 'Recent state', value: '' }
          ]
        }
      primaryAction={primaryAction}
      secondaryActions={secondaryActions}
      actionNote={isLoading ? '' : (viewModel?.actionPosture?.note || '')}
      showActionNote={false}
    />
  ), [applicationName, isLoading, primaryAction, role, secondaryActions, viewModel?.actionPosture?.note, viewModel?.stateSummaryItems])
  const stickyRail = useMemo(() => (
    <>
      <NewPageContextRail items={pageIssues} />
    </>
  ), [pageIssues])
  useNewExperiencePageChrome(pageChrome)
  useNewExperienceStickyRail(stickyRail)

  const deploymentReturnTo = buildApplicationReturnTo(applicationName)

  return (
    <div className="new-application-page">
      <div className="new-page-context-body">
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
            <SectionCard className="new-application-card new-application-overview-card">
              <div className="new-section-header">
                <div>
                  <h3>Application overview</h3>
                </div>
              </div>

              {isLoading ? (
                <ApplicationDetailCardLoading lines={4} />
              ) : (
                <>
                  <div className="new-application-overview-section">
                  <dl className="new-object-summary-grid" aria-label="Application overview">
                    <dt>Application owner</dt>
                    <dd>{viewModel?.summary.owner}</dd>
                    <dt>Deployment group</dt>
                    <dd>{viewModel?.summary.deploymentGroup}</dd>
                    <dt>Environment</dt>
                    <dd>{viewModel?.summary.environment}</dd>
                    <dt>Application summary</dt>
                    <dd>{viewModel?.summary.summary}</dd>
                  </dl>
                  </div>

                  <div className="new-application-overview-divider" aria-hidden="true" />

                  <div className="new-application-overview-section">
                    <div className="new-section-header">
                      <div>
                        <h3>Current running summary</h3>
                      </div>
                      <div className="links">
                        <Link className="new-activity-action-link" to={newDeployRoute}>
                          <span>Deploy Workflow</span>
                          <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                            <path
                              d="M6 14L14 6"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                            <path
                              d="M8 6H14V12"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </Link>
                      </div>
                    </div>

                    {viewModel?.currentRunning?.kind === 'ready' ? (
                      <>
                        <dl className="new-object-summary-grid" aria-label="Current running state">
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
                                {viewModel.currentRunning.deploymentId}
                              </Link>
                            ) : (
                              'Not recorded'
                            )}
                          </dd>
                        </dl>

                        <div className="new-running-callout">
                          <strong>Running version: {viewModel.currentRunning.version}</strong>
                          <p className="helper">{viewModel.currentRunning.note}</p>
                        </div>
                      </>
                    ) : (
                      <NewExplanation title="Running state is unavailable" tone="warning">
                        {viewModel?.currentRunning?.explanation}
                      </NewExplanation>
                    )}
                  </div>

                  <div className="new-application-overview-divider" aria-hidden="true" />

                  <div className="new-application-overview-section">
                    <div className="new-section-header">
                      <div>
                        <h3>Recent deployment state</h3>
                      </div>
                    </div>

                    {isDegraded ? (
                      <NewExplanation title="Supporting reads are degraded" tone="warning">
                        Recent deployment detail may be stale or incomplete. Open deployment detail before acting on uncertain state.
                      </NewExplanation>
                    ) : null}

                    {viewModel?.recentDeploymentSummary?.kind === 'empty' ? (
                      <NewStateBlock eyebrow="Empty" title="No recent deployment state is available">
                        No recent deployment records are available for this application in the selected environment.
                      </NewStateBlock>
                    ) : (
                      <div className="new-activity-list">
                        {viewModel?.recentDeploymentSummary?.items.map((item) => (
                          <div key={item.key} className="new-activity-row">
                            <div className="new-activity-row-main">
                              <span className={`badge ${item.tone}`}>{item.state}</span>
                              <div className="new-activity-copy">
                                <strong>{item.label}</strong>
                                <span>{item.detail}</span>
                              </div>
                            </div>
                            <div className="new-activity-row-side">
                              <span className="new-activity-timestamp">{item.timestamp}</span>
                              {item.deploymentId ? (
                                <div className="new-activity-action">
                                  <Link
                                    className="new-activity-action-link"
                                    to={`/new/deployments/${item.deploymentId}`}
                                    state={{ returnTo: deploymentReturnTo }}
                                    aria-label={`Open deployment ${item.deploymentId}`}
                                    title={`Open deployment ${item.deploymentId}`}
                                  >
                                    <span>Deployment</span>
                                    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                                      <path
                                        d="M6 14L14 6"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                      />
                                      <path
                                        d="M8 6H14V12"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                      />
                                    </svg>
                                  </Link>
                                  <span className="new-activity-action-id" title={item.deploymentId}>
                                    {item.deploymentId}
                                  </span>
                                </div>
                              ) : (
                                <span className="helper">No deployment detail available</span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </SectionCard>
          </div>

          <aside className="new-application-support">
            <SectionCard className="new-application-card new-application-support-card">
              <h3>Supporting context</h3>

              {isLoading ? (
                <ApplicationDetailCardLoading lines={3} />
              ) : (
                <dl className="new-application-support-grid">
                  <dt>Release path</dt>
                  <dd>Deploy through the current DXCP deploy workflow for this application.</dd>
                  <dt>Delivery behavior</dt>
                  <dd>DXCP resolves delivery behavior from service and environment routing, then records the resolved recipe on each deployment.</dd>
                  <dt>Delivery group</dt>
                  <dd>{viewModel?.summary.deploymentGroup || 'Not assigned'}</dd>
                  <dt>Guardrail posture</dt>
                  <dd>
                    {viewModel?.guardrails?.length
                      ? viewModel.guardrails.join('. ')
                      : 'Guardrail context is not fully available on this route.'}
                  </dd>
                  {viewModel?.diagnosticsBoundary ? (
                    <>
                      <dt>{isPlatformAdmin ? 'Diagnostics access' : 'Permission-limited detail'}</dt>
                      <dd>{viewModel.diagnosticsBoundary}</dd>
                    </>
                  ) : null}
                </dl>
              )}
            </SectionCard>
          </aside>
          </div>
        ) : null}
      </div>
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
