import React from 'react'
import PageHeader from '../components/PageHeader.jsx'
import SectionCard from '../components/SectionCard.jsx'

export default function DeploymentsPage({
  deployments,
  refreshDeployments,
  openDeployment,
  statusClass,
  formatTime,
  environmentLabel,
  environmentNotice,
  headerMeta
}) {
  return (
    <div className="shell">
      <div className="page-header-zone">
        <PageHeader
          title="Recent deployments"
          subtitle={`Environment: ${environmentLabel}`}
          meta={headerMeta}
          actions={
            <button className="button secondary" onClick={() => refreshDeployments({ bypassCache: true })}>
              Refresh
            </button>
          }
        />
      </div>
      <SectionCard style={{ gridColumn: '1 / -1' }}>
        {environmentNotice && <div className="helper space-8">{environmentNotice}</div>}
        {/* Stable E2E selectors for deployment history list */}
        <div className="list" data-testid="deployment-list">
          {deployments.length === 0 && <div className="helper">No deployments yet.</div>}
          {deployments.map((d) => (
            <div className="list-item" data-testid="deployment-item" key={d.id}>
              <div className={statusClass(d.state)}>{d.state}</div>
              <div>{d.service}</div>
              <div>{d.version}</div>
              <div>{formatTime(d.createdAt)}</div>
              <button className="button secondary" onClick={() => openDeployment(d)}>
                Details
              </button>
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  )
}
