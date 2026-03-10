import React from 'react'
import { Link, useParams } from 'react-router-dom'
import SectionCard from '../components/SectionCard.jsx'
import NewExperiencePageHeader from './NewExperiencePageHeader.jsx'
import { NewExplanation } from './NewExperienceStatePrimitives.jsx'

const APPLICATION_FIXTURE = {
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

export default function NewExperienceApplicationsPage({ role = 'UNKNOWN' }) {
  const { applicationName = 'payments-api' } = useParams()
  const isReadOnly = role === 'OBSERVER'
  const isPlatformAdmin = role === 'PLATFORM_ADMIN'
  const newDeployRoute = `/new/applications/${applicationName}/deploy`

  const secondaryActions = [
    { label: 'Open Deployments', disabled: false, description: 'Use the recent state summary to open deployment detail.' },
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
          { label: 'Environment', value: APPLICATION_FIXTURE.environment },
          { label: 'Current version', value: APPLICATION_FIXTURE.currentVersion },
          { label: 'Recent state', value: APPLICATION_FIXTURE.currentOutcome }
        ]}
        primaryAction={primaryAction}
        secondaryActions={secondaryActions}
        actionNote={
          isReadOnly
            ? 'You can inspect current state and deployment history here, but only delivery owners can deploy from this workflow.'
            : 'Another deployment is already active for sandbox. Open that deployment or use the current deploy workflow when the active work completes.'
        }
      />

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
          <dd>{APPLICATION_FIXTURE.owner}</dd>
          <dt>Deployment group</dt>
          <dd>{APPLICATION_FIXTURE.deploymentGroup}</dd>
          <dt>Environment</dt>
          <dd>{APPLICATION_FIXTURE.environment}</dd>
          <dt>Current version</dt>
          <dd>{APPLICATION_FIXTURE.currentVersion}</dd>
          <dt>Current state</dt>
          <dd>{APPLICATION_FIXTURE.currentOutcome}</dd>
          <dt>Running since</dt>
          <dd>{APPLICATION_FIXTURE.runningSince}</dd>
        </dl>

        <div className="new-running-callout">
          <strong>{APPLICATION_FIXTURE.lastChange}</strong>
          <p className="helper">{APPLICATION_FIXTURE.activeDeployment.summary}</p>
          <Link className="link" to="/new/deployments/9842">
            Open deployment {APPLICATION_FIXTURE.activeDeployment.id}
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
          {APPLICATION_FIXTURE.recentState.map((item) => (
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

      <SectionCard className="new-application-card new-application-support-card">
        <h3>Supporting context</h3>
        <p className="helper">This stays compact so the object identity and current state remain primary.</p>

        <dl className="new-application-support-grid">
          <dt>Release path</dt>
          <dd>{APPLICATION_FIXTURE.support.releasePath}</dd>
          <dt>Policy posture</dt>
          <dd>{APPLICATION_FIXTURE.support.policyPosture}</dd>
        </dl>

        <div className="new-explanation-stack">
          <NewExplanation title="Mutation disabled" tone="warning">
            DXCP can pause mutating actions for maintenance without hiding the deploy handoff or the current application record.
          </NewExplanation>
          <NewExplanation title={isPlatformAdmin ? 'Diagnostics access' : 'Permission-limited detail'} tone="neutral">
            {isPlatformAdmin
              ? 'Platform admin diagnostics remain secondary to the normalized deployment record in this preview.'
              : APPLICATION_FIXTURE.support.diagnostics}
          </NewExplanation>
        </div>
      </SectionCard>
    </div>
  )
}
