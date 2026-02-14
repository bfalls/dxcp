import React from 'react'
import InfoTooltip from '../components/InfoTooltip.jsx'
import PageHeader from '../components/PageHeader.jsx'
import SectionCard from '../components/SectionCard.jsx'

export default function ServicesPage({
  mode,
  servicesView,
  servicesViewLoading,
  loadServicesList,
  setServiceDetailTab,
  navigateToService,
  navigateToServices,
  navigateToDeploy,
  statusClass,
  formatTime,
  serviceDetailName,
  serviceDetailTab,
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
  setService,
  listHeaderMeta,
  detailHeaderMeta,
  environmentLabel,
  environmentReady,
  environmentNotice,
  servicePromotionCandidate,
  promotionChangeSummary,
  setPromotionChangeSummary,
  promotionStep,
  promotionValidation,
  promotionSubmitting,
  promotionInlineError,
  handleReviewPromotion,
  handleConfirmPromotion,
  handleBackToPromotionEdit
}) {
  const resolveLatestStatusLabel = (latest) => {
    if (!latest) return 'In progress'
    const normalizedState = String(latest.state || '').toUpperCase()
    const stateMap = {
      PENDING: 'QUEUED',
      ACTIVE: 'RUNNING',
      IN_PROGRESS: 'RUNNING',
      QUEUED: 'QUEUED',
      RUNNING: 'RUNNING'
    }
    const resolvedOutcome = resolveOutcome(latest.outcome, latest.state)
    const statusKey = stateMap[normalizedState] || resolvedOutcome || normalizedState
    const labelMap = {
      SUCCEEDED: 'Succeeded',
      FAILED: 'Failed',
      CANCELED: 'Canceled',
      ROLLED_BACK: 'Rolled back',
      RUNNING: 'Running',
      QUEUED: 'Queued'
    }
    return labelMap[statusKey] || (statusKey ? statusKey.replace(/_/g, ' ') : 'In progress')
  }

  const headerMeta = mode === 'list' ? listHeaderMeta : detailHeaderMeta
  const listSubtitle = environmentReady
    ? `Deployable services and their latest delivery status in ${environmentLabel}.`
    : environmentNotice || 'Select an environment to see latest delivery status.'
  const runningEnvironment = serviceDetailRunning?.environment || environmentLabel || '-'
  const promotionReasonMap = {
    PROMOTION_AT_HIGHEST_ENVIRONMENT: 'Already at the highest configured environment.',
    PROMOTION_NO_SUCCESSFUL_SOURCE_VERSION: 'No successful source version is eligible to promote.',
    PROMOTION_SOURCE_NOT_CONFIGURED: 'Source environment is not configured for promotion order.',
    ENVIRONMENT_NOT_ALLOWED: 'Target environment is not allowed by delivery group policy.',
    ENVIRONMENT_DISABLED: 'Target environment is currently disabled.',
    SERVICE_NOT_IN_DELIVERY_GROUP: 'Service is not assigned to a delivery group.',
    INVALID_ENVIRONMENT: 'Environment is not valid for this service.'
  }
  const promotionReason = promotionReasonMap[servicePromotionCandidate?.reason] || 'Promotion is not eligible.'
  if (mode === 'list') {
    return (
      <div className="shell">
        <div className="page-header-zone">
          <PageHeader
            title="Services"
            subtitle={listSubtitle}
            meta={headerMeta}
            actions={
              <button
                className="button secondary"
                onClick={() => loadServicesList({ bypassCache: true })}
                disabled={servicesViewLoading}
              >
                {servicesViewLoading ? 'Refreshing...' : 'Refresh'}
              </button>
            }
          />
        </div>
        <SectionCard style={{ gridColumn: '1 / -1' }}>
          <h2>Delivery control plane</h2>
          <div className="helper space-8">
            DXCP is the source of truth for delivery intent and status. It applies platform guardrails by default.
          </div>
          <div className="helper space-8">
            What you can do depends on your role. Services shown here are allowlisted and scoped by policy.
          </div>
        </SectionCard>
        <SectionCard style={{ gridColumn: '1 / -1' }}>
          {environmentNotice && <div className="helper space-8">{environmentNotice}</div>}
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
        </SectionCard>
      </div>
    )
  }

  return (
    <div className="shell">
      <div className="page-header-zone">
        <PageHeader
          title="Service detail"
          subtitle={serviceDetailName || 'Unknown service'}
          meta={headerMeta}
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

      {serviceDetailLoading && (
        <SectionCard style={{ gridColumn: '1 / -1' }}>
          Loading service detail...
        </SectionCard>
      )}

      {!serviceDetailLoading && serviceDetailTab === 'overview' && (
        <>
          <SectionCard>
            <h2>What is running</h2>
            <div className="helper space-8">Environment context: {environmentLabel}</div>
            {!environmentReady && environmentNotice && (
              <div className="helper space-8">{environmentNotice}</div>
            )}
            {serviceDetailRunning ? (
              <div>
              <div className="badge-row">
                <span className="badge info badge-with-tooltip">
                  State source: DXCP
                  <InfoTooltip label="State source details">
                    <span className="info-tooltip-title">State source</span>
                    <span>
                      Shows where the running version comes from. DXCP derives it from its deployment records and is the
                      system of record.
                    </span>
                    <span className="info-tooltip-list">Known sources: DXCP record (authoritative).</span>
                  </InfoTooltip>
                </span>
                <span className="badge neutral">
                  Operation: {deploymentKindLabel(serviceDetailRunning.deploymentKind)}
                </span>
                </div>
                <p className="space-8">
                  Version: <strong>{serviceDetailRunning.version || '-'}</strong>
                </p>
                <p>Environment: {runningEnvironment}</p>
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
                  Running state is derived from DXCP deployment records.
                </div>
              </div>
            ) : (
              <div className="helper">No running version recorded yet.</div>
            )}
          </SectionCard>
          <SectionCard>
            <h2>Latest delivery status</h2>
            <div className="helper space-8">Environment context: {environmentLabel}</div>
            {serviceDetailLatest ? (
              <div>
                <div className="badge-row">
                  <span className={`badge ${outcomeTone(serviceDetailLatest.outcome, serviceDetailLatest.state)}`}>
                    {resolveLatestStatusLabel(serviceDetailLatest)}
                  </span>
                </div>
                {serviceDetailLatest.deploymentKind && (
                  <div className="helper meta-line">
                    Operation: {deploymentKindLabel(serviceDetailLatest.deploymentKind, serviceDetailLatest.rollbackOf)}
                  </div>
                )}
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
          </SectionCard>
          <SectionCard>
            <h2>Promote</h2>
            <div className="helper space-8">Promotion path follows configured environment order.</div>
            {!environmentReady && (
              <div className="helper space-8">
                Select an environment to evaluate promotion eligibility.
              </div>
            )}
            {environmentReady && servicePromotionCandidate?.eligible && promotionStep === 'form' && (
              <>
                <div className="list space-12">
                  <div className="list-item">
                    <div>Source environment</div>
                    <div>{servicePromotionCandidate.source_environment}</div>
                  </div>
                  <div className="list-item">
                    <div>Target environment</div>
                    <div>{servicePromotionCandidate.target_environment}</div>
                  </div>
                  <div className="list-item">
                    <div>Version</div>
                    <div>{servicePromotionCandidate.version}</div>
                  </div>
                  <div className="list-item">
                    <div>Recipe</div>
                    <div>{servicePromotionCandidate.recipeId}</div>
                  </div>
                </div>
                <div className="field space-12">
                  <label htmlFor="promotion-change-summary">Promotion change summary</label>
                  <input
                    id="promotion-change-summary"
                    value={promotionChangeSummary}
                    onChange={(e) => setPromotionChangeSummary(e.target.value)}
                    placeholder="Describe why this version is being promoted"
                  />
                </div>
                {promotionInlineError && <div className="helper space-8">{promotionInlineError}</div>}
                <button className="button" onClick={handleReviewPromotion} disabled={promotionSubmitting}>
                  {promotionSubmitting ? 'Validating promotion...' : 'Review promotion'}
                </button>
              </>
            )}
            {environmentReady && servicePromotionCandidate?.eligible && promotionStep === 'confirm' && (
              <>
                <div className="helper space-8">Confirm promotion intent</div>
                <div className="list space-12">
                  <div className="list-item">
                    <div>Service</div>
                    <div>{serviceDetailName || '-'}</div>
                  </div>
                  <div className="list-item">
                    <div>Source</div>
                    <div>{promotionValidation?.source_environment || '-'}</div>
                  </div>
                  <div className="list-item">
                    <div>Target</div>
                    <div>{promotionValidation?.target_environment || '-'}</div>
                  </div>
                  <div className="list-item">
                    <div>Version</div>
                    <div>{promotionValidation?.version || '-'}</div>
                  </div>
                  <div className="list-item">
                    <div>Recipe</div>
                    <div>{promotionValidation?.recipeId || '-'}</div>
                  </div>
                  <div className="list-item">
                    <div>Change summary</div>
                    <div>{promotionChangeSummary || '-'}</div>
                  </div>
                </div>
                {promotionInlineError && <div className="helper space-8">{promotionInlineError}</div>}
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button className="button" onClick={handleConfirmPromotion} disabled={promotionSubmitting}>
                    {promotionSubmitting ? 'Starting promotion...' : 'Confirm promotion'}
                  </button>
                  <button className="button secondary" onClick={handleBackToPromotionEdit} disabled={promotionSubmitting}>
                    Back to edit
                  </button>
                </div>
              </>
            )}
            {environmentReady && !servicePromotionCandidate?.eligible && (
              <div className="helper">{promotionReason}</div>
            )}
          </SectionCard>
          <SectionCard data-testid="delivery-group-card">
            <h2>Delivery group</h2>
            {serviceDetailGroup ? (
              <div className="dg-rail">
                <div className="dg-grid">
                  <div className="dg-label">Name</div>
                  <div className="dg-value">{serviceDetailGroup.name || '.'}</div>
                  <div className="dg-label">Owner</div>
                  <div className="dg-value">
                    {serviceDetailGroup.owner || 'Unassigned'}
                  </div>
                  <div className="dg-subhead">Guardrails</div>
                  <div className="dg-label">Max concurrent deployments</div>
                  <div className="dg-value">
                    {serviceDetailGroup.guardrails?.max_concurrent_deployments ?? '.'}
                  </div>
                  <div className="dg-label">Daily deploy quota</div>
                  <div className="dg-value">
                    {serviceDetailGroup.guardrails?.daily_deploy_quota ?? '.'}
                  </div>
                  <div className="dg-label">Daily rollback quota</div>
                  <div className="dg-value">
                    {serviceDetailGroup.guardrails?.daily_rollback_quota ?? '.'}
                  </div>
                </div>
              </div>
            ) : (
              <div className="helper">Service is not assigned to a delivery group.</div>
            )}
          </SectionCard>
          <SectionCard>
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
          </SectionCard>
        </>
      )}

      {!serviceDetailLoading && serviceDetailTab === 'deploy' && (
        <SectionCard style={{ gridColumn: '1 / -1' }}>
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
        </SectionCard>
      )}

      {!serviceDetailLoading && serviceDetailTab === 'history' && (
        <SectionCard style={{ gridColumn: '1 / -1' }}>
          <h2>Deployment history</h2>
          <div className="helper space-8">Showing history for {environmentLabel}.</div>
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
        </SectionCard>
      )}

      {!serviceDetailLoading && serviceDetailTab === 'failures' && (
        <SectionCard style={{ gridColumn: '1 / -1' }}>
          <h2>Latest failures</h2>
          {renderFailures(serviceDetailFailures, serviceDetailStatus?.latest?.engineExecutionUrl)}
        </SectionCard>
      )}

      {!serviceDetailLoading && serviceDetailTab === 'insights' && (
        <SectionCard style={{ gridColumn: '1 / -1' }}>
          <h2>Insights</h2>
          <div className="helper">
            Service-level insights are not available yet. Use the Insights view for system-wide trends.
          </div>
        </SectionCard>
      )}
    </div>
  )
}
