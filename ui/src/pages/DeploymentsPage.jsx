import React from 'react'
import PageHeader from '../components/PageHeader.jsx'

export default function DeploymentsPage({ deployments, refreshDeployments, openDeployment, statusClass, formatTime }) {
  return (
    <div className="shell">
      <div className="page-header-zone">
        <PageHeader
          title="Recent deployments"
          actions={
            <button className="button secondary" onClick={refreshDeployments}>Refresh</button>
          }
        />
      </div>
      <div className="card" style={{ gridColumn: '1 / -1' }}>
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
      </div>
    </div>
  )
}
