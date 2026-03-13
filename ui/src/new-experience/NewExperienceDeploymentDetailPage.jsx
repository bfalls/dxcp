import React from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import SectionCard from '../components/SectionCard.jsx'
import NewExperiencePageHeader from './NewExperiencePageHeader.jsx'
import { NewExplanation, NewStateBlock } from './NewExperienceStatePrimitives.jsx'

const DEPLOYMENT_FIXTURES = {
  '9831': {
    id: '9831',
    application: 'payments-api',
    environment: 'sandbox',
    version: 'v1.32.1',
    deploymentStrategy: 'Blue-Green',
    deploymentGroup: 'Payments Core',
    requestedBy: 'j.singh',
    createdAt: 'March 10, 2026 at 10:12 AM UTC',
    updatedAt: 'March 10, 2026 at 10:24 AM UTC',
    changeSummary: 'Release retry handling fixes and sandbox verification updates.',
    outcome: 'Succeeded',
    outcomeTone: 'info',
    kind: 'Roll-forward',
    rollbackActionState: 'available',
    rollbackNote: 'Rollback remains available. DXCP would create a new rollback deployment if you choose it.',
    currentRunning: {
      relationship: 'This deployment is the running version',
      version: 'v1.32.1',
      deploymentId: '9831',
      deploymentKind: 'Roll-forward',
      timestamp: 'Became current 12 minutes ago'
    },
    policyContext: {
      policyEffect: 'Policy checks passed before execution began.',
      owner: 'Payments Platform',
      allowedStrategies: 'Blue-Green, Rolling',
      deployQuota: '7 remaining today',
      rollbackQuota: '2 remaining today',
      concurrency: 'No other active deployment in sandbox'
    },
    strategySnapshot: {
      revision: 'Revision 4',
      behavior: 'Cutover completes after verification passes and the new version becomes current.'
    },
    actionContext: 'Rollback is available because this deployment succeeded and no current policy guardrail blocks it.',
    serviceUrl: 'https://payments-api.sandbox.example.internal',
    failureNarrative: null,
    timeline: [
      {
        id: 'intent-submitted',
        category: 'Submission',
        title: 'Deployment requested',
        time: '10:12 AM UTC',
        status: 'complete',
        summary: 'DXCP recorded the deploy intent for payments-api in sandbox.',
        details: [
          'Version v1.32.1 was selected with the Blue-Green deployment strategy.',
          'Change summary was captured before DXCP created the deployment record.'
        ]
      },
      {
        id: 'guardrails-passed',
        category: 'Guardrails',
        title: 'Guardrails allowed this deployment',
        time: '10:12 AM UTC',
        status: 'complete',
        summary: 'Policy, quota, and concurrency checks all passed.',
        details: [
          'Payments Core allowed the Blue-Green strategy for sandbox.',
          'No other deployment was active, so DXCP continued into execution.'
        ]
      },
      {
        id: 'execution-completed',
        category: 'Delivery',
        title: 'Delivery completed successfully',
        time: '10:23 AM UTC',
        status: 'complete',
        summary: 'Verification passed and DXCP marked the deployment as succeeded.',
        details: [
          'Traffic cutover completed without a rollback condition.',
          'DXCP confirmed the deployment outcome before updating running state.'
        ]
      },
      {
        id: 'running-state-updated',
        category: 'Current state',
        title: 'Running version updated',
        time: '10:24 AM UTC',
        status: 'current',
        summary: 'v1.32.1 is now the running version for payments-api in sandbox.',
        details: [
          'This deployment now defines the current running state for the application and environment.'
        ]
      }
    ],
    adminDiagnostics: {
      engineType: 'Spinnaker',
      executionId: 'exec-9831',
      requestId: 'req-9831',
      operatorHint: 'Execution completed normally. No follow-up diagnostic action is suggested.'
    }
  },
  '9842': {
    id: '9842',
    application: 'payments-api',
    environment: 'sandbox',
    version: 'v1.33.0',
    deploymentStrategy: 'Blue-Green',
    deploymentGroup: 'Payments Core',
    requestedBy: 'j.singh',
    createdAt: 'March 10, 2026 at 10:34 AM UTC',
    updatedAt: 'March 10, 2026 at 10:39 AM UTC',
    changeSummary: 'Promote the current retry fix candidate through sandbox verification.',
    outcome: 'In progress',
    outcomeTone: 'warn',
    kind: 'Roll-forward',
    rollbackActionState: 'blocked',
    rollbackNote:
      'Rollback is not available while this deployment is still in progress. Wait for the current deployment story to reach a finished outcome first.',
    currentRunning: {
      relationship: 'Running version has not changed yet',
      version: 'v1.32.1',
      deploymentId: '9831',
      deploymentKind: 'Roll-forward',
      timestamp: 'Current running state from 12 minutes ago'
    },
    policyContext: {
      policyEffect: 'Guardrails allowed this deployment and no policy block is active.',
      owner: 'Payments Platform',
      allowedStrategies: 'Blue-Green, Rolling',
      deployQuota: '6 remaining today',
      rollbackQuota: '2 remaining today',
      concurrency: 'This deployment currently holds the active deployment slot for sandbox'
    },
    strategySnapshot: {
      revision: 'Revision 4',
      behavior: 'Verification must complete before DXCP updates the running version.'
    },
    actionContext:
      'The next meaningful action is to follow this deployment record until DXCP sets the outcome. Rollback only becomes meaningful after a finished deployment state exists.',
    serviceUrl: 'https://payments-api.sandbox.example.internal',
    failureNarrative: null,
    timeline: [
      {
        id: 'intent-submitted',
        category: 'Submission',
        title: 'Deployment requested',
        time: '10:34 AM UTC',
        status: 'complete',
        summary: 'DXCP recorded the deploy intent for payments-api in sandbox.',
        details: [
          'Version v1.33.0 was selected with the Blue-Green deployment strategy.',
          'The deployment record is now the authoritative place to follow progress.'
        ]
      },
      {
        id: 'guardrails-passed',
        category: 'Guardrails',
        title: 'Guardrails allowed this deployment',
        time: '10:34 AM UTC',
        status: 'complete',
        summary: 'Policy, quota, and concurrency checks passed before execution began.',
        details: [
          'This deployment now occupies the active deployment slot for sandbox.'
        ]
      },
      {
        id: 'execution-active',
        category: 'Delivery',
        title: 'Verification is still running',
        time: '10:39 AM UTC',
        status: 'active',
        summary: 'DXCP is still validating this deployment before it can become current.',
        details: [
          'Execution has started and verification milestones are still arriving.',
          'Running state remains on v1.32.1 until DXCP records a finished outcome.'
        ]
      }
    ],
    adminDiagnostics: {
      engineType: 'Spinnaker',
      executionId: 'exec-9842',
      requestId: 'req-9842',
      operatorHint: 'Use diagnostics only if verification appears stalled beyond the normal window.'
    }
  },
  '9819': {
    id: '9819',
    application: 'payments-api',
    environment: 'production',
    version: 'v1.31.9',
    deploymentStrategy: 'Blue-Green',
    deploymentGroup: 'Payments Core',
    requestedBy: 'm.chen',
    createdAt: 'March 9, 2026 at 05:18 PM UTC',
    updatedAt: 'March 9, 2026 at 05:27 PM UTC',
    changeSummary: 'Release checkout timeout handling and production verification updates.',
    outcome: 'Failed',
    outcomeTone: 'danger',
    kind: 'Roll-forward',
    rollbackActionState: 'blocked',
    rollbackNote:
      'Rollback is blocked because this deployment never became the running version. Use the current running deployment record to decide the next safe action.',
    currentRunning: {
      relationship: 'Running version did not change',
      version: 'v1.31.8',
      deploymentId: '9812',
      deploymentKind: 'Roll-forward',
      timestamp: 'Still current in production'
    },
    policyContext: {
      policyEffect: 'Policy checks passed. The failure happened during delivery, not at guardrail review.',
      owner: 'Payments Platform',
      allowedStrategies: 'Blue-Green, Rolling',
      deployQuota: '3 remaining today',
      rollbackQuota: '1 remaining today',
      concurrency: 'No concurrent deployment block was active'
    },
    strategySnapshot: {
      revision: 'Revision 4',
      behavior: 'DXCP waits for verification to pass before this deployment can replace the running version.'
    },
    actionContext:
      'This screen explains the failed deployment story first. Current running context stays secondary so you can understand the failure before deciding what to do next.',
    serviceUrl: 'https://payments-api.example.internal',
    failureNarrative: {
      category: 'Failed during deploy',
      whatFailed: 'Verification did not pass after traffic cutover began.',
      whyItFailed:
        'DXCP observed sustained checkout timeout errors during verification, so the deployment could not become the running version.',
      nextStep: 'Inspect the current running deployment, fix the timeout condition, then deploy again.',
      retryability: 'Fix and retry',
      observedAt: 'Observed at 05:24 PM UTC'
    },
    timeline: [
      {
        id: 'intent-submitted',
        category: 'Submission',
        title: 'Deployment requested',
        time: '05:18 PM UTC',
        status: 'complete',
        summary: 'DXCP recorded the deploy intent for payments-api in production.',
        details: [
          'Version v1.31.9 was selected with the Blue-Green deployment strategy.',
          'Change summary was captured before the deployment record was created.'
        ]
      },
      {
        id: 'guardrails-passed',
        category: 'Guardrails',
        title: 'Guardrails allowed this deployment',
        time: '05:18 PM UTC',
        status: 'complete',
        summary: 'Policy, quota, and concurrency checks all passed.',
        details: [
          'Payments Core allowed this production deploy and no active deployment blocked the request.'
        ]
      },
      {
        id: 'failure-observed',
        category: 'Failure',
        title: 'DXCP observed a delivery failure',
        time: '05:24 PM UTC',
        status: 'failure',
        summary: 'Verification observed checkout timeout errors before DXCP could mark the deployment as healthy.',
        details: [
          'Primary failure: Failed during deploy.',
          'Next step: Inspect the current running deployment, fix the timeout condition, then deploy again.'
        ]
      },
      {
        id: 'outcome-failed',
        category: 'Outcome',
        title: 'Outcome set to failed',
        time: '05:27 PM UTC',
        status: 'failure',
        summary: 'DXCP recorded the deployment as failed and left the running version unchanged.',
        details: [
          'v1.31.8 remained the running version because the failed deployment never reached a healthy state.'
        ]
      }
    ],
    adminDiagnostics: {
      engineType: 'Spinnaker',
      executionId: 'exec-9819',
      requestId: 'req-9819',
      operatorHint: 'Diagnostics may help confirm whether the timeout came from a dependency or a startup regression.'
    }
  }
}

function currentRunningTone(fixture) {
  if (fixture.failureNarrative) return 'warn'
  if (fixture.outcome === 'In progress') return 'warn'
  return 'info'
}

function deploymentPrimaryActionState(role, fixture) {
  if (role === 'OBSERVER') return 'read-only'
  return fixture.rollbackActionState
}

function deploymentActionNote(role, fixture) {
  if (role === 'OBSERVER') {
    return 'You can inspect the deployment story and supporting context here, but rollback remains read-only for observers.'
  }
  return fixture.rollbackNote
}

function buildSecondaryActions(fixture, returnTo) {
  const actions = []
  if (returnTo) {
    actions.push({
      label: returnTo.label || 'Back to Deployments',
      to: returnTo.to
    })
  }
  actions.push({
    label: 'Open Application',
    to: `/new/applications/${fixture.application}`
  })
  actions.push({
    label: 'Open Deployments',
    to: '/new/deployments'
  })
  return actions
}

export default function NewExperienceDeploymentDetailPage({ role = 'UNKNOWN' }) {
  const { deploymentId = '9831' } = useParams()
  const location = useLocation()
  const fixture = DEPLOYMENT_FIXTURES[deploymentId]

  if (!fixture) {
    return (
      <>
        <NewExperiencePageHeader
          title="Deployment"
          objectIdentity={`Deployment ${deploymentId}`}
          role={role}
          stateSummaryItems={[{ label: 'Preview state', value: 'Not found' }]}
          primaryAction={{ label: 'Rollback', state: 'unavailable' }}
          secondaryActions={[{ label: 'Open Deployments', to: '/new/deployments' }]}
        />
        <NewStateBlock
          eyebrow="Unavailable route"
          title="Deployment detail is not available for this route"
          tone="danger"
          actions={[
            { label: 'Open Deployments', to: '/new/deployments' },
            { label: 'Open Legacy Deployments', to: '/deployments', secondary: true }
          ]}
        >
          Open a visible deployment from the recent collection, or continue in the legacy Deployments route for records that are not exposed here yet.
        </NewStateBlock>
      </>
    )
  }

  const returnTo = location.state?.returnTo || null
  const primaryActionState = deploymentPrimaryActionState(role, fixture)

  return (
    <div className="new-deployment-detail-page">
      <NewExperiencePageHeader
        title="Deployment"
        objectIdentity={`Deployment ${fixture.id}`}
        role={role}
        stateSummaryItems={[
          { label: 'Outcome', value: fixture.outcome },
          { label: 'Application', value: fixture.application },
          { label: 'Environment', value: fixture.environment }
        ]}
        primaryAction={{
          label: 'Rollback',
          state: primaryActionState,
          description: deploymentActionNote(role, fixture)
        }}
        secondaryActions={buildSecondaryActions(fixture, returnTo)}
        actionNote={deploymentActionNote(role, fixture)}
      />

      {returnTo ? (
        <SectionCard className="new-detail-context-card">
          <div className="new-detail-context-row">
            <div>
              <strong>Opened from Deployments</strong>
              <p className="helper">
                {returnTo.scopeSummary ||
                  'Browse continuity stays visible so you can return to the same collection story without losing place.'}
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
                  Current outcome is established before historical sequence so this route reads as an object page, not a raw event stream.
                </p>
              </div>
            </div>

            <div className="new-detail-outcome-callout">
              <span className={`badge ${fixture.outcomeTone}`}>{fixture.outcome}</span>
              <div className="new-detail-outcome-copy">
                <strong>{fixture.kind}</strong>
                <span>{fixture.changeSummary}</span>
              </div>
            </div>

            <dl className="new-object-summary-grid" aria-label="Deployment summary">
              <dt>Application</dt>
              <dd>{fixture.application}</dd>
              <dt>Environment</dt>
              <dd>{fixture.environment}</dd>
              <dt>Version</dt>
              <dd>{fixture.version}</dd>
              <dt>Deployment strategy</dt>
              <dd>{fixture.deploymentStrategy}</dd>
              <dt>Deployment group</dt>
              <dd>{fixture.deploymentGroup}</dd>
              <dt>Requested by</dt>
              <dd>{fixture.requestedBy}</dd>
              <dt>Created</dt>
              <dd>{fixture.createdAt}</dd>
              <dt>Updated</dt>
              <dd>{fixture.updatedAt}</dd>
            </dl>
          </SectionCard>

          {fixture.failureNarrative ? (
            <SectionCard className="new-deployment-detail-card">
              <div className="new-section-header">
                <div>
                  <h3>Failure narrative</h3>
                  <p className="helper">
                    DXCP uses one normalized primary explanation so failure stays actionable before deeper history and diagnostics.
                  </p>
                </div>
              </div>

              <NewExplanation title={fixture.failureNarrative.category} tone="danger">
                <div className="new-failure-narrative-grid">
                  <div>
                    <span className="new-failure-label">What failed</span>
                    <strong>{fixture.failureNarrative.whatFailed}</strong>
                  </div>
                  <div>
                    <span className="new-failure-label">Why it failed</span>
                    <strong>{fixture.failureNarrative.whyItFailed}</strong>
                  </div>
                  <div>
                    <span className="new-failure-label">Next step</span>
                    <strong>{fixture.failureNarrative.nextStep}</strong>
                  </div>
                  <div>
                    <span className="new-failure-label">Retryability</span>
                    <strong>{fixture.failureNarrative.retryability}</strong>
                  </div>
                  <div>
                    <span className="new-failure-label">Observed time</span>
                    <strong>{fixture.failureNarrative.observedAt}</strong>
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
                  Major delivery moments stay distinct from lower-level supporting detail so explainability remains readable without becoming noise.
                </p>
              </div>
            </div>

            <ol className="new-deployment-timeline" aria-label="Deployment timeline">
              {fixture.timeline.map((event) => (
                <li key={event.id} className="new-timeline-event">
                  <div className="new-timeline-marker" aria-hidden="true" />
                  <div className="new-timeline-body">
                    <div className="new-timeline-header">
                      <div className="new-timeline-heading">
                        <span className={`badge ${event.status === 'failure' ? 'danger' : event.status === 'active' ? 'warn' : event.status === 'current' ? 'info' : 'neutral'}`}>
                          {event.category}
                        </span>
                        <strong>{event.title}</strong>
                      </div>
                      <span className="new-timeline-time">{event.time}</span>
                    </div>
                    <p className="new-timeline-summary">{event.summary}</p>
                    <ul className="new-timeline-detail-list">
                      {event.details.map((detail) => (
                        <li key={detail}>{detail}</li>
                      ))}
                    </ul>
                  </div>
                </li>
              ))}
            </ol>
          </SectionCard>
        </div>

        <div className="new-deployment-detail-support">
          <SectionCard className="new-deployment-detail-card">
            <h3>Current running context</h3>
            <p className="helper">Supporting context stays secondary to the main deployment story.</p>
            <div className="new-detail-support-stack">
              <span className={`badge ${currentRunningTone(fixture)}`}>
                {fixture.currentRunning.relationship}
              </span>
              <dl className="new-application-support-grid">
                <dt>Running version</dt>
                <dd>{fixture.currentRunning.version}</dd>
                <dt>Deployment</dt>
                <dd>
                  <Link className="link" to={`/new/deployments/${fixture.currentRunning.deploymentId}`}>
                    Deployment {fixture.currentRunning.deploymentId}
                  </Link>
                </dd>
                <dt>Deployment kind</dt>
                <dd>{fixture.currentRunning.deploymentKind}</dd>
                <dt>Recorded</dt>
                <dd>{fixture.currentRunning.timestamp}</dd>
              </dl>
            </div>
          </SectionCard>

          <SectionCard className="new-deployment-detail-card">
            <h3>Policy context</h3>
            <p className="helper">Guardrail context stays readable but never overtakes the timeline.</p>
            <div className="new-explanation-stack">
              <NewExplanation title="Policy snapshot" tone={fixture.failureNarrative ? 'warning' : 'neutral'}>
                {fixture.policyContext.policyEffect}
              </NewExplanation>
            </div>
            <dl className="new-application-support-grid">
              <dt>Deployment group</dt>
              <dd>{fixture.deploymentGroup}</dd>
              <dt>Owner</dt>
              <dd>{fixture.policyContext.owner}</dd>
              <dt>Allowed strategies</dt>
              <dd>{fixture.policyContext.allowedStrategies}</dd>
              <dt>Deployments remaining today</dt>
              <dd>{fixture.policyContext.deployQuota}</dd>
              <dt>Rollbacks remaining today</dt>
              <dd>{fixture.policyContext.rollbackQuota}</dd>
              <dt>Concurrency</dt>
              <dd>{fixture.policyContext.concurrency}</dd>
            </dl>
          </SectionCard>

          <SectionCard className="new-deployment-detail-card">
            <h3>Deployment strategy snapshot</h3>
            <p className="helper">This explains delivery behavior at the time of the deployment without exposing engine mechanics.</p>
            <dl className="new-application-support-grid">
              <dt>Strategy</dt>
              <dd>{fixture.deploymentStrategy}</dd>
              <dt>Revision</dt>
              <dd>{fixture.strategySnapshot.revision}</dd>
              <dt>Behavior</dt>
              <dd>{fixture.strategySnapshot.behavior}</dd>
            </dl>
          </SectionCard>

          <SectionCard className="new-deployment-detail-card">
            <h3>Action context</h3>
            <div className="new-explanation-stack">
              <NewExplanation
                title={primaryActionState === 'available' ? 'Rollback posture' : primaryActionState === 'read-only' ? 'Read-only action posture' : 'Rollback blocked'}
                tone={primaryActionState === 'available' ? 'neutral' : primaryActionState === 'read-only' ? 'warning' : 'danger'}
              >
                {fixture.actionContext}
              </NewExplanation>
              <NewExplanation title="Service path" tone="neutral">
                Open Service URL stays secondary to the deployment record during rollout.
                <div className="space-8">
                  <a className="link" href={fixture.serviceUrl}>
                    Open Service URL
                  </a>
                </div>
              </NewExplanation>
            </div>
          </SectionCard>

          {role === 'PLATFORM_ADMIN' ? (
            <SectionCard className="new-deployment-detail-card">
              <h3>Admin diagnostics</h3>
              <p className="helper">Diagnostics stay collapsed in meaning even when visible to platform admins.</p>
              <details className="new-admin-diagnostics">
                <summary>View diagnostic references</summary>
                <dl className="new-application-support-grid">
                  <dt>Engine type</dt>
                  <dd>{fixture.adminDiagnostics.engineType}</dd>
                  <dt>Execution id</dt>
                  <dd>{fixture.adminDiagnostics.executionId}</dd>
                  <dt>Request id</dt>
                  <dd>{fixture.adminDiagnostics.requestId}</dd>
                  <dt>Operator hint</dt>
                  <dd>{fixture.adminDiagnostics.operatorHint}</dd>
                </dl>
              </details>
            </SectionCard>
          ) : (
            <SectionCard className="new-deployment-detail-card">
              <h3>Diagnostics boundary</h3>
              <NewExplanation title="Admin-only detail" tone="neutral">
                Normalized outcome, failure narrative, and timeline remain available here. Engine-adjacent diagnostics stay limited to platform-admin disclosure.
              </NewExplanation>
            </SectionCard>
          )}
        </div>
      </div>
    </div>
  )
}
