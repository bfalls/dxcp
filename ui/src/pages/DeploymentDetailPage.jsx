import React from 'react'

export default function DeploymentDetailPage({
  selected,
  statusClass,
  statusMessage,
  selectedValidatedAt,
  selectedExecutionAt,
  outcomeTone,
  outcomeDisplayLabel,
  resolveDeploymentKind,
  resolveOutcome,
  selectedRollbackId,
  shortId,
  openDeployment,
  deploymentKindLabel,
  getRecipeDisplay,
  formatTime,
  serviceUrl,
  isPlatformAdmin,
  handleRollback,
  canRollback,
  rollbackDisabledReason,
  rollbackResult,
  timelineSteps,
  failures,
  renderFailures,
  deploymentLoading
}) {
  return (
    <div className="shell">
      <div className="card">
        <h2>Deployment detail</h2>
        {deploymentLoading && <div className="helper">Loading deployment detail...</div>}
        {!deploymentLoading && !selected && <div className="helper">Select a deployment from the list.</div>}
        {selected && (
          <div>
            <div className={statusClass(selected.state)}>{selected.state}</div>
            {statusMessage && <div className="helper" style={{ marginTop: '8px' }}>{statusMessage}</div>}
            <div className="list" style={{ marginTop: '12px' }}>
              <div className="list-item admin-detail">
                <div>Intent id</div>
                <div>{selected.intentCorrelationId || 'Not captured'}</div>
              </div>
              <div className="list-item admin-detail">
                <div>Validated at</div>
                <div>{selectedValidatedAt ? formatTime(selectedValidatedAt) : 'Not recorded'}</div>
              </div>
              <div className="list-item admin-detail">
                <div>Execution</div>
                <div>{selectedExecutionAt ? `Started ${formatTime(selectedExecutionAt)}` : 'Not started yet'}</div>
              </div>
              <div className="list-item admin-detail">
                <div>Outcome</div>
                <div>
                  <span className={`badge ${outcomeTone(selected.outcome, selected.state)}`}>
                    {outcomeDisplayLabel(selected.outcome, selected.state, selected.deploymentKind, selected.rollbackOf)}
                  </span>
                  {resolveDeploymentKind(selected.deploymentKind, selected.rollbackOf) === 'ROLL_FORWARD' &&
                    resolveOutcome(selected.outcome, selected.state) === 'ROLLED_BACK' && (
                      <div className="helper" style={{ marginTop: '4px' }}>
                        Auto-rollback recorded as a separate rollback deployment.
                        {selectedRollbackId && (
                          <button
                            className="button secondary"
                            style={{ marginLeft: '8px' }}
                            onClick={() => openDeployment({ id: selectedRollbackId })}
                          >
                            View rollback {shortId(selectedRollbackId)}
                          </button>
                        )}
                      </div>
                    )}
                </div>
              </div>
              <div className="list-item admin-detail">
                <div>Operation</div>
                <div>{deploymentKindLabel(selected.deploymentKind, selected.rollbackOf)}</div>
              </div>
              {selected.rollbackOf && (
                <div className="list-item admin-detail">
                  <div>Rollback of</div>
                  <div>{selected.rollbackOf}</div>
                </div>
              )}
              <div className="list-item admin-detail">
                <div>Recipe</div>
                <div>{getRecipeDisplay(selected.recipeId, selected.recipeRevision)}</div>
              </div>
              <div className="list-item admin-detail">
                <div>Behavior summary</div>
                <div>{selected.effectiveBehaviorSummary || 'Not recorded'}</div>
              </div>
            </div>
            <p>Service: {selected.service}</p>
            <p>Version: {selected.version}</p>
            <p>Created: {formatTime(selected.createdAt)}</p>
            <p>Updated: {formatTime(selected.updatedAt)}</p>
            {isPlatformAdmin && selected.engineExecutionId && <p>Execution id: {selected.engineExecutionId}</p>}
            <div className="links">
              {isPlatformAdmin && selected.engineExecutionUrl && (
                <a className="link" href={selected.engineExecutionUrl} target="_blank" rel="noreferrer">
                  Execution detail
                </a>
              )}
              {serviceUrl && (
                <a className="link" href={serviceUrl} target="_blank" rel="noreferrer">
                  Service URL
                </a>
              )}
            </div>
            <button
              className="button danger"
              onClick={handleRollback}
              style={{ marginTop: '12px' }}
              disabled={!canRollback}
              title={!canRollback ? rollbackDisabledReason : ''}
            >
              Rollback
            </button>
            {!canRollback && (
              <div className="helper" style={{ marginTop: '8px' }}>
                Rollback disabled. {rollbackDisabledReason}
              </div>
            )}
            {selected.rollbackOf && (
              <button
                className="button secondary"
                onClick={() => openDeployment({ id: selected.rollbackOf })}
                style={{ marginTop: '8px' }}
              >
                View original deployment
              </button>
            )}
            {rollbackResult && (
              <div className="helper" style={{ marginTop: '8px' }}>
                Rollback created: {rollbackResult.id}
              </div>
            )}
          </div>
        )}
      </div>
      <div className="card">
        <h2>Timeline</h2>
        <div className="timeline">
          {timelineSteps.length === 0 && <div className="helper">No timeline events available.</div>}
          {timelineSteps.map((step) => (
            <div key={step.key} className="timeline-step active">
              <strong>{step.label}</strong>
              <div className="helper">Event time: {formatTime(step.occurredAt)}</div>
              {step.detail && <div className="helper">{step.detail}</div>}
            </div>
          ))}
        </div>
      </div>
      <div className="card">
        <h2>Failures</h2>
        {renderFailures(failures, selected?.engineExecutionUrl)}
      </div>
    </div>
  )
}
