import React from 'react'
import { Link, useParams } from 'react-router-dom'
import SectionCard from '../components/SectionCard.jsx'
import NewExperiencePageHeader from './NewExperiencePageHeader.jsx'
import { NewExplanation } from './NewExperienceStatePrimitives.jsx'

const DEPLOY_FIXTURE = {
  deploymentGroup: 'Payments Core',
  strategy: 'Blue-Green',
  version: 'v1.33.0',
  changeSummary: 'Release payment retry fixes and sandbox verification updates.',
  guardrails: [
    'One active deployment at a time in each environment.',
    'Ten deploys per day across the deployment group.',
    'Rollbacks stay available but remain separately quota-limited.'
  ],
  strategies: ['Blue-Green', 'Rolling'],
  readinessBase: [
    'Application context is confirmed.',
    'Environment is selected.',
    'Deployment strategy is allowed for this deployment group.',
    'Version is eligible for deploy.',
    'Change summary is provided.'
  ]
}

function getScenario(role, requestedScenario) {
  if (role === 'OBSERVER' || requestedScenario === 'read-only') {
    return {
      key: 'read-only',
      environment: 'sandbox',
      primaryActionState: 'read-only',
      headerNote: 'Observers can review deploy intent and readiness, but only delivery owners can deploy from this workflow.',
      localTitle: 'Read-only workflow',
      localTone: 'warning',
      localExplanation:
        'This workflow remains visible so you can understand deploy requirements, current policy, and the next handoff without being invited into a blocked mutation path.',
      readiness: [
        ...DEPLOY_FIXTURE.readinessBase.map((item) => ({ label: item, status: 'met' })),
        { label: 'Mutation access is available for this workflow.', status: 'view-only' }
      ]
    }
  }

  if (requestedScenario === 'blocked') {
    return {
      key: 'blocked',
      environment: 'sandbox',
      primaryActionState: 'blocked',
      headerNote: 'Deploy is blocked because sandbox already has an active deployment for Payments Core.',
      localTitle: 'Deploy blocked by policy',
      localTone: 'danger',
      localExplanation:
        'Sandbox already has an active deployment for Payments Core. Wait for that deployment to complete, or open it to inspect progress before starting another deploy.',
      readiness: [
        ...DEPLOY_FIXTURE.readinessBase.map((item) => ({ label: item, status: 'met' })),
        { label: 'No active deployment is already running for sandbox.', status: 'blocked' }
      ]
    }
  }

  if (requestedScenario === 'permission-limited') {
    return {
      key: 'permission-limited',
      environment: 'production',
      primaryActionState: 'blocked',
      headerNote: 'Deploy is permission-limited because production deploys require platform-admin approval on this route.',
      localTitle: 'Permission-limited deploy',
      localTone: 'warning',
      localExplanation:
        'This intent is visible so you can review the deploy plan, but production deploys from this workflow are limited to platform admins. Return to the application or hand off to an authorized operator.',
      readiness: [
        ...DEPLOY_FIXTURE.readinessBase.map((item) => ({ label: item, status: 'met' })),
        { label: 'Your role is allowed to deploy to production.', status: 'blocked' }
      ]
    }
  }

  return {
    key: 'enabled',
    environment: 'sandbox',
    primaryActionState: 'available',
    headerNote: 'Deploy stays in the page header so the primary action remains stable while you review readiness below.',
    localTitle: 'Ready to deploy',
    localTone: 'neutral',
    localExplanation:
      'DXCP is ready to create a deployment record with this intent. Review the readiness conditions and supporting guardrails, then deploy when you are satisfied with the plan.',
    readiness: [
      ...DEPLOY_FIXTURE.readinessBase.map((item) => ({ label: item, status: 'met' })),
      { label: 'No active deployment is already running for sandbox.', status: 'met' }
    ]
  }
}

function readinessLabel(status) {
  if (status === 'blocked') return 'Blocked'
  if (status === 'view-only') return 'Read-only'
  return 'Ready'
}

function readinessClass(status) {
  if (status === 'blocked') return 'new-readiness-item blocked'
  if (status === 'view-only') return 'new-readiness-item view-only'
  return 'new-readiness-item ready'
}

export default function NewExperienceDeployPage({ role = 'UNKNOWN' }) {
  const { applicationName = 'payments-api', scenario } = useParams()
  const activeScenario = getScenario(role, scenario)

  const secondaryActions = [
    {
      label: 'Open Application',
      to: `/new/applications/${applicationName}`,
      description: 'Return to the application record without leaving the new experience.'
    },
    {
      label: 'Open Legacy Deploy',
      to: '/deploy',
      description: 'Use the current deploy workflow in the legacy experience during rollout.'
    }
  ]

  return (
    <div className="new-deploy-page">
      <NewExperiencePageHeader
        title="Deploy Application"
        objectIdentity={`Application: ${applicationName}`}
        role={role}
        stateSummaryItems={[
          { label: 'Environment', value: activeScenario.environment },
          { label: 'Deployment group', value: DEPLOY_FIXTURE.deploymentGroup },
          { label: 'Strategy', value: DEPLOY_FIXTURE.strategy }
        ]}
        primaryAction={{
          label: 'Deploy',
          state: activeScenario.primaryActionState,
          description: activeScenario.headerNote
        }}
        secondaryActions={secondaryActions}
        actionNote={activeScenario.headerNote}
      />

      <div className="new-deploy-layout">
        <SectionCard className="new-deploy-intent-card">
          <div className="new-section-header">
            <div>
              <h3>Intent entry</h3>
              <p className="helper">Define the deployment intent in DXCP product language before any deploy is attempted.</p>
            </div>
            <Link className="link secondary" to={`/new/applications/${applicationName}`}>
              Back to Application
            </Link>
          </div>

          <div className="new-intent-entry-grid">
            <label className="new-field">
              <span>Application</span>
              <input defaultValue={applicationName} readOnly />
            </label>
            <label className="new-field">
              <span>Environment</span>
              <select defaultValue={activeScenario.environment} disabled={activeScenario.key === 'read-only'}>
                <option value="sandbox">sandbox</option>
                <option value="production">production</option>
              </select>
            </label>
            <label className="new-field">
              <span>Deployment strategy</span>
              <select defaultValue={DEPLOY_FIXTURE.strategy} disabled={activeScenario.key === 'read-only'}>
                {DEPLOY_FIXTURE.strategies.map((strategy) => (
                  <option key={strategy} value={strategy}>
                    {strategy}
                  </option>
                ))}
              </select>
            </label>
            <label className="new-field">
              <span>Version</span>
              <input defaultValue={DEPLOY_FIXTURE.version} readOnly={activeScenario.key === 'read-only'} />
            </label>
            <label className="new-field new-field-full">
              <span>Change summary</span>
              <textarea
                defaultValue={DEPLOY_FIXTURE.changeSummary}
                readOnly={activeScenario.key === 'read-only'}
                rows={4}
              />
            </label>
          </div>

          <div className="new-deploy-action-review">
            <NewExplanation
              title={activeScenario.localTitle}
              tone={activeScenario.localTone}
              actions={
                activeScenario.key === 'blocked'
                  ? [
                      { label: 'Open Active Deployment', to: '/new/deployments/9842' },
                      { label: 'Open Legacy Deploy', to: '/deploy', secondary: true }
                    ]
                  : activeScenario.key === 'permission-limited'
                    ? [
                        { label: 'Open Application', to: `/new/applications/${applicationName}` },
                        { label: 'Back to Legacy', to: '/services', secondary: true }
                      ]
                    : activeScenario.key === 'read-only'
                      ? [
                          { label: 'Open Application', to: `/new/applications/${applicationName}` },
                          { label: 'Open Legacy Deploy', to: '/deploy', secondary: true }
                        ]
                      : []
              }
            >
              {activeScenario.localExplanation}
            </NewExplanation>
          </div>

          <div className="new-section-header">
            <div>
              <h3>Readiness review</h3>
              <p className="helper">Required readiness conditions stay visible before deploy so DXCP never relies on a generic failure after submit.</p>
            </div>
          </div>

          <div className="new-readiness-list" aria-label="Deploy readiness conditions">
            {activeScenario.readiness.map((item) => (
              <div key={item.label} className={readinessClass(item.status)}>
                <strong>{item.label}</strong>
                <span>{readinessLabel(item.status)}</span>
              </div>
            ))}
          </div>
        </SectionCard>

        <div className="new-deploy-support-stack">
          <SectionCard>
            <h3>Policy and guardrails</h3>
            <p className="helper">Supporting policy context stays secondary to the intent entry and readiness review.</p>

            <dl className="new-application-support-grid">
              <dt>Deployment group</dt>
              <dd>{DEPLOY_FIXTURE.deploymentGroup}</dd>
              <dt>Allowed strategies</dt>
              <dd>{DEPLOY_FIXTURE.strategies.join(', ')}</dd>
            </dl>

            <ul className="new-supporting-list">
              {DEPLOY_FIXTURE.guardrails.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </SectionCard>

          <SectionCard>
            <h3>Workflow clarity</h3>
            <p className="helper">DXCP expresses deploy intent and the resulting deployment record without exposing execution-engine mechanics.</p>

            <div className="new-explanation-stack">
              <NewExplanation title="What deploy creates" tone="neutral">
                Deploy creates a deployment record for this application, environment, version, and strategy. The resulting deployment detail becomes the authoritative place to follow progress.
              </NewExplanation>
              <NewExplanation title="Current handoff posture" tone="neutral">
                Supporting policy context remains available here, but it stays subordinate to the action-first deploy task and readiness review.
              </NewExplanation>
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  )
}
