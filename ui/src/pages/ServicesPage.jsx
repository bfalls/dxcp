import React from 'react'
import PageHeader from '../components/PageHeader.jsx'

export default function ServicesPage({
  mode,
  servicesView,
  servicesViewLoading,
  servicesViewError,
  loadServicesList,
  setServiceDetailTab,
  navigateToService,
  navigateToServices,
  navigateToDeploy,
  statusClass,
  formatTime,
  serviceDetailName,
  serviceDetailTab,
  serviceDetailError,
  serviceDetailLoading,
  serviceDetailRunning,
  serviceDetailLatest,
  serviceDetailGroup,
  serviceDetailFailures,
  serviceDetailHistory,
  serviceDetailStatus,
  backstageEntityRef,
  backstageEntityUrl,
  isPlatformAdmin,
  openDeployment,
  deploymentKindLabel,
  shortId,
  outcomeTone,
  outcomeLabel,
  outcomeDisplayLabel,
  resolveDeploymentKind,
  resolveOutcome,
  getRecipeDisplay,
  getRollbackIdFor,
  renderFailures,
  setService
}) {
  if (mode === 'list') {
    return (
      <div className="shell">
        <div className="page-header-zone">
          <PageHeader
            title="Services"
            subtitle="Deployable services and their latest delivery status."
            actions={
              <button className="button secondary" onClick={loadServicesList} disabled={servicesViewLoading}>
                {servicesViewLoading ? 'Refreshing...' : 'Refresh'}
              </button>
            }
          />
        </div>
        <div className="card" style={{ gridColumn: '1 / -1' }}>
          <h2>Delivery control plane</h2>
          <div className="helper space-8">
            DXCP is the source of truth for delivery intent and status. It applies platform guardrails by default.
          </div>
          <div className="helper space-8">
            What you can do depends on your role. Services shown here are allowlisted and scoped by policy.
          </div>
        </div>
        <div className="card" style={{ gridColumn: '1 / -1' }}>
          {servicesViewError && <div className="helper space-8">{servicesViewError}</div>}
          {servicesViewLoading && <div className="helper space-8">Loading services...</div>}
          {!servicesViewLoading && servicesView.length === 0 && (
            <div className="helper space-8">
              No deployable services available. Services are allowlisted by delivery group policy.
            </div>
          )}
          {servicesView.length > 0 && (
            <div className="table space-12">
              <div className="table-row header">
                <div>Service</div>
                <div>Delivery group</div>
                <div>Latest version</div>
                <div>Latest state</div>
                <div>Updated</div>
              </div>
              {servicesView.map((row) => (
                <button
                  key={row.name}
                  className="table-row button-row"
                  onClick={() => {
                    navigateToService(row.name)
                  }}
                >
                  <div>{row.name}</div>
                  <div>{row.deliveryGroup}</div>
                  <div>{row.latestVersion}</div>
                  <div><span className={statusClass(row.latestState)}>{row.latestState}</span></div>
                  <div>{row.updatedAt ? formatTime(row.updatedAt) : '-'}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="shell">
      <div className="page-header-zone">
        <PageHeader
          title="Service detail"
          subtitle={serviceDetailName || 'Unknown service'}
          actions={
            <button className="button secondary" onClick={navigateToServices}>
              Back to services
            </button>
          }
        />
        <div className="tabs">
          {['overview', 'deploy', 'history', 'failures', 'insights'].map((tab) => (
            <button
              key={tab}
              className={serviceDetailTab === tab ? 'active' : ''}
              onClick={() => setServiceDetailTab(tab)}
            >
              {tab[0].toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {serviceDetailError && (
        <div className="card" style={{ gridColumn: '1 / -1' }}>
          {serviceDetailError}
        </div>
      )}

      {serviceDetailLoading && (
        <div className="card" style={{ gridColumn: '1 / -1' }}>
          Loading service detail...
        </div>
      )}

      {!serviceDetailLoading && serviceDetailTab === 'overview' && (
        <>
          <div className="card">
            <h2>What is running</h2>
            {serviceDetailRunning ? (
              <div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <span className="badge info">Source: Authoritative</span>
                <span className="badge neutral">
                  Operation: {deploymentKindLabel(serviceDetailRunning.deploymentKind)}
                </span>
                </div>
                <p className="space-8">
                  Version: <strong>{serviceDetailRunning.version || '-'}</strong>
                </p>
                <p>Environment: {serviceDetailRunning.environment || 'sandbox'}</p>
                <p>
                  Established by: {deploymentKindLabel(serviceDetailRunning.deploymentKind)}{' '}
                  {serviceDetailRunning.deploymentId ? (
                    <>
                      <span className="helper">deployment {shortId(serviceDetailRunning.deploymentId)}</span>
                      <button
                        className="button secondary"
                        style={{ marginLeft: '8px' }}
                        onClick={() => openDeployment({ id: serviceDetailRunning.deploymentId })}
                      >
                        View deployment
                      </button>
                    </>
                  ) : (
                    ''
                  )}
                </p>
                {serviceDetailRunning.derivedAt && (
                  <p>Derived: {formatTime(serviceDetailRunning.derivedAt)}</p>
                )}
                <div className="helper space-8">
                  Derived from DXCP deployment records.
                </div>
              </div>
            ) : (
              <div className="helper">No running version recorded yet.</div>
            )}
          </div>
          <div className="card">
            <h2>Latest delivery status</h2>
            {serviceDetailLatest ? (
              <div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <span className={`badge ${outcomeTone(serviceDetailLatest.outcome, serviceDetailLatest.state)}`}>
                    Outcome: {outcomeLabel(serviceDetailLatest.outcome, serviceDetailLatest.state)}
                  </span>
                  <span className="badge neutral">
                    Operation: {deploymentKindLabel(serviceDetailLatest.deploymentKind, serviceDetailLatest.rollbackOf)}
                  </span>
                  <span className="badge neutral">State: {serviceDetailLatest.state}</span>
                </div>
                <p>Version: {serviceDetailLatest.version || '-'}</p>
                <p>Updated: {formatTime(serviceDetailLatest.updatedAt || serviceDetailLatest.createdAt)}</p>
                {serviceDetailLatest.rollbackOf && (
                  <p>Rollback of: {serviceDetailLatest.rollbackOf}</p>
                )}
                <div className="links space-8">
                  <button
                    className="button secondary"
                    onClick={() => openDeployment({ id: serviceDetailLatest.id })}
                  >
                    Open deployment detail
                  </button>
                  {isPlatformAdmin && serviceDetailLatest.engineExecutionUrl && (
                    <a
                      className="link"
                      href={serviceDetailLatest.engineExecutionUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Execution detail
                    </a>
                  )}
                </div>
              </div>
            ) : (
              <div className="helper">No deployments recorded yet.</div>
            )}
          </div>
          <div className="card">
            <h2>Delivery group</h2>
            {serviceDetailGroup ? (
              <>
              <p>{serviceDetailGroup.name}</p>
              <div className="helper">Owner: {serviceDetailGroup.owner || 'Unassigned'}</div>
              <div className="guardrails space-12">
                <div className="helper space-4">Guardrails</div>
                <div className="list">
                  <div className="list-item">
                    <div>Max concurrent deployments</div>
                    <div>{serviceDetailGroup.guardrails?.max_concurrent_deployments || '-'}</div>
                  </div>
                    <div className="list-item">
                      <div>Daily deploy quota</div>
                      <div>{serviceDetailGroup.guardrails?.daily_deploy_quota || '-'}</div>
                    </div>
                    <div className="list-item">
                      <div>Daily rollback quota</div>
                      <div>{serviceDetailGroup.guardrails?.daily_rollback_quota || '-'}</div>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="helper">Service is not assigned to a delivery group.</div>
            )}
          </div>
          <div className="card">
            <h2>Integrations</h2>
            {!backstageEntityRef && !backstageEntityUrl && (
              <div className="helper">No integrations configured for this service.</div>
            )}
            {(backstageEntityRef || backstageEntityUrl) && (
              <div className="list">
                {backstageEntityRef && (
                  <div className="list-item admin-detail">
                    <div>Backstage entity</div>
                    <div>{backstageEntityRef}</div>
                  </div>
                )}
                <div className="list-item admin-detail">
                  <div>Backstage</div>
                  <div>
                    {backstageEntityUrl ? (
                      <a className="link" href={backstageEntityUrl} target="_blank" rel="noreferrer">
                        Open in Backstage
                      </a>
                    ) : (
                      'Not linked'
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {!serviceDetailLoading && serviceDetailTab === 'deploy' && (
        <div className="card" style={{ gridColumn: '1 / -1' }}>
          <h2>Deploy</h2>
          <div className="helper">
            Deployment intent stays in the Deploy view for now.
          </div>
          <button
            className="button secondary space-12"
            onClick={() => {
              if (serviceDetailName) setService(serviceDetailName)
              navigateToDeploy()
            }}
          >
            Go to Deploy
          </button>
        </div>
      )}

      {!serviceDetailLoading && serviceDetailTab === 'history' && (
        <div className="card" style={{ gridColumn: '1 / -1' }}>
          <h2>Deployment history</h2>
          {serviceDetailHistory.length === 0 && <div className="helper">No deployments yet.</div>}
          {serviceDetailHistory.length > 0 && (
            <div className="table space-12">
              <div className="table-row header history">
                <div>Outcome</div>
                <div>State</div>
                <div>Version</div>
                <div>Recipe</div>
                <div>Operation</div>
                <div>Created</div>
                <div>Deployment</div>
              </div>
              {serviceDetailHistory.map((item) => {
                const rollbackId = getRollbackIdFor(item.id)
                return (
                  <div className="table-row history" key={item.id}>
                    <div>
                      <span className={`badge ${outcomeTone(item.outcome, item.state)}`}>
                        {outcomeDisplayLabel(item.outcome, item.state, item.deploymentKind, item.rollbackOf)}
                      </span>
                        {resolveDeploymentKind(item.deploymentKind, item.rollbackOf) === 'ROLL_FORWARD' &&
                          resolveOutcome(item.outcome, item.state) === 'ROLLED_BACK' && (
                          <div className="helper space-4">
                            Auto-rollback recorded as a separate rollback deployment.
                            {rollbackId && (
                              <button
                                className="button secondary"
                                style={{ marginLeft: '8px' }}
                                onClick={() => openDeployment({ id: rollbackId })}
                              >
                                View rollback {shortId(rollbackId)}
                              </button>
                            )}
                          </div>
                        )}
                    </div>
                    <div><span className={statusClass(item.state)}>{item.state}</span></div>
                    <div>{item.version || '-'}</div>
                    <div>{getRecipeDisplay(item.recipeId, item.recipeRevision)}</div>
                    <div>
                      <span className="badge neutral">
                        {deploymentKindLabel(item.deploymentKind, item.rollbackOf)}
                      </span>
                      {item.rollbackOf && (
                        <div className="helper space-4">
                          of {item.rollbackOf}
                        </div>
                      )}
                    </div>
                    <div>{formatTime(item.createdAt)}</div>
                    <div>
                      <button className="button secondary" onClick={() => openDeployment({ id: item.id })}>
                        Open detail
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {!serviceDetailLoading && serviceDetailTab === 'failures' && (
        <div className="card" style={{ gridColumn: '1 / -1' }}>
          <h2>Latest failures</h2>
          {renderFailures(serviceDetailFailures, serviceDetailStatus?.latest?.engineExecutionUrl)}
        </div>
      )}

      {!serviceDetailLoading && serviceDetailTab === 'insights' && (
        <div className="card" style={{ gridColumn: '1 / -1' }}>
          <h2>Insights</h2>
          <div className="helper">
            Service-level insights are not available yet. Use the Insights view for system-wide trends.
          </div>
        </div>
      )}
    </div>
  )
}
