import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import SectionCard from '../components/SectionCard.jsx'
import NewExperiencePageHeader from './NewExperiencePageHeader.jsx'
import { NewStateBlock } from './NewExperienceStatePrimitives.jsx'
import { useNewExperienceAlertRail } from './NewExperienceShell.jsx'

const WINDOW_OPTIONS = ['Last 24 hours', 'Last 7 days', 'Last 30 days']
const APPLICATION_OPTIONS = ['All applications', 'payments-api', 'billing-worker', 'web-frontend']
const GROUP_OPTIONS = ['All deployment groups', 'Payments Core', 'Checkout Reliability', 'Web Delivery']

const INSIGHTS_SCENARIOS = {
  default: {
    summary: [
      {
        label: 'Deployments',
        value: '84',
        comparison: '12 more than the prior 7-day window',
        note: 'Recent deploy volume stayed within the usual operating range.'
      },
      {
        label: 'Failures',
        value: '9',
        comparison: '3 fewer than the prior 7-day window',
        note: 'Failures remain visible, but they do not dominate overall delivery reading.'
      },
      {
        label: 'Rollbacks',
        value: '3',
        comparison: '1 more than the prior 7-day window',
        note: 'Rollback activity is elevated enough to inspect, not to alarm.'
      }
    ],
    trendSections: [
      {
        title: 'Failure trend',
        summary: 'Failure activity is lower than the previous equivalent period, with the most recent dip centered in sandbox verification issues.',
        rows: [
          { label: 'Current window', value: 9, note: 'Selected scope' },
          { label: 'Previous window', value: 12, note: 'Comparison period' }
        ],
        drillTo: '/new/deployments'
      },
      {
        title: 'Rollback trend',
        summary: 'Rollback share increased slightly, concentrated in one production deployment group rather than system-wide drift.',
        rows: [
          { label: 'Current window', value: 3, note: 'Selected scope' },
          { label: 'Previous window', value: 2, note: 'Comparison period' }
        ],
        drillTo: '/new/deployments'
      }
    ],
    breakdownSections: [
      {
        title: 'Failures by category',
        intro: 'Breakdown explains what is driving the trend before you drill into a deployment record.',
        rows: [
          { label: 'Config', value: 4, detail: 'Mostly sandbox verification misconfiguration.', to: '/new/deployments' },
          { label: 'Infrastructure', value: 3, detail: 'Capacity and dependency reachability issues.', to: '/new/deployments' },
          { label: 'Policy', value: 2, detail: 'Quota and concurrency denials stayed bounded.', to: '/new/deployments' }
        ]
      },
      {
        title: 'Deployments by Deployment Strategy',
        intro: 'Strategy distribution stays descriptive and recent, not a separate analytics system.',
        rows: [
          { label: 'Blue-Green', value: 42, detail: 'Still the dominant approved strategy.', to: '/new/deployments' },
          { label: 'Rolling', value: 31, detail: 'Used steadily across lower-risk changes.', to: '/new/deployments' },
          { label: 'Canary', value: 11, detail: 'Used selectively for higher-risk releases.', to: '/new/deployments' }
        ]
      },
      {
        title: 'Deployments by Deployment Group',
        intro: 'Group-level aggregates stay compact so they point to object work instead of replacing it.',
        rows: [
          { label: 'Payments Core', value: 26, detail: 'Highest volume and most rollback activity.', to: '/new/deployments' },
          { label: 'Checkout Reliability', value: 21, detail: 'Stable with one recent failed verification.', to: '/new/deployments' },
          { label: 'Web Delivery', value: 18, detail: 'Broadly stable across the selected window.', to: '/new/deployments' }
        ]
      }
    ],
    attentionItems: [
      {
        title: 'Payments Core rollback activity increased',
        detail: 'Rollback share rose in production compared with the prior period. Open Deployments to inspect the affected records before drawing a system-wide conclusion.',
        to: '/new/deployments'
      },
      {
        title: 'Checkout Reliability failures remain concentrated',
        detail: 'Recent failures cluster in one deployment group instead of appearing across DXCP. Open the application route to review current running state before redeploying.',
        to: '/new/applications/payments-api'
      }
    ],
    notableActivity: [
      {
        statement: 'Rollback completed for payments-api in production',
        detail: 'Open the deployment record for the normalized timeline and rollback context.',
        to: '/new/deployments/9819'
      },
      {
        statement: 'Deployment succeeded for web-frontend after a prior failure',
        detail: 'This reads as recovery activity rather than an unresolved alert condition.',
        to: '/new/deployments/9831'
      }
    ],
    degradedNotice: null,
    failureState: null,
    emptyState: null
  },
  empty: {
    summary: [
      {
        label: 'Deployments',
        value: '0',
        comparison: 'No activity in the selected time range',
        note: 'This is a valid empty window, not a broken read.'
      },
      {
        label: 'Failures',
        value: '0',
        comparison: 'No failures recorded',
        note: 'Failure trend is quiet because no deployments occurred.'
      },
      {
        label: 'Rollbacks',
        value: '0',
        comparison: 'No rollbacks recorded',
        note: 'Rollback analysis remains intentionally calm in sparse periods.'
      }
    ],
    trendSections: [],
    breakdownSections: [],
    attentionItems: [],
    notableActivity: [],
    degradedNotice: null,
    failureState: null,
    emptyState: {
      eyebrow: 'Empty',
      title: 'No deployments in this time range',
      body: 'Insights keeps the same page structure when the selected scope has no delivery activity. Try a broader time window or clear scope filters before switching into a different object route.',
      actions: [{ label: 'Open Applications', to: '/new/applications/payments-api', secondary: true }]
    }
  },
  'degraded-read': {
    summary: [
      {
        label: 'Deployments',
        value: '76',
        comparison: '8 fewer than the prior 7-day window',
        note: 'Core aggregates remain available.'
      },
      {
        label: 'Failures',
        value: '11',
        comparison: '1 fewer than the prior 7-day window',
        note: 'Some supporting reads are stale.'
      },
      {
        label: 'Rollbacks',
        value: '4',
        comparison: '2 more than the prior 7-day window',
        note: 'Rollback reading remains useful, but some secondary grouping is missing.'
      }
    ],
    trendSections: [
      {
        title: 'Failure trend',
        summary: 'The main trend remains readable even though one supporting breakdown is unavailable.',
        rows: [
          { label: 'Current window', value: 11, note: 'Selected scope' },
          { label: 'Previous window', value: 12, note: 'Comparison period' }
        ],
        drillTo: '/new/deployments'
      },
      {
        title: 'Rollback trend',
        summary: 'Rollback activity is still bounded to a small set of recent records.',
        rows: [
          { label: 'Current window', value: 4, note: 'Selected scope' },
          { label: 'Previous window', value: 2, note: 'Comparison period' }
        ],
        drillTo: '/new/deployments'
      }
    ],
    breakdownSections: [
      {
        title: 'Failures by category',
        intro: 'Available supporting reads stay visible instead of collapsing the whole screen.',
        rows: [
          { label: 'Config', value: 5, detail: 'Verification and environment configuration issues.', to: '/new/deployments' },
          { label: 'Infrastructure', value: 4, detail: 'Capacity and service dependency failures.', to: '/new/deployments' },
          { label: 'Policy', value: 2, detail: 'Limited quota and concurrency denials.', to: '/new/deployments' }
        ]
      },
      {
        title: 'Deployments by Deployment Strategy',
        intro: 'Strategy grouping still reads clearly in the degraded state.',
        rows: [
          { label: 'Blue-Green', value: 38, detail: 'Dominant strategy in the visible data.', to: '/new/deployments' },
          { label: 'Rolling', value: 28, detail: 'Used steadily across lower-risk deploys.', to: '/new/deployments' },
          { label: 'Canary', value: 10, detail: 'Used selectively for higher-risk deploys.', to: '/new/deployments' }
        ]
      },
      {
        title: 'Deployments by Deployment Group',
        intro: 'This region could not be refreshed for the selected scope.',
        stateBlock: {
          eyebrow: 'Degraded read',
          title: 'Deployment Group breakdown is temporarily unavailable',
          tone: 'warning',
          body: 'Trend and other breakdowns remain available, but this grouping did not refresh. Open Deployments for the authoritative scoped list while the supporting read catches up.',
          actions: [{ label: 'Open Deployments', to: '/new/deployments' }]
        }
      }
    ],
    attentionItems: [
      {
        title: 'Rollback concentration remains visible',
        detail: 'Even with one supporting read missing, recent rollback activity still points to a contained slice worth investigating next.',
        to: '/new/deployments'
      }
    ],
    notableActivity: [
      {
        statement: 'Failure observed for billing-worker in staging',
        detail: 'Open the deployment record for the normalized failure narrative.',
        to: '/new/deployments/9819'
      }
    ],
    degradedNotice: {
      title: 'Supporting reads are degraded',
      body: 'Insights remains usable for aggregate orientation, but one supporting breakdown is unavailable. Refresh can retry the missing region without replacing the rest of the page.'
    },
    failureState: null,
    emptyState: null
  },
  failure: {
    summary: [],
    trendSections: [],
    breakdownSections: [],
    attentionItems: [],
    notableActivity: [],
    degradedNotice: null,
    emptyState: null,
    failureState: {
      title: 'Insights could not be loaded',
      explanation:
        'DXCP could not refresh the selected Insights scope. Keep using Applications and Deployments for object-level understanding while this aggregate read is unavailable.',
      stateBlock: {
        eyebrow: 'Read failure',
        title: 'Aggregate delivery reading is unavailable right now',
        body: 'The new Insights route keeps the same header, scope controls, and refresh action so you can retry without losing page context.',
        actions: [
          { label: 'Open Deployments', to: '/new/deployments' },
          { label: 'Open Applications', to: '/new/applications/payments-api', secondary: true }
        ]
      }
    }
  }
}

function scopeSummary(applicationScope, groupScope) {
  if (applicationScope !== 'All applications') return applicationScope
  if (groupScope !== 'All deployment groups') return groupScope
  return 'All visible delivery scope'
}

function formatRefreshStamp(timestamp) {
  return timestamp.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function buildReturnTo(location, scopeText) {
  return {
    to: location.pathname,
    label: 'Back to Insights',
    scopeSummary: scopeText
  }
}

function InsightTrendCard({ section, returnTo }) {
  const maxValue = Math.max(...section.rows.map((row) => row.value), 1)

  return (
    <article className="new-insights-trend-card">
      <div className="new-insights-block-header">
        <h4>{section.title}</h4>
        <Link className="link secondary" to={section.drillTo} state={{ returnTo }}>
          View matching deployments
        </Link>
      </div>
      <p className="helper">{section.summary}</p>
      <div className="new-insights-trend-list">
        {section.rows.map((row) => (
          <div key={row.label} className="new-insights-trend-row">
            <div className="new-insights-trend-copy">
              <strong>{row.label}</strong>
              <span>{row.note}</span>
            </div>
            <div className="new-insights-meter" aria-hidden="true">
              <div className="new-insights-meter-fill" style={{ width: `${Math.max((row.value / maxValue) * 100, 14)}%` }} />
            </div>
            <span className="new-insights-trend-value">{row.value}</span>
          </div>
        ))}
      </div>
    </article>
  )
}

function InsightBreakdownCard({ section, returnTo }) {
  return (
    <article className="new-insights-breakdown-card">
      <div className="new-insights-block-header">
        <h4>{section.title}</h4>
      </div>
      <p className="helper">{section.intro}</p>
      {section.stateBlock ? (
        <NewStateBlock
          eyebrow={section.stateBlock.eyebrow}
          title={section.stateBlock.title}
          tone={section.stateBlock.tone}
          actions={section.stateBlock.actions}
        >
          {section.stateBlock.body}
        </NewStateBlock>
      ) : (
        <div className="new-insights-breakdown-list">
          {section.rows.map((row) => (
            <div key={row.label} className="new-insights-breakdown-row">
              <div className="new-insights-breakdown-copy">
                <strong>{row.label}</strong>
                <span>{row.detail}</span>
              </div>
              <span className="new-insights-breakdown-value">{row.value}</span>
              <Link className="link secondary" to={row.to} state={{ returnTo }}>
                View
              </Link>
            </div>
          ))}
        </div>
      )}
    </article>
  )
}

export default function NewExperienceInsightsPage({ role = 'UNKNOWN' }) {
  const { scenario = 'default' } = useParams()
  const location = useLocation()
  const activeScenario = INSIGHTS_SCENARIOS[scenario] || INSIGHTS_SCENARIOS.default
  const [timeWindow, setTimeWindow] = useState('Last 7 days')
  const [applicationScope, setApplicationScope] = useState('All applications')
  const [groupScope, setGroupScope] = useState('All deployment groups')
  const [refreshing, setRefreshing] = useState(false)
  const [refreshStamp, setRefreshStamp] = useState(() => new Date('2026-03-11T10:12:00Z'))
  const [refreshMessage, setRefreshMessage] = useState('')
  const refreshTimerRef = useRef(null)

  useEffect(() => {
    setRefreshMessage('')
    setRefreshing(false)
  }, [scenario])

  useEffect(() => () => {
    if (refreshTimerRef.current) {
      window.clearTimeout(refreshTimerRef.current)
    }
  }, [])

  const currentScopeSummary = useMemo(
    () => scopeSummary(applicationScope, groupScope),
    [applicationScope, groupScope]
  )

  const returnTo = useMemo(
    () => buildReturnTo(location, `${timeWindow} · ${currentScopeSummary}`),
    [location, timeWindow, currentScopeSummary]
  )
  const alertRailItems = useMemo(() => {
    const items = []

    if (activeScenario.degradedNotice) {
      items.push({
        id: 'insights-degraded-read',
        tone: 'warning',
        title: activeScenario.degradedNotice.title,
        body: activeScenario.degradedNotice.body
      })
    }

    if (activeScenario.failureState) {
      items.push({
        id: 'insights-failure',
        tone: 'danger',
        title: activeScenario.failureState.title,
        body: activeScenario.failureState.explanation
      })
    }

    return items
  }, [activeScenario])

  useNewExperienceAlertRail(alertRailItems)

  function handleRefresh() {
    if (refreshTimerRef.current) {
      window.clearTimeout(refreshTimerRef.current)
    }
    setRefreshing(true)
    setRefreshMessage('')
    refreshTimerRef.current = window.setTimeout(() => {
      const nextStamp = new Date('2026-03-11T10:18:00Z')
      setRefreshStamp(nextStamp)
      setRefreshing(false)
      if (scenario === 'failure') {
        setRefreshMessage('Refresh retried the read but aggregate insights remain unavailable for the current scope.')
      } else if (scenario === 'degraded-read') {
        setRefreshMessage('Refresh completed. Core aggregates remain available, but one supporting breakdown is still degraded.')
      } else {
        setRefreshMessage('Insights refreshed for the selected window without changing the page hierarchy.')
      }
    }, 350)
  }

  const headerStateSummary = [
    { label: 'Time window', value: timeWindow },
    { label: 'Scope', value: currentScopeSummary },
    { label: 'Refresh', value: refreshing ? 'Refreshing' : `Ready at ${formatRefreshStamp(refreshStamp)}` }
  ]

  return (
    <div className="new-insights-page">
      <NewExperiencePageHeader
        title="Insights"
        objectIdentity="Recent delivery health and attention across DXCP"
        role={role}
        stateSummaryItems={headerStateSummary}
        primaryAction={{
          label: refreshing ? 'Refreshing...' : 'Refresh',
          state: 'available',
          onClick: handleRefresh,
          disabled: refreshing,
          description: 'Refresh the current Insights window without changing scope.'
        }}
      />

      <SectionCard className="new-insights-card">
        <div className="new-section-header">
          <div>
            <h3>Scope</h3>
            <p className="helper">Time window and scope stay page-level so the screen reads as one operational summary, not a set of competing local widgets.</p>
          </div>
        </div>

        <div className="new-insights-controls" aria-label="Insights scope">
          <label className="new-field">
            <span>Time window</span>
            <select value={timeWindow} onChange={(event) => setTimeWindow(event.target.value)}>
              {WINDOW_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="new-field">
            <span>Application</span>
            <select value={applicationScope} onChange={(event) => setApplicationScope(event.target.value)}>
              {APPLICATION_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="new-field">
            <span>Deployment Group</span>
            <select value={groupScope} onChange={(event) => setGroupScope(event.target.value)}>
              {GROUP_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="new-insights-scope-summary" aria-live="polite">
          {timeWindow} · {currentScopeSummary}
        </div>

        {refreshMessage ? (
          <NewStateBlock
            eyebrow="Refresh"
            title="Refresh update"
            tone={scenario === 'failure' ? 'danger' : scenario === 'degraded-read' ? 'warning' : 'neutral'}
          >
            {refreshMessage}
          </NewStateBlock>
        ) : null}
      </SectionCard>

      {activeScenario.failureState ? (
        <>
          <NewStateBlock
            eyebrow={activeScenario.failureState.stateBlock.eyebrow}
            title={activeScenario.failureState.stateBlock.title}
            tone="danger"
            actions={activeScenario.failureState.stateBlock.actions}
          >
            {activeScenario.failureState.stateBlock.body}
          </NewStateBlock>
        </>
      ) : (
        <>
          <SectionCard className="new-insights-card">
            <div className="new-section-header">
              <div>
                <h3>Delivery health</h3>
                <p className="helper">Aggregate summaries stay few, plain-language, and subordinate to the rest of the operational story.</p>
              </div>
            </div>

            <div className="new-insights-summary-strip">
              {activeScenario.summary.map((item) => (
                <article key={item.label} className="new-insights-summary-item">
                  <span className="new-page-state-label">{item.label}</span>
                  <strong>{item.value}</strong>
                  <span>{item.comparison}</span>
                  <p>{item.note}</p>
                </article>
              ))}
            </div>
          </SectionCard>

          {activeScenario.emptyState ? (
            <NewStateBlock
              eyebrow={activeScenario.emptyState.eyebrow}
              title={activeScenario.emptyState.title}
              actions={activeScenario.emptyState.actions}
            >
              {activeScenario.emptyState.body}
            </NewStateBlock>
          ) : (
            <>
              <SectionCard className="new-insights-card">
                <div className="new-section-header">
                  <div>
                    <h3>Trend</h3>
                    <p className="helper">Trend stays ahead of breakdown so the page answers whether delivery health is changing before explaining why.</p>
                  </div>
                </div>

                <div className="new-insights-trend-grid">
                  {activeScenario.trendSections.map((section) => (
                    <InsightTrendCard key={section.title} section={section} returnTo={returnTo} />
                  ))}
                </div>
              </SectionCard>

              <SectionCard className="new-insights-card">
                <div className="new-section-header">
                  <div>
                    <h3>Breakdown</h3>
                    <p className="helper">Breakdowns explain the visible change and hand off cleanly into object-level routes.</p>
                  </div>
                </div>

                <div className="new-insights-breakdown-grid">
                  {activeScenario.breakdownSections.map((section) => (
                    <InsightBreakdownCard key={section.title} section={section} returnTo={returnTo} />
                  ))}
                </div>
              </SectionCard>

              <SectionCard className="new-insights-card">
                <div className="new-section-header">
                  <div>
                    <h3>Attention</h3>
                    <p className="helper">Attention stays short and explanatory so Insights does not become an alert console.</p>
                  </div>
                </div>

                <div className="new-insights-attention-list">
                  {activeScenario.attentionItems.map((item) => (
                    <article key={item.title} className="new-insights-attention-item">
                      <div>
                        <strong>{item.title}</strong>
                        <p>{item.detail}</p>
                      </div>
                      <Link className="link" to={item.to} state={{ returnTo }}>
                        Open next
                      </Link>
                    </article>
                  ))}
                </div>
              </SectionCard>

              <SectionCard className="new-insights-card">
                <div className="new-section-header">
                  <div>
                    <h3>Recent notable activity</h3>
                    <p className="helper">Recent notable activity remains a bounded queue of next reads, not a long event feed.</p>
                  </div>
                </div>

                <div className="new-insights-activity-list">
                  {activeScenario.notableActivity.map((item) => (
                    <article key={item.statement} className="new-insights-activity-item">
                      <div>
                        <strong>{item.statement}</strong>
                        <p>{item.detail}</p>
                      </div>
                      <Link className="link secondary" to={item.to} state={{ returnTo }}>
                        Inspect deployment
                      </Link>
                    </article>
                  ))}
                </div>
              </SectionCard>
            </>
          )}
        </>
      )}
    </div>
  )
}
