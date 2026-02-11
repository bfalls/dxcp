import React from 'react'
import PageHeader from '../components/PageHeader.jsx'
import SectionCard from '../components/SectionCard.jsx'
import TwoColumn from '../components/TwoColumn.jsx'

function DeploymentHeader({
  selected,
  statusClass,
  outcomeTone,
  outcomeDisplayLabel,
  deploymentKindLabel,
  handleRollback,
  canRollback,
  rollbackDisabledReason,
  headerMeta
}) {
  return (
    <>
      <PageHeader
        title="Deployment detail"
        meta={headerMeta}
        actions={
          <button
            className="button danger"
            onClick={handleRollback}
            disabled={!canRollback}
            title={!canRollback ? rollbackDisabledReason : ''}
          >
            Rollback
          </button>
        }
      />
      {selected && (
        <>
          <div className="deployment-header-summary">
            <span className={statusClass(selected.state)}>{selected.state}</span>
            <span className={`badge ${outcomeTone(selected.outcome, selected.state)}`}>
              Outcome: {outcomeDisplayLabel(selected.outcome, selected.state, selected.deploymentKind, selected.rollbackOf)}
            </span>
            <span className="badge neutral">
              Operation: {deploymentKindLabel(selected.deploymentKind, selected.rollbackOf)}
            </span>
            <span className="badge neutral">Service: {selected.service}</span>
            <span className="badge neutral">Version: {selected.version || '-'}</span>
          </div>
        </>
      )}
    </>
  )
}

function DeploymentIdentity({ selected, getRecipeDisplay }) {
  return (
    <SectionCard>
      <h2>Deployment identity</h2>
      <div className="behavior-summary">
        <div className="helper">Behavior summary</div>
        <div className="behavior-summary-value">{selected.effectiveBehaviorSummary || 'Not recorded'}</div>
      </div>
      <div className="list space-12">
        <div className="list-item admin-detail">
          <div>Recipe</div>
          <div>{getRecipeDisplay(selected.recipeId, selected.recipeRevision)}</div>
        </div>
        <div className="list-item admin-detail">
          <div>Recipe revision</div>
          <div>{selected.recipeRevision ? `v${selected.recipeRevision}` : '-'}</div>
        </div>
      </div>
    </SectionCard>
  )
}

function DeploymentMeta({
  selected,
  selectedValidatedAt,
  selectedExecutionAt,
  resolveDeploymentKind,
  resolveOutcome,
  selectedRollbackId,
  shortId,
  openDeployment,
  formatTime,
  serviceUrl,
  isPlatformAdmin
}) {
  const isAutoRollback =
    resolveDeploymentKind(selected.deploymentKind, selected.rollbackOf) === 'ROLL_FORWARD' &&
    resolveOutcome(selected.outcome, selected.state) === 'ROLLED_BACK'

  return (
    <SectionCard>
      <h2>Execution metadata</h2>
      <div className="list space-12">
        <div className="list-item admin-detail">
          <div>Validated at</div>
          <div>{selectedValidatedAt ? formatTime(selectedValidatedAt) : 'Not recorded'}</div>
        </div>
        <div className="list-item admin-detail">
          <div>Execution</div>
          <div>{selectedExecutionAt ? `Started ${formatTime(selectedExecutionAt)}` : 'Not started yet'}</div>
        </div>
        <div className="list-item admin-detail">
          <div>Created</div>
          <div>{formatTime(selected.createdAt)}</div>
        </div>
        <div className="list-item admin-detail">
          <div>Updated</div>
          <div>{formatTime(selected.updatedAt)}</div>
        </div>
      </div>
      {isAutoRollback && (
        <div className="helper space-8">
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
      <details className="technical-details space-12">
        <summary>Technical details</summary>
        <div className="list space-12">
          <div className="list-item admin-detail">
            <div>Intent id</div>
            <div>{selected.intentCorrelationId || 'Not captured'}</div>
          </div>
          {selected.rollbackOf && (
            <div className="list-item admin-detail">
              <div>Rollback of</div>
              <div>{selected.rollbackOf}</div>
            </div>
          )}
          {isPlatformAdmin && selected.engineExecutionId && (
            <div className="list-item admin-detail">
              <div>Execution id</div>
              <div>{selected.engineExecutionId}</div>
            </div>
          )}
          {isPlatformAdmin && selected.engineExecutionUrl && (
            <div className="list-item admin-detail">
              <div>Execution detail</div>
              <div>
                <a className="link" href={selected.engineExecutionUrl} target="_blank" rel="noreferrer">
                  Open execution
                </a>
              </div>
            </div>
          )}
          {serviceUrl && (
            <div className="list-item admin-detail">
              <div>Service URL</div>
              <div>
                <a className="link" href={serviceUrl} target="_blank" rel="noreferrer">
                  Open service
                </a>
              </div>
            </div>
          )}
        </div>
      </details>
      {selected.rollbackOf && (
        <button
          className="button secondary space-8"
          onClick={() => openDeployment({ id: selected.rollbackOf })}
        >
          View original deployment
        </button>
      )}
    </SectionCard>
  )
}

function DeploymentTimeline({ timelineSteps, formatTime }) {
  return (
    <SectionCard>
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
    </SectionCard>
  )
}

function DeploymentFailures({ failures, renderFailures, engineExecutionUrl }) {
  return (
    <SectionCard>
      <h2>Failures</h2>
      {(!failures || failures.length === 0) && (
        <div className="helper">No failures recorded for this deployment.</div>
      )}
      {failures && failures.length > 0 && renderFailures(failures, engineExecutionUrl)}
    </SectionCard>
  )
}

export default function DeploymentDetailPage({
  selected,
  statusClass,
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
  timelineSteps,
  failures,
  renderFailures,
  deploymentLoading,
  headerMeta
}) {
  return (
    <TwoColumn
      header={
        <DeploymentHeader
          selected={selected}
          statusClass={statusClass}
          outcomeTone={outcomeTone}
          outcomeDisplayLabel={outcomeDisplayLabel}
          deploymentKindLabel={deploymentKindLabel}
          handleRollback={handleRollback}
          canRollback={canRollback}
          rollbackDisabledReason={rollbackDisabledReason}
          headerMeta={headerMeta}
        />
      }
      primary={
        <>
          {deploymentLoading && (
            <SectionCard>
              <div className="helper">Loading deployment detail...</div>
            </SectionCard>
          )}
          {!deploymentLoading && !selected && (
            <SectionCard>
              <div className="helper">Select a deployment from the list.</div>
            </SectionCard>
          )}
          {!deploymentLoading && selected && (
            <>
              <DeploymentIdentity selected={selected} getRecipeDisplay={getRecipeDisplay} />
              <DeploymentMeta
                selected={selected}
                selectedValidatedAt={selectedValidatedAt}
                selectedExecutionAt={selectedExecutionAt}
                resolveDeploymentKind={resolveDeploymentKind}
                resolveOutcome={resolveOutcome}
                selectedRollbackId={selectedRollbackId}
                shortId={shortId}
                openDeployment={openDeployment}
                formatTime={formatTime}
                serviceUrl={serviceUrl}
                isPlatformAdmin={isPlatformAdmin}
              />
            </>
          )}
        </>
      }
      secondary={
        <>
          <DeploymentTimeline timelineSteps={timelineSteps} formatTime={formatTime} />
          <DeploymentFailures
            failures={failures}
            renderFailures={renderFailures}
            engineExecutionUrl={selected?.engineExecutionUrl}
          />
        </>
      }
    />
  )
}
