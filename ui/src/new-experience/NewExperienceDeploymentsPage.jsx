import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import SectionCard from '../components/SectionCard.jsx'
import NewExperiencePageHeader from './NewExperiencePageHeader.jsx'
import { NewExplanation, NewStateBlock } from './NewExperienceStatePrimitives.jsx'
import { useNewExperienceAlertRail } from './NewExperienceShell.jsx'
import { loadDeploymentsBrowseData } from './newExperienceDeploymentsData.js'

const INITIAL_VISIBLE_ROWS = 8

function buildReturnTo(location, resultsSummary) {
  const query = location.search || ''
  return {
    to: `/new/deployments${query}`,
    label: 'Back to Deployments',
    scopeSummary: resultsSummary
  }
}

function buildResultsSummary(rows, serviceFilter, outcomeFilter) {
  const parts = []
  parts.push(`${rows.length} deployment${rows.length === 1 ? '' : 's'} visible`)
  parts.push(serviceFilter ? `for ${serviceFilter}` : 'across accessible applications')
  if (outcomeFilter) {
    parts.push(`with outcome ${outcomeFilter}`)
  }
  return `${parts.join(' ')}. Deployment history stays bounded so browse remains a handoff into deployment detail, not the dominant product surface.`
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

export default function NewExperienceDeploymentsPage({ role = 'UNKNOWN', api }) {
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const [browseState, setBrowseState] = useState({
    kind: 'loading',
    rows: [],
    services: [],
    degradedReasons: [],
    errorMessage: ''
  })
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_ROWS)
  const serviceFilter = searchParams.get('service') || ''
  const outcomeFilter = searchParams.get('outcome') || ''

  const refreshBrowse = useCallback(
    async (options = {}) => {
      setBrowseState((current) => ({
        kind: current.kind === 'ready' || current.kind === 'degraded' || current.kind === 'empty' ? 'refreshing' : 'loading',
        rows: current.rows || [],
        services: current.services || [],
        degradedReasons: [],
        errorMessage: ''
      }))
      const nextState = await loadDeploymentsBrowseData(api, options)
      setBrowseState(nextState)
    },
    [api]
  )

  useEffect(() => {
    let active = true
    const load = async () => {
      setBrowseState({ kind: 'loading', rows: [], services: [], degradedReasons: [], errorMessage: '' })
      const nextState = await loadDeploymentsBrowseData(api)
      if (active) {
        setBrowseState(nextState)
      }
    }
    load()
    return () => {
      active = false
    }
  }, [api])

  useEffect(() => {
    setVisibleCount(INITIAL_VISIBLE_ROWS)
  }, [serviceFilter, outcomeFilter])

  const services = browseState.services || []
  const rows = useMemo(() => browseState.rows || [], [browseState.rows])
  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      if (serviceFilter && row.application !== serviceFilter) return false
      if (outcomeFilter && row.status !== outcomeFilter) return false
      return true
    })
  }, [outcomeFilter, rows, serviceFilter])
  const visibleRows = filteredRows.slice(0, visibleCount)
  const isLoading = browseState.kind === 'loading'
  const isRefreshing = browseState.kind === 'refreshing'
  const isFailure = browseState.kind === 'failure'
  const isDegraded = browseState.kind === 'degraded'
  const hasRows = rows.length > 0
  const hasNoResults = hasRows && filteredRows.length === 0
  const resultsSummary = buildResultsSummary(filteredRows, serviceFilter, outcomeFilter)
  const returnTo = buildReturnTo(location, resultsSummary)

  const alertRailItems = useMemo(() => {
    if (isFailure) {
      return [
        {
          id: 'deployments-failure',
          tone: 'danger',
          title: 'Deployment history could not be loaded',
          body: browseState.errorMessage || 'DXCP could not load deployment history right now. Refresh to try again.'
        }
      ]
    }
    if (isDegraded) {
      return [
        {
          id: 'deployments-degraded',
          tone: 'warning',
          title: 'Supporting reads are degraded',
          body:
            'Visible deployment records remain available for browse and handoff, but one or more supporting reads could not be refreshed.'
        }
      ]
    }
    return []
  }, [browseState.errorMessage, isDegraded, isFailure])

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
    <div className="new-deployments-page">
      <NewExperiencePageHeader
        title="Deployments"
        objectIdentity="Recent deployment activity across accessible applications"
        role={role}
        stateSummaryItems={[
          {
            label: 'Browse state',
            value:
              isLoading
                ? 'Loading'
                : isFailure
                  ? 'Unavailable'
                  : hasNoResults
                    ? 'No results'
                    : browseState.kind === 'empty'
                      ? 'Empty'
                      : isDegraded
                        ? 'Degraded read'
                        : 'Recent activity'
          },
          { label: 'Visible now', value: `${filteredRows.length}` },
          { label: 'Application scope', value: serviceFilter || 'All applications' }
        ]}
        primaryAction={{
          label: isRefreshing ? 'Refreshing...' : 'Refresh',
          state: 'available',
          onClick: () => refreshBrowse({ bypassCache: true }),
          disabled: isLoading || isRefreshing,
          description: 'Refresh recent deployment history for accessible applications.'
        }}
        secondaryActions={[
          {
            label: 'Open Applications',
            to: '/new/applications',
            description: 'Return to the application chooser.'
          }
        ]}
        actionNote="Deployment browse stays support-first. Open a deployment record when you need the full outcome and timeline narrative."
      />

      <SectionCard className="new-deployments-card">
        <div className="new-deployments-controls" aria-label="Deployment filters">
          <label className="new-field" htmlFor="new-deployments-service">
            <span>Application</span>
            <select
              id="new-deployments-service"
              value={serviceFilter}
              onChange={(event) => updateFilter('service', event.target.value)}
              disabled={isLoading || isFailure}
            >
              <option value="">All applications</option>
              {services.map((service) => (
                <option key={service.name} value={service.name}>
                  {service.name}
                </option>
              ))}
            </select>
          </label>

          <label className="new-field" htmlFor="new-deployments-outcome">
            <span>Outcome</span>
            <select
              id="new-deployments-outcome"
              value={outcomeFilter}
              onChange={(event) => updateFilter('outcome', event.target.value)}
              disabled={isLoading || isFailure}
            >
              <option value="">All outcomes</option>
              <option value="In progress">In progress</option>
              <option value="Succeeded">Succeeded</option>
              <option value="Failed">Failed</option>
              <option value="Rolled back">Rolled back</option>
              <option value="Canceled">Canceled</option>
            </select>
          </label>
        </div>

        <div className="new-deployments-results-summary" aria-live="polite">
          {isLoading
            ? 'Loading recent deployment history so this route stays anchored to real deployment records.'
            : isFailure
              ? 'Deployment history could not be read. Refresh to try again, or continue from the application route.'
              : hasNoResults
                ? 'No visible deployment records match the current scope. Adjust the filters without leaving the deployments route.'
                : browseState.kind === 'empty'
                  ? 'No accessible deployment history is available yet.'
                  : resultsSummary}
        </div>

        <div className="new-section-header new-collection-header">
          <div>
            <h3>Recent deployment activity</h3>
            <p className="helper">
              Row reading stays primary. Supporting filters remain restrained so browse hands off cleanly into deployment detail.
            </p>
          </div>
        </div>

        {isDegraded ? (
          <NewExplanation title="Supporting reads are degraded" tone="warning">
            {browseState.degradedReasons.join(' ')}
          </NewExplanation>
        ) : null}

        {isLoading ? (
          <NewStateBlock eyebrow="Loading" title="Loading deployment history">
            DXCP is loading recent deployment records for the applications available on this route.
          </NewStateBlock>
        ) : isFailure ? (
          <NewStateBlock
            eyebrow="Failure"
            title="Deployment history could not be loaded"
            tone="danger"
            actions={[
              { label: 'Refresh', onClick: () => refreshBrowse({ bypassCache: true }) },
              { label: 'Open Applications', to: '/new/applications', secondary: true }
            ]}
          >
            {browseState.errorMessage || 'DXCP could not load deployment history right now. Refresh to try again.'}
          </NewStateBlock>
        ) : browseState.kind === 'empty' ? (
          <NewStateBlock
            eyebrow="Empty"
            title="No deployments recorded yet"
            actions={[
              { label: 'Open Applications', to: '/new/applications' },
              { label: 'Open Legacy', to: '/deployments', secondary: true }
            ]}
          >
            No deployment records are available from the accessible application set yet. Open an application to begin from object context when the first deployment is ready.
          </NewStateBlock>
        ) : hasNoResults ? (
          <NewStateBlock
            eyebrow="No results"
            title="No deployments match this scope"
            tone="warning"
            actions={[
              {
                label: 'Clear filters',
                onClick: () => {
                  setSearchParams(new URLSearchParams())
                }
              },
              { label: 'Open Applications', to: '/new/applications', secondary: true }
            ]}
          >
            Deployment records are available on this route, but none match the current application and outcome scope.
          </NewStateBlock>
        ) : (
          <>
            <div className="new-deployments-list" aria-label="Deployment collection">
              {visibleRows.map((row) => (
                <DeploymentRow key={row.id} row={row} returnTo={returnTo} />
              ))}
            </div>

            {filteredRows.length > visibleRows.length ? (
              <div className="new-deployments-footer">
                <button className="button secondary" type="button" onClick={() => setVisibleCount((count) => count + INITIAL_VISIBLE_ROWS)}>
                  Load older deployments
                </button>
                <span className="helper">
                  Older history stays deliberate so recent deployment activity remains the default browse posture.
                </span>
              </div>
            ) : null}
          </>
        )}
      </SectionCard>
    </div>
  )
}
