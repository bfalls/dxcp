import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import SectionCard from '../components/SectionCard.jsx'
import NewExperiencePageHeader from './NewExperiencePageHeader.jsx'
import { NewExplanation, NewStateBlock } from './NewExperienceStatePrimitives.jsx'
import { useNewExperienceAlertRail } from './NewExperienceShell.jsx'
import { loadInsightsData } from './newExperienceInsightsData.js'

const WINDOW_OPTIONS = [7, 14, 30]

function buildReturnTo(location, scopeSummary) {
  const query = location.search || ''
  return {
    to: `/new/insights${query}`,
    label: 'Back to Insights',
    scopeSummary
  }
}

function buildDeploymentsLink(filters) {
  const params = new URLSearchParams()
  if (filters.service) params.set('service', filters.service)
  return `/new/deployments${params.toString() ? `?${params.toString()}` : ''}`
}

function InsightsBreakdownCard({ section, returnTo, filters }) {
  return (
    <article className="new-insights-breakdown-card">
      <div className="new-insights-block-header">
        <h4>{section.title}</h4>
      </div>
      <p className="helper">{section.intro}</p>
      <div className="new-insights-breakdown-list">
        {section.rows.map((row) => (
          <div key={row.label} className="new-insights-breakdown-row">
            <div className="new-insights-breakdown-copy">
              <strong>{row.label}</strong>
              <span>{row.value} visible in the selected scope.</span>
            </div>
            <span className="new-insights-breakdown-value">{row.value}</span>
            <Link className="link secondary" to={buildDeploymentsLink(filters)} state={{ returnTo }}>
              View
            </Link>
          </div>
        ))}
      </div>
    </article>
  )
}

export default function NewExperienceInsightsPage({ role = 'UNKNOWN', api }) {
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const [insightsState, setInsightsState] = useState({
    kind: 'loading',
    errorMessage: '',
    viewModel: null
  })

  const filters = useMemo(
    () => ({
      windowDays: Number(searchParams.get('windowDays') || '7'),
      service: searchParams.get('service') || '',
      groupId: searchParams.get('groupId') || ''
    }),
    [searchParams]
  )

  const refreshInsights = useCallback(
    async (options = {}) => {
      setInsightsState((current) => ({
        kind: current.kind === 'ready' || current.kind === 'degraded' || current.kind === 'empty' ? 'refreshing' : 'loading',
        errorMessage: '',
        viewModel: current.viewModel
      }))
      const nextState = await loadInsightsData(api, filters, options)
      setInsightsState(nextState)
    },
    [api, filters]
  )

  useEffect(() => {
    let active = true
    const load = async () => {
      setInsightsState({ kind: 'loading', errorMessage: '', viewModel: null })
      const nextState = await loadInsightsData(api, filters)
      if (active) {
        setInsightsState(nextState)
      }
    }
    load()
    return () => {
      active = false
    }
  }, [api, filters])

  const isLoading = insightsState.kind === 'loading'
  const isRefreshing = insightsState.kind === 'refreshing'
  const isFailure = insightsState.kind === 'failure'
  const isDegraded = insightsState.kind === 'degraded'
  const isEmpty = insightsState.kind === 'empty'
  const viewModel = insightsState.viewModel
  const scopeValue =
    filters.service ||
    (filters.groupId ? viewModel?.filters?.groupLabels?.get(filters.groupId) || filters.groupId : 'All visible delivery scope')
  const scopeText = `${filters.windowDays} days · ${scopeValue}`
  const returnTo = useMemo(() => buildReturnTo(location, scopeText), [location, scopeText])

  const alertRailItems = useMemo(() => {
    if (isFailure) {
      return [
        {
          id: 'insights-failure',
          tone: 'danger',
          title: 'Insights could not be loaded',
          body: insightsState.errorMessage || 'DXCP could not refresh the selected Insights scope. Refresh to try again.'
        }
      ]
    }
    if (isDegraded) {
      return [
        {
          id: 'insights-degraded',
          tone: 'warning',
          title: 'Supporting reads are degraded',
          body: 'Aggregate delivery reading remains available, but one or more supporting reads could not be refreshed.'
        }
      ]
    }
    return []
  }, [insightsState.errorMessage, isDegraded, isFailure])

  useNewExperienceAlertRail(alertRailItems)

  const updateFilter = (name, value) => {
    const nextSearchParams = new URLSearchParams(searchParams)
    if (value) {
      nextSearchParams.set(name, value)
    } else {
      nextSearchParams.delete(name)
    }
    setSearchParams(nextSearchParams)
  }

  return (
    <div className="new-insights-page">
      <NewExperiencePageHeader
        title="Insights"
        objectIdentity="Recent delivery health and attention across DXCP"
        role={role}
        stateSummaryItems={[
          { label: 'Time window', value: `${filters.windowDays} days` },
          { label: 'Scope', value: scopeValue },
          {
            label: 'Route state',
            value:
              isLoading
                ? 'Loading'
                : isFailure
                  ? 'Unavailable'
                  : isEmpty
                    ? 'Empty'
                    : isDegraded
                      ? 'Degraded read'
                      : 'Aggregate reading'
          }
        ]}
        primaryAction={{
          label: isRefreshing ? 'Refreshing...' : 'Refresh',
          state: 'available',
          onClick: () => refreshInsights({ bypassCache: true }),
          disabled: isLoading || isRefreshing,
          description: 'Refresh the current Insights scope without changing page hierarchy.'
        }}
        actionNote="Insights stays restrained and aggregate-first. Use drill-in links when you need deployment or application object detail."
      />

      <SectionCard className="new-insights-card">
        <div className="new-section-header">
          <div>
            <h3>Scope</h3>
            <p className="helper">Time window and scope stay page-level so the route reads as one aggregate delivery summary, not a dashboard wall.</p>
          </div>
        </div>

        <div className="new-insights-controls" aria-label="Insights scope">
          <label className="new-field" htmlFor="new-insights-window">
            <span>Time window</span>
            <select
              id="new-insights-window"
              value={String(filters.windowDays)}
              onChange={(event) => updateFilter('windowDays', event.target.value)}
              disabled={isLoading || isFailure}
            >
              {WINDOW_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  Last {value} days
                </option>
              ))}
            </select>
          </label>

          <label className="new-field" htmlFor="new-insights-service">
            <span>Application</span>
            <select
              id="new-insights-service"
              value={filters.service}
              onChange={(event) => updateFilter('service', event.target.value)}
              disabled={isLoading || isFailure}
            >
              <option value="">All applications</option>
              {(viewModel?.filters?.serviceOptions || []).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="new-field" htmlFor="new-insights-group">
            <span>Deployment Group</span>
            <select
              id="new-insights-group"
              value={filters.groupId}
              onChange={(event) => updateFilter('groupId', event.target.value)}
              disabled={isLoading || isFailure}
            >
              <option value="">All Deployment Groups</option>
              {(viewModel?.filters?.groupOptions || []).map((option) => (
                <option key={option.value} value={option.value}>
                  {viewModel?.filters?.groupLabels?.get(option.value) || option.value}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="new-insights-scope-summary" aria-live="polite">
          {scopeText}
        </div>
      </SectionCard>

      {isFailure ? (
        <NewStateBlock
          eyebrow="Read failure"
          title="Aggregate delivery reading is unavailable right now"
          tone="danger"
          actions={[
            { label: 'Refresh', onClick: () => refreshInsights({ bypassCache: true }) },
            { label: 'Open Deployments', to: '/new/deployments', secondary: true }
          ]}
        >
          {insightsState.errorMessage || 'DXCP could not refresh the selected Insights scope. Refresh to try again.'}
        </NewStateBlock>
      ) : (
        <>
          <SectionCard className="new-insights-card">
            <div className="new-section-header">
              <div>
                <h3>Delivery health</h3>
                <p className="helper">Aggregate summaries stay few, plain-language, and subordinate to the rest of the operational story.</p>
              </div>
            </div>

            {isLoading ? (
              <NewStateBlock eyebrow="Loading" title="Loading delivery health">
                DXCP is loading aggregate delivery reading for the selected Insights scope.
              </NewStateBlock>
            ) : (
              <div className="new-insights-summary-strip">
                {(viewModel?.summary || []).map((item) => (
                  <article key={item.label} className="new-insights-summary-item">
                    <span className="new-page-state-label">{item.label}</span>
                    <strong>{item.value}</strong>
                    <p>{item.note}</p>
                  </article>
                ))}
              </div>
            )}
          </SectionCard>

          {isDegraded ? (
            <NewExplanation title="Supporting reads are degraded" tone="warning">
              {(viewModel?.degradedReasons || []).join(' ')}
            </NewExplanation>
          ) : null}

          {isEmpty ? (
            <NewStateBlock
              eyebrow="Empty"
              title={viewModel?.emptyState?.title || 'No deployments in this time range'}
              actions={[
                {
                  label: 'Clear scope',
                  onClick: () => setSearchParams(new URLSearchParams({ windowDays: String(filters.windowDays) }))
                },
                { label: 'Open Applications', to: '/new/applications', secondary: true }
              ]}
            >
              {viewModel?.emptyState?.body}
            </NewStateBlock>
          ) : (
            <>
              {(viewModel?.breakdowns || []).length > 0 ? (
                <SectionCard className="new-insights-card">
                  <div className="new-section-header">
                    <div>
                      <h3>Breakdown</h3>
                      <p className="helper">Breakdowns explain the visible aggregate reading and hand off cleanly into deployment browse.</p>
                    </div>
                  </div>

                  <div className="new-insights-breakdown-grid">
                    {(viewModel?.breakdowns || []).map((section) => (
                      <InsightsBreakdownCard key={section.title} section={section} returnTo={returnTo} filters={filters} />
                    ))}
                  </div>
                </SectionCard>
              ) : null}

              {(viewModel?.attentionItems || []).length > 0 ? (
                <SectionCard className="new-insights-card">
                  <div className="new-section-header">
                    <div>
                      <h3>Attention</h3>
                      <p className="helper">Attention stays short and explanatory so Insights does not become an alert console.</p>
                    </div>
                  </div>

                  <div className="new-insights-attention-list">
                    {(viewModel?.attentionItems || []).map((item) => (
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
              ) : null}
            </>
          )}
        </>
      )}
    </div>
  )
}
