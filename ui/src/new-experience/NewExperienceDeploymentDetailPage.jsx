import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import SectionCard from '../components/SectionCard.jsx'
import NewExperiencePageHeader from './NewExperiencePageHeader.jsx'
import { NewExplanation, NewStateBlock } from './NewExperienceStatePrimitives.jsx'
import { useNewExperienceAlertRail } from './NewExperienceShell.jsx'
import { loadDeploymentDetailData } from './newExperienceDeploymentsData.js'

function buildSecondaryActions(viewModel, returnTo, isRefreshing, refreshDetail) {
  const actions = []
  if (returnTo) {
    actions.push({
      label: returnTo.label || 'Back to Deployments',
      to: returnTo.to
    })
  }
  if (viewModel?.application) {
    actions.push({
      label: 'Open Application',
      to: `/new/applications/${viewModel.application}`
    })
  }
  actions.push({
    label: 'Open Deployments',
    to: '/new/deployments'
  })
  actions.push({
    label: isRefreshing ? 'Refreshing...' : 'Refresh',
    onClick: () => refreshDetail({ bypassCache: true }),
    disabled: isRefreshing,
    description: 'Refresh the deployment record, timeline, and supporting context.'
  })
  return actions
}

function returnToTitle(returnTo) {
  if (returnTo?.title) return returnTo.title
  return 'Opened from Deployments'
}

export default function NewExperienceDeploymentDetailPage({ role = 'UNKNOWN', api }) {
  const { deploymentId = '' } = useParams()
  const location = useLocation()
  const returnTo = location.state?.returnTo || null
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
      const nextState = await loadDeploymentDetailData(api, deploymentId, options)
      setDetailState(nextState)
    },
    [api, deploymentId]
  )

  useEffect(() => {
    let active = true
    const load = async () => {
      setDetailState({ kind: 'loading', viewModel: null, degradedReasons: [], errorMessage: '' })
      const nextState = await loadDeploymentDetailData(api, deploymentId)
      if (active) {
        setDetailState(nextState)
      }
    }
    load()
    return () => {
      active = false
    }
  }, [api, deploymentId])

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
          id: 'deployment-detail-failure',
          tone: 'danger',
          title: 'Deployment detail could not be loaded',
          body: detailState.errorMessage || 'DXCP could not load this deployment record right now. Refresh to try again.'
        }
      ]
    }
    if (isUnavailable) {
      return [
        {
          id: 'deployment-detail-unavailable',
          tone: 'danger',
          title: 'Deployment route is unavailable',
          body: detailState.errorMessage || 'This deployment is not available on this route.'
        }
      ]
    }
    if (isDegraded) {
      return [
        {
          id: 'deployment-detail-degraded',
          tone: 'warning',
          title: 'Supporting reads are degraded',
          body:
            'The deployment record remains available, but one or more supporting reads could not be refreshed.'
        }
      ]
    }
    return []
  }, [detailState.errorMessage, isDegraded, isFailure, isUnavailable])

  useNewExperienceAlertRail(alertRailItems)

  const secondaryActions = buildSecondaryActions(viewModel, returnTo, isRefreshing, refreshDetail)

  if (isFailure) {
    return (
      <div className="new-deployment-detail-page">
        <NewExperiencePageHeader
          title="Deployment"
          objectIdentity={`Deployment ${deploymentId}`}
          role={role}
          stateSummaryItems={[{ label: 'Route state', value: 'Unavailable' }]}
          primaryAction={{ label: 'Refresh', state: 'available', onClick: () => refreshDetail({ bypassCache: true }) }}
          secondaryActions={[{ label: 'Open Deployments', to: '/new/deployments' }]}
          actionNote="Deployment detail remains unavailable until DXCP can load the deployment record."
        />
        <NewStateBlock
          eyebrow="Failure"
          title="Deployment detail could not be loaded"
          tone="danger"
          actions={[
            { label: 'Refresh', onClick: () => refreshDetail({ bypassCache: true }) },
            { label: 'Open Deployments', to: '/new/deployments', secondary: true }
          ]}
        >
          {detailState.errorMessage || 'DXCP could not load this deployment record right now. Refresh to try again.'}
        </NewStateBlock>
      </div>
    )
  }

  if (isUnavailable) {
    return (
      <div className="new-deployment-detail-page">
        <NewExperiencePageHeader
          title="Deployment"
          objectIdentity={`Deployment ${deploymentId}`}
          role={role}
          stateSummaryItems={[{ label: 'Route state', value: 'Unavailable' }]}
          primaryAction={{ label: 'Refresh', state: 'available', onClick: () => refreshDetail({ bypassCache: true }) }}
          secondaryActions={[{ label: 'Open Deployments', to: '/new/deployments' }]}
          actionNote="This deployment is not available on this route."
        />
        <NewStateBlock
          eyebrow="Unavailable route"
          title="Deployment detail is not available on this route"
          tone="danger"
          actions={[
            { label: 'Open Deployments', to: '/new/deployments' },
            { label: 'Open Legacy', to: '/deployments', secondary: true }
          ]}
        >
          {detailState.errorMessage || 'This deployment is not available on this route.'}
        </NewStateBlock>
      </div>
    )
  }

  return (
    <div className="new-deployment-detail-page">
      <NewExperiencePageHeader
        title="Deployment"
        objectIdentity={`Deployment ${viewModel?.id || deploymentId}`}
        role={role}
        stateSummaryItems={viewModel?.stateSummaryItems || [{ label: 'Deployment state', value: isLoading ? 'Loading' : 'Unavailable' }]}
        primaryAction={{
          label: isRefreshing ? 'Refreshing...' : 'Refresh',
          state: 'available',
          onClick: () => refreshDetail({ bypassCache: true }),
          disabled: isLoading || isRefreshing,
          description: 'Refresh the deployment record, timeline, and supporting context.'
        }}
        secondaryActions={secondaryActions}
        actionNote="Deployment detail stays narrative-first. Supporting diagnostics remain bounded so the route does not turn into an execution console."
      />

      {returnTo ? (
        <SectionCard className="new-detail-context-card">
          <div className="new-detail-context-row">
            <div>
              <strong>{returnToTitle(returnTo)}</strong>
              <p className="helper">
                {returnTo.scopeSummary ||
                  'Browse continuity remains visible so you can return to the same deployment scope without losing place.'}
              </p>
            </div>
            <Link className="link" to={returnTo.to}>
              {returnTo.label || 'Back to Deployments'}
            </Link>
          </div>
        </SectionCard>
      ) : null}

      <div className="new-deployment-detail-layout">
        <div className="new-deployment-detail-primary">
          <SectionCard className="new-deployment-detail-card">
            <div className="new-section-header">
              <div>
                <h3>Deployment summary</h3>
                <p className="helper">
                  Current outcome is established before the event sequence so this route reads as a deployment record, not a raw event stream.
                </p>
              </div>
            </div>

            {isLoading ? (
              <NewStateBlock eyebrow="Loading" title="Loading deployment summary">
                DXCP is loading the deployment record and current outcome for this route.
              </NewStateBlock>
            ) : (
              <>
                <div className="new-detail-outcome-callout">
                  <span className={`badge ${viewModel.outcomeTone}`}>{viewModel.outcome}</span>
                  <div className="new-detail-outcome-copy">
                    <strong>{viewModel.kind}</strong>
                    <span>{viewModel.outcomeSummary}</span>
                  </div>
                </div>

                <dl className="new-object-summary-grid" aria-label="Deployment summary">
                  <dt>Application</dt>
                  <dd>{viewModel.application}</dd>
                  <dt>Environment</dt>
                  <dd>{viewModel.environment}</dd>
                  <dt>Version</dt>
                  <dd>{viewModel.version}</dd>
                  {viewModel.strategyName ? (
                    <>
                      <dt>Deployment Strategy</dt>
                      <dd>{viewModel.strategyName}</dd>
                    </>
                  ) : null}
                  <dt>Created</dt>
                  <dd>{viewModel.createdAt}</dd>
                  <dt>Updated</dt>
                  <dd>{viewModel.updatedAt}</dd>
                  <dt>Change summary</dt>
                  <dd>{viewModel.changeSummary}</dd>
                </dl>
              </>
            )}
          </SectionCard>

          {viewModel?.failureNarrative ? (
            <SectionCard className="new-deployment-detail-card">
              <div className="new-section-header">
                <div>
                  <h3>Failure narrative</h3>
                  <p className="helper">
                    DXCP keeps one normalized failure explanation visible before any deeper evidence.
                  </p>
                </div>
              </div>

              <NewExplanation title={viewModel.failureNarrative.category} tone="danger">
                <div className="new-failure-narrative-grid">
                  <div>
                    <span className="new-failure-label">What failed</span>
                    <strong>{viewModel.failureNarrative.whatFailed}</strong>
                  </div>
                  <div>
                    <span className="new-failure-label">Why it failed</span>
                    <strong>{viewModel.failureNarrative.whyItFailed}</strong>
                  </div>
                  <div>
                    <span className="new-failure-label">Next step</span>
                    <strong>{viewModel.failureNarrative.nextStep}</strong>
                  </div>
                  <div>
                    <span className="new-failure-label">Observed time</span>
                    <strong>{viewModel.failureNarrative.observedAt}</strong>
                  </div>
                </div>
              </NewExplanation>
            </SectionCard>
          ) : null}

          <SectionCard className="new-deployment-detail-card">
            <div className="new-section-header">
              <div>
                <h3>Deployment timeline</h3>
                <p className="helper">
                  Timeline entries are normalized into product-language milestones so the deployment story stays readable.
                </p>
              </div>
            </div>

            {isDegraded ? (
              <NewExplanation title="Supporting reads are degraded" tone="warning">
                {detailState.degradedReasons.join(' ')}
              </NewExplanation>
            ) : null}

            {isLoading ? (
              <NewStateBlock eyebrow="Loading" title="Loading deployment timeline">
                DXCP is loading the ordered deployment timeline for this record.
              </NewStateBlock>
            ) : viewModel.timeline.length === 0 ? (
              <NewStateBlock eyebrow="Empty" title="No timeline events are available yet">
                DXCP has not returned timeline evidence for this deployment on this route yet.
              </NewStateBlock>
            ) : (
              <ol className="new-deployment-timeline" aria-label="Deployment timeline">
                {viewModel.timeline.map((event) => (
                  <li key={event.id} className="new-timeline-event">
                    <div className="new-timeline-marker" aria-hidden="true" />
                    <div className="new-timeline-body">
                      <div className="new-timeline-header">
                        <div className="new-timeline-heading">
                          <span className={`badge ${event.tone}`}>{event.category}</span>
                          <strong>{event.title}</strong>
                        </div>
                        <span className="new-timeline-time">{event.time}</span>
                      </div>
                      <p className="new-timeline-summary">{event.summary}</p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </SectionCard>
        </div>

        <div className="new-deployment-detail-support">
          <SectionCard className="new-deployment-detail-card">
            <h3>Current running context</h3>
            <p className="helper">Supporting context stays secondary to the deployment story.</p>

            {isLoading ? (
              <NewStateBlock eyebrow="Loading" title="Loading current running context">
                DXCP is checking whether this deployment defines the current running version.
              </NewStateBlock>
            ) : viewModel?.currentRunning?.kind === 'ready' ? (
              <div className="new-detail-support-stack">
                <span className="badge info">{viewModel.currentRunning.relationship}</span>
                <dl className="new-application-support-grid">
                  <dt>Running version</dt>
                  <dd>{viewModel.currentRunning.version}</dd>
                  <dt>Environment</dt>
                  <dd>{viewModel.currentRunning.environment}</dd>
                  <dt>Deployment</dt>
                  <dd>
                    {viewModel.currentRunning.deploymentId ? (
                      <Link className="link" to={`/new/deployments/${viewModel.currentRunning.deploymentId}`}>
                        Deployment {viewModel.currentRunning.deploymentId}
                      </Link>
                    ) : (
                      'Not recorded'
                    )}
                  </dd>
                  <dt>Recorded</dt>
                  <dd>{viewModel.currentRunning.recordedAt}</dd>
                </dl>
              </div>
            ) : (
              <NewExplanation title="Current running context is unavailable" tone="warning">
                {viewModel?.currentRunning?.explanation}
              </NewExplanation>
            )}
          </SectionCard>

          <SectionCard className="new-deployment-detail-card">
            <h3>Policy context</h3>
            <p className="helper">Guardrail context stays readable, but it does not overtake the deployment narrative.</p>

            <dl className="new-application-support-grid">
              <dt>Deployment Group</dt>
              <dd>{viewModel?.policyContext?.deploymentGroup}</dd>
              <dt>Owner</dt>
              <dd>{viewModel?.policyContext?.owner}</dd>
              <dt>Allowed strategies</dt>
              <dd>{viewModel?.policyContext?.allowedStrategies}</dd>
              <dt>Concurrency</dt>
              <dd>{viewModel?.policyContext?.concurrency}</dd>
              <dt>Deploy quota</dt>
              <dd>{viewModel?.policyContext?.deployQuota}</dd>
              <dt>Rollback quota</dt>
              <dd>{viewModel?.policyContext?.rollbackQuota}</dd>
            </dl>
          </SectionCard>

          {viewModel?.strategyName || viewModel?.strategySummary ? (
            <SectionCard className="new-deployment-detail-card">
              <h3>Deployment Strategy snapshot</h3>
              <p className="helper">Strategy context is shown only when DXCP returned stable deployment-strategy information for this record.</p>
              <dl className="new-application-support-grid">
                {viewModel.strategyName ? (
                  <>
                    <dt>Deployment Strategy</dt>
                    <dd>{viewModel.strategyName}</dd>
                  </>
                ) : null}
                {viewModel.strategySummary ? (
                  <>
                    <dt>Behavior</dt>
                    <dd>{viewModel.strategySummary}</dd>
                  </>
                ) : null}
              </dl>
            </SectionCard>
          ) : null}

          {viewModel?.supportingEvidence?.length > 0 ? (
            <SectionCard className="new-deployment-detail-card">
              <h3>Supporting evidence</h3>
              <p className="helper">Source wording stays secondary here when DXCP needs to preserve exact transport evidence for truthfulness.</p>
              <details className="new-admin-diagnostics">
                <summary>View source wording</summary>
                <div className="new-explanation-stack">
                  {viewModel.supportingEvidence.map((section) => (
                    <NewExplanation key={section.id} title={section.title} tone="neutral">
                      <dl className="new-application-support-grid">
                        {section.items.map((item) => (
                          <React.Fragment key={`${section.id}-${item.label}`}>
                            <dt>{item.label}</dt>
                            <dd>{item.value}</dd>
                          </React.Fragment>
                        ))}
                      </dl>
                    </NewExplanation>
                  ))}
                </div>
              </details>
            </SectionCard>
          ) : null}

          <SectionCard className="new-deployment-detail-card">
            <h3>Diagnostics boundary</h3>
            {role === 'PLATFORM_ADMIN' && (viewModel?.diagnostics?.engineExecutionId || viewModel?.diagnostics?.engineExecutionUrl) ? (
              <details className="new-admin-diagnostics">
                <summary>View diagnostic references</summary>
                <dl className="new-application-support-grid">
                  {viewModel.diagnostics.engineExecutionId ? (
                    <>
                      <dt>Execution id</dt>
                      <dd>{viewModel.diagnostics.engineExecutionId}</dd>
                    </>
                  ) : null}
                  {viewModel.diagnostics.engineExecutionUrl ? (
                    <>
                      <dt>Execution detail</dt>
                      <dd>
                        <a className="link" href={viewModel.diagnostics.engineExecutionUrl} target="_blank" rel="noreferrer">
                          Open execution detail
                        </a>
                      </dd>
                    </>
                  ) : null}
                </dl>
              </details>
            ) : (
              <NewExplanation title="Bounded diagnostics" tone="neutral">
                Normalized outcome, failure narrative, and timeline stay primary here. Engine-adjacent diagnostics remain secondary and role-limited.
              </NewExplanation>
            )}
          </SectionCard>
        </div>
      </div>
    </div>
  )
}
