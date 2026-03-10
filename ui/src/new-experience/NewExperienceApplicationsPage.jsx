import React from 'react'
import { Link, useParams } from 'react-router-dom'
import SectionCard from '../components/SectionCard.jsx'
import NewExperiencePageHeader from './NewExperiencePageHeader.jsx'
import { NewExplanation } from './NewExperienceStatePrimitives.jsx'

export default function NewExperienceApplicationsPage({ role = 'UNKNOWN' }) {
  const { applicationName = 'payments-api' } = useParams()
  const isReadOnly = role === 'OBSERVER'
  const isPlatformAdmin = role === 'PLATFORM_ADMIN'

  const secondaryActions = [
    { label: 'Open Deployments', disabled: false },
    { label: 'Refresh', disabled: false }
  ]

  const primaryAction = {
    label: 'Deploy',
    state: isReadOnly ? 'read-only' : 'blocked',
    description: isReadOnly ? 'Observers can inspect deploy readiness but cannot deploy.' : 'Deploy is blocked by an active deployment.'
  }

  return (
    <>
      <NewExperiencePageHeader
        title="Applications"
        objectIdentity={`Application: ${applicationName}`}
        role={role}
        stateSummaryItems={[
          { label: 'Running Version', value: 'v1.32.1' },
          { label: 'Environment', value: 'sandbox' },
          { label: 'State', value: 'Succeeded' }
        ]}
        primaryAction={primaryAction}
        secondaryActions={secondaryActions}
        actionNote={
          isReadOnly
            ? 'You can review deploy readiness here, but only delivery owners can deploy from this workflow.'
            : 'Another deployment is active for sandbox. Open the active deployment or wait for it to finish.'
        }
      />
      <SectionCard>
        <h3>Running Version</h3>
        <p className="helper">v1.32.1 is serving sandbox. Deployment 9831 completed 12 minutes ago.</p>
      </SectionCard>
      <SectionCard>
        <div className="new-section-header">
          <h3>Recent Deployment Activity</h3>
          <button className="button secondary" type="button" disabled>
            Review deploy
          </button>
        </div>
        <NewExplanation title="Supporting reads are degraded" tone="warning">
          Recent activity is current, but failure evidence from the last refresh is still catching up. Open the latest
          deployment for the authoritative record.
        </NewExplanation>
        <div className="new-activity-list">
          <div className="new-activity-row">
            <span className="badge info">Succeeded</span>
            <span>v1.32.1</span>
            <span>12 minutes ago</span>
            <Link className="link" to="/new/deployments/9831">
              Open Deployment
            </Link>
          </div>
          <div className="new-activity-row">
            <span className="badge warn">Active</span>
            <span>v1.33.0</span>
            <span>Started 2 minutes ago</span>
            <Link className="link" to="/new/deployments/9842">
              Open Active Deployment
            </Link>
          </div>
        </div>
        <div className="space-12">
          <div className="helper">Disabled is used only for missing prerequisites or pending computation.</div>
          <div className="helper">Add a change summary in the deploy workflow to continue to review.</div>
        </div>
      </SectionCard>
      <SectionCard>
        <h3>Policy and Access</h3>
        <div className="new-explanation-stack">
          <NewExplanation title="Mutation disabled" tone="warning">
            DXCP is in read-only mode for maintenance. Deploy and rollback stay visible so operators can understand what
            is paused.
          </NewExplanation>
          {!isPlatformAdmin ? (
            <NewExplanation title="Permission-limited detail" tone="neutral">
              Execution diagnostics are limited to platform admins. Use the deployment record to understand outcome and
              next steps without engine detail.
            </NewExplanation>
          ) : (
            <NewExplanation title="Diagnostics access" tone="neutral">
              Platform admin detail remains secondary to the normalized deployment record in this preview.
            </NewExplanation>
          )}
        </div>
      </SectionCard>
    </>
  )
}
