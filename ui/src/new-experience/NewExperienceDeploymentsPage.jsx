import React from 'react'
import { Link, useLocation } from 'react-router-dom'
import SectionCard from '../components/SectionCard.jsx'
import NewExperiencePageHeader from './NewExperiencePageHeader.jsx'
import { NewExplanation, NewStateBlock } from './NewExperienceStatePrimitives.jsx'

const DEPLOYMENT_ROWS = [
  {
    id: '9842',
    status: 'In progress',
    tone: 'warn',
    application: 'payments-api',
    version: 'v1.33.0',
    environment: 'sandbox',
    strategy: 'Blue-Green',
    kind: 'Roll-forward',
    time: 'Started 2 minutes ago',
    note: 'Verification is still running before this deployment becomes current.'
  },
  {
    id: '9831',
    status: 'Succeeded',
    tone: 'info',
    application: 'payments-api',
    version: 'v1.32.1',
    environment: 'sandbox',
    strategy: 'Blue-Green',
    kind: 'Roll-forward',
    time: 'Completed 12 minutes ago',
    note: 'This deployment is the current running version for sandbox.'
  },
  {
    id: '9819',
    status: 'Failed',
    tone: 'danger',
    application: 'payments-api',
    version: 'v1.31.9',
    environment: 'production',
    strategy: 'Blue-Green',
    kind: 'Roll-forward',
    time: 'Yesterday at 17:27 UTC',
    note: 'Verification failed before the deployment could become the running version.'
  }
]

const SCENARIOS = {
  default: {
    stateSummaryItems: [
      { label: 'Time window', value: 'Last 7 days' },
      { label: 'Environment', value: 'sandbox' },
      { label: 'Browse state', value: 'Recent activity' }
    ],
    controls: {
      application: 'All applications',
      environment: 'sandbox',
      outcome: 'All outcomes',
      window: 'Last 7 days'
    },
    resultsSummary: '3 deployments in the last 7 days for sandbox. Recent activity stays bounded so this page supports detail handoff without becoming archive-first.',
    rows: DEPLOYMENT_ROWS,
    explanation: null,
    stateBlock: null
  },
  empty: {
    stateSummaryItems: [
      { label: 'Time window', value: 'Last 24 hours' },
      { label: 'Environment', value: 'sandbox' },
      { label: 'Browse state', value: 'Empty' }
    ],
    controls: {
      application: 'All applications',
      environment: 'sandbox',
      outcome: 'All outcomes',
      window: 'Last 24 hours'
    },
    resultsSummary: 'No deployments exist in the current recent window for sandbox yet.',
    rows: [],
    explanation: null,
    stateBlock: {
      eyebrow: 'Empty',
      title: 'No deployments recorded yet',
      tone: 'neutral',
      body: 'The recent deployment window is valid, but there is no deployment activity to browse yet. Open an application to begin from object context instead of turning this page into a placeholder archive.',
      actions: [
        { label: 'Open Applications', to: '/new/applications/payments-api', secondary: true },
        { label: 'Open Deploy Workflow', to: '/new/applications/payments-api/deploy' }
      ]
    }
  },
  'no-results': {
    stateSummaryItems: [
      { label: 'Time window', value: 'Last 24 hours' },
      { label: 'Environment', value: 'production' },
      { label: 'Browse state', value: 'No results' }
    ],
    controls: {
      application: 'payments-api',
      environment: 'production',
      outcome: 'Failed',
      window: 'Last 24 hours'
    },
    resultsSummary: 'No deployments match the current filters for payments-api in production. The collection remains in place so you can adjust scope without losing the page structure.',
    rows: [],
    explanation: null,
    stateBlock: {
      eyebrow: 'No results',
      title: 'No deployments match this scope',
      tone: 'warning',
      body: 'Try a broader outcome or time window to continue browsing. This is different from empty history because deployment records exist outside the current filters.',
      actions: [
        { label: 'Clear filters', to: '/new/deployments' },
        { label: 'Open Applications', to: '/new/applications/payments-api', secondary: true }
      ]
    }
  },
  'degraded-read': {
    stateSummaryItems: [
      { label: 'Time window', value: 'Last 7 days' },
      { label: 'Environment', value: 'sandbox' },
      { label: 'Browse state', value: 'Degraded read' }
    ],
    controls: {
      application: 'All applications',
      environment: 'sandbox',
      outcome: 'All outcomes',
      window: 'Last 7 days'
    },
    resultsSummary: '3 deployments remain available for browsing, but supporting refresh evidence is stale. You can still open deployment detail from the visible rows.',
    rows: DEPLOYMENT_ROWS,
    explanation: {
      title: 'Supporting reads are degraded',
      tone: 'warning',
      body: 'Visible rows remain useful for scan and handoff, but freshness and supporting evidence may lag. Open deployment detail for the authoritative record before acting on a stale assumption.'
    },
    stateBlock: null
  }
}

function renderControl(label, value, options) {
  return (
    <label className="new-field" key={label}>
      <span>{label}</span>
      <select value={value} disabled aria-label={label} onChange={() => {}}>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  )
}

function DeploymentRow({ row, returnTo }) {
  const detailRoute = `/new/deployments/${row.id}`

  return (
    <article className="new-deployment-row">
      <div className="new-deployment-status-cell">
        <span className={`badge ${row.tone}`}>{row.status}</span>
      </div>

      <div className="new-deployment-row-main">
        <Link className="new-deployment-row-title" to={detailRoute} state={{ returnTo }}>
          {row.application} · {row.version}
        </Link>
        <div className="new-deployment-row-subtitle">
          <span>{row.environment}</span>
          <span>{row.strategy}</span>
          <span>{row.kind}</span>
        </div>
        <p className="new-deployment-row-note">{row.note}</p>
      </div>

      <div className="new-deployment-row-meta">
        <span>{row.time}</span>
        <span>Deployment {row.id}</span>
      </div>

      <div className="new-deployment-row-action">
        <Link className="link secondary" to={detailRoute} state={{ returnTo }}>
          Open
        </Link>
      </div>
    </article>
  )
}

export default function NewExperienceDeploymentsPage({ role = 'UNKNOWN', scenario = 'default' }) {
  const location = useLocation()
  const activeScenario = SCENARIOS[scenario] || SCENARIOS.default
  const returnTo = {
    to: location.pathname,
    label: 'Back to Deployments',
    scopeSummary: activeScenario.resultsSummary
  }

  return (
    <div className="new-deployments-page">
      <NewExperiencePageHeader
        title="Deployments"
        objectIdentity="Recent deployment activity across applications"
        role={role}
        stateSummaryItems={activeScenario.stateSummaryItems}
        primaryAction={{ label: 'Refresh', state: 'available' }}
        secondaryActions={[
          {
            label: 'Open Applications',
            to: '/new/applications/payments-api',
            description: 'Return to the application object route.'
          }
        ]}
      />

      <SectionCard className="new-deployments-card">
        <div className="new-deployments-controls" aria-label="Deployment filters">
          {renderControl('Application', activeScenario.controls.application, ['All applications', 'payments-api', 'billing-worker'])}
          {renderControl('Environment', activeScenario.controls.environment, ['sandbox', 'staging', 'production'])}
          {renderControl('Outcome', activeScenario.controls.outcome, ['All outcomes', 'In progress', 'Succeeded', 'Failed'])}
          {renderControl('Time window', activeScenario.controls.window, ['Last 24 hours', 'Last 7 days', 'Last 30 days'])}
        </div>

        <div className="new-deployments-results-summary" aria-live="polite">
          {activeScenario.resultsSummary}
        </div>

        <div className="new-section-header new-collection-header">
          <div>
            <h3>Recent deployment activity</h3>
            <p className="helper">
              Row reading stays primary. Controls remain restrained so the collection supports DXCP without taking over the product.
            </p>
          </div>
        </div>

        {activeScenario.explanation ? (
          <NewExplanation title={activeScenario.explanation.title} tone={activeScenario.explanation.tone}>
            {activeScenario.explanation.body}
          </NewExplanation>
        ) : null}

        {activeScenario.stateBlock ? (
          <NewStateBlock
            eyebrow={activeScenario.stateBlock.eyebrow}
            title={activeScenario.stateBlock.title}
            tone={activeScenario.stateBlock.tone}
            actions={activeScenario.stateBlock.actions}
          >
            {activeScenario.stateBlock.body}
          </NewStateBlock>
        ) : (
          <div className="new-deployments-list" aria-label="Deployment collection">
            {activeScenario.rows.map((row) => (
              <DeploymentRow key={row.id} row={row} returnTo={returnTo} />
            ))}
          </div>
        )}

        <div className="new-deployments-footer">
          <button className="button secondary" type="button">
            Load older deployments
          </button>
          <span className="helper">Older history stays deliberate so recent activity remains the default browse posture.</span>
        </div>
      </SectionCard>
    </div>
  )
}
