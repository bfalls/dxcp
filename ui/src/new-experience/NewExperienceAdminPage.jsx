import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import SectionCard from '../components/SectionCard.jsx'
import NewExperiencePageHeader from './NewExperiencePageHeader.jsx'
import { NewExplanation, NewStateBlock } from './NewExperienceStatePrimitives.jsx'
import { useNewExperienceAlertRail } from './NewExperienceShell.jsx'
import {
  buildAdminViewModel,
  createAdminDraft,
  loadAdminData,
  reviewAdminGroupDraft,
  saveAdminGroupDraft
} from './newExperienceAdminData.js'

function BlockedAdminState({ role }) {
  useNewExperienceAlertRail([
    {
      id: 'admin-blocked-access',
      tone: 'danger',
      title: 'Admin access required',
      body: 'This area is limited to platform administration. Use Applications, Deployments, or Insights for standard delivery work.'
    }
  ])

  return (
    <>
      <NewExperiencePageHeader
        title="Admin"
        objectIdentity="Admin workspace"
        role={role}
        stateSummaryItems={[{ label: 'Workspace access', value: 'Unavailable' }]}
        primaryAction={{ label: 'Admin', state: 'unavailable' }}
        secondaryActions={[
          { label: 'Open Applications', to: '/new/applications' },
          { label: 'Open Deployments', to: '/new/deployments' },
          { label: 'Open Insights', to: '/new/insights' }
        ]}
      />
      <NewStateBlock
        eyebrow="Blocked access"
        title="Admin access required"
        tone="danger"
        actions={[
          { label: 'Open Applications', to: '/new/applications' },
          { label: 'Open Deployments', to: '/new/deployments', secondary: true },
          { label: 'Open Insights', to: '/new/insights', secondary: true }
        ]}
      >
        This area is limited to platform administration. Use Applications, Deployments, or Insights for standard delivery work.
      </NewStateBlock>
    </>
  )
}

function formatStrategies(recipeIds, recipesById) {
  const labels = recipeIds
    .map((recipeId) => recipesById.get(recipeId)?.name || recipeId)
    .filter(Boolean)
  return labels.length > 0 ? labels.join(', ') : 'None selected'
}

export default function NewExperienceAdminPage({ role = 'UNKNOWN', api }) {
  const [adminState, setAdminState] = useState({
    kind: 'loading',
    errorMessage: '',
    viewModel: null
  })
  const [selectedGroupId, setSelectedGroupId] = useState('')
  const [mode, setMode] = useState('view')
  const [draft, setDraft] = useState(null)
  const [review, setReview] = useState({ warnings: [], errors: [] })
  const [warningAcknowledged, setWarningAcknowledged] = useState(false)
  const [saveNote, setSaveNote] = useState('')
  const [reviewBusy, setReviewBusy] = useState(false)
  const [saveBusy, setSaveBusy] = useState(false)
  const [saveError, setSaveError] = useState('')

  const refreshAdmin = useCallback(
    async (options = {}) => {
      setAdminState((current) => ({
        kind: current.kind === 'ready' || current.kind === 'degraded' || current.kind === 'empty' ? 'refreshing' : 'loading',
        errorMessage: '',
        viewModel: current.viewModel
      }))
      const nextState = await loadAdminData(api, options)
      setAdminState(nextState)
    },
    [api]
  )

  useEffect(() => {
    let active = true
    const load = async () => {
      setAdminState({ kind: 'loading', errorMessage: '', viewModel: null })
      const nextState = await loadAdminData(api)
      if (active) {
        setAdminState(nextState)
      }
    }
    load()
    return () => {
      active = false
    }
  }, [api])

  useEffect(() => {
    const firstGroupId = adminState.viewModel?.groups?.[0]?.id || ''
    setSelectedGroupId((current) => {
      if (current && adminState.viewModel?.groups?.some((group) => group.id === current)) return current
      return firstGroupId
    })
  }, [adminState.viewModel])

  const viewModel = useMemo(
    () => buildAdminViewModel(adminState, selectedGroupId, mode, draft, review, warningAcknowledged),
    [adminState, selectedGroupId, mode, draft, review, warningAcknowledged]
  )

  useEffect(() => {
    if (!viewModel?.baseGroup) return
    setDraft((current) => (current ? current : createAdminDraft(viewModel.baseGroup)))
  }, [viewModel?.baseGroup])

  const isLoading = adminState.kind === 'loading'
  const isRefreshing = adminState.kind === 'refreshing'
  const isFailure = adminState.kind === 'failure'
  const isEmpty = adminState.kind === 'empty'
  const isDegraded = adminState.kind === 'degraded'

  const alertRailItems = useMemo(() => {
    if (isFailure) {
      return [
        {
          id: 'admin-failure',
          tone: 'danger',
          title: 'Admin data could not be loaded',
          body: adminState.errorMessage || 'DXCP could not load governance data right now. Refresh to try again.'
        }
      ]
    }
    if (isDegraded) {
      return [
        {
          id: 'admin-degraded',
          tone: 'warning',
          title: 'Supporting reads are degraded',
          body: 'The governance object remains available, but one or more supporting reads could not be refreshed.'
        }
      ]
    }
    if (viewModel?.saveBlockedBySettings) {
      return [
        {
          id: 'admin-save-blocked',
          tone: 'danger',
          title: 'Save blocked',
          body:
            adminState.viewModel?.mutationAvailability === 'unknown'
              ? 'Save remains blocked because mutation availability could not be confirmed on this route.'
              : 'Save is blocked before mutation because DXCP is in read-only mode.'
        }
      ]
    }
    return []
  }, [adminState.errorMessage, adminState.viewModel?.mutationAvailability, isDegraded, isFailure, viewModel?.saveBlockedBySettings])

  useNewExperienceAlertRail(alertRailItems)

  function resetReviewState(nextMode) {
    setMode(nextMode)
    setReview({ warnings: [], errors: [] })
    setWarningAcknowledged(false)
    setSaveError('')
    setSaveNote('')
  }

  function updateDraft(field, value) {
    setDraft((current) => ({
      ...current,
      [field]: value
    }))
    setReview({ warnings: [], errors: [] })
    setWarningAcknowledged(false)
    setSaveError('')
    setSaveNote('')
  }

  function toggleRecipe(recipeId) {
    setDraft((current) => {
      const next = new Set(current.allowedRecipes)
      if (next.has(recipeId)) {
        next.delete(recipeId)
      } else {
        next.add(recipeId)
      }
      return {
        ...current,
        allowedRecipes: Array.from(next).sort()
      }
    })
    setReview({ warnings: [], errors: [] })
    setWarningAcknowledged(false)
    setSaveError('')
    setSaveNote('')
  }

  async function moveToReview() {
    if (!viewModel?.baseGroup || !draft) return
    setReviewBusy(true)
    setSaveError('')
    setSaveNote('')
    const nextReview = await reviewAdminGroupDraft(api, viewModel.baseGroup, draft)
    setReview({ warnings: nextReview.warnings, errors: nextReview.errors })
    setMode('review')
    setWarningAcknowledged(false)
    setReviewBusy(false)
  }

  async function handleSave() {
    if (!viewModel?.baseGroup || !viewModel.canSave) return
    const payloadReview = await reviewAdminGroupDraft(api, viewModel.baseGroup, draft)
    if (payloadReview.errors.length > 0) {
      setReview({ warnings: payloadReview.warnings, errors: payloadReview.errors })
      setSaveError('Save remains blocked until the review errors are resolved.')
      return
    }
    setSaveBusy(true)
    const result = await saveAdminGroupDraft(api, viewModel.baseGroup.id, payloadReview.payload)
    if (!result.ok) {
      setSaveBusy(false)
      setSaveError(result.errorMessage)
      return
    }
    const nextState = await loadAdminData(api, { bypassCache: true })
    setAdminState(nextState)
    setSelectedGroupId(result.group?.id || viewModel.baseGroup.id)
    setMode('view')
    setDraft(null)
    setReview({ warnings: [], errors: [] })
    setWarningAcknowledged(false)
    setSaveBusy(false)
    setSaveError('')
    setSaveNote('Deployment Group saved. Future deployments now use the reviewed guardrail and Deployment Strategy rules.')
  }

  const primaryAction = (() => {
    if (isFailure) {
      return { label: 'Refresh', state: 'available', onClick: () => refreshAdmin({ bypassCache: true }) }
    }
    if (mode === 'view') {
      return {
        label: 'Edit',
        state: viewModel?.baseGroup ? 'available' : 'disabled',
        onClick: () => resetReviewState('edit'),
        disabled: !viewModel?.baseGroup,
        description: 'Enter edit mode for this Deployment Group.'
      }
    }
    if (mode === 'edit') {
      return {
        label: reviewBusy ? 'Reviewing...' : 'Review changes',
        state: viewModel?.hasChanges ? 'available' : 'disabled',
        onClick: moveToReview,
        disabled: !viewModel?.hasChanges || reviewBusy,
        description: 'Review the change impact before save.'
      }
    }
    return {
      label: saveBusy ? 'Saving...' : 'Save',
      state: viewModel?.saveBlockedBySettings || viewModel?.errors.length > 0 ? 'blocked' : viewModel?.canSave ? 'available' : 'disabled',
      onClick: handleSave,
      disabled: !viewModel?.canSave || saveBusy,
      description: 'Save becomes available only after review is complete.'
    }
  })()

  const actionNote = (() => {
    if (isFailure) {
      return 'Admin remains unavailable until DXCP can load governance data for this route.'
    }
    if (mode === 'view') {
      return 'Admin objects stay read-first. Enter Edit before DXCP exposes review and save actions.'
    }
    if (mode === 'edit') {
      return 'Review changes before save so impact, warnings, and blocked outcomes stay visible before mutation.'
    }
    if (viewModel?.saveBlockedBySettings) {
      return adminState.viewModel?.mutationAvailability === 'unknown'
        ? 'Save is blocked before mutation because DXCP could not confirm mutation availability on this route.'
        : 'Save is blocked before mutation because DXCP is in read-only mode. Review remains visible so you can understand the impact without attempting a failed save.'
    }
    if (viewModel?.errors.length > 0) {
      return 'Save is blocked before mutation. Resolve the blocking review errors and return to this review step.'
    }
    if (viewModel?.saveRequiresWarningAcknowledgement && !warningAcknowledged) {
      return 'Warnings do not block this change, but acknowledgement is required before Save becomes available.'
    }
    return 'Review stays visible before save so the governance impact remains explicit, not implied.'
  })()

  if (role !== 'PLATFORM_ADMIN') {
    return <BlockedAdminState role={role} />
  }

  if (isFailure) {
    return (
      <div className="new-admin-page">
        <NewExperiencePageHeader
          title="Admin"
          objectIdentity="Admin workspace"
          role={role}
          stateSummaryItems={[{ label: 'Route state', value: 'Unavailable' }]}
          primaryAction={primaryAction}
          secondaryActions={[{ label: 'Open Applications', to: '/new/applications' }]}
          actionNote={actionNote}
        />
        <NewStateBlock
          eyebrow="Read failure"
          title="Governance data is unavailable right now"
          tone="danger"
          actions={[
            { label: 'Refresh', onClick: () => refreshAdmin({ bypassCache: true }) },
            { label: 'Open Applications', to: '/new/applications', secondary: true }
          ]}
        >
          {adminState.errorMessage || 'DXCP could not load governance data right now. Refresh to try again.'}
        </NewStateBlock>
      </div>
    )
  }

  if (isEmpty) {
    return (
      <div className="new-admin-page">
        <NewExperiencePageHeader
          title="Admin"
          objectIdentity="Admin workspace"
          role={role}
          stateSummaryItems={[{ label: 'Workspace', value: 'Empty' }]}
          primaryAction={{ label: 'Refresh', state: 'available', onClick: () => refreshAdmin({ bypassCache: true }) }}
          secondaryActions={[{ label: 'Open Legacy Admin', to: '/admin' }]}
          actionNote="No governance objects are available on this route yet."
        />
        <NewStateBlock
          eyebrow="Empty"
          title="No Deployment Groups are configured yet"
          actions={[
            { label: 'Refresh', onClick: () => refreshAdmin({ bypassCache: true }) },
            { label: 'Open Legacy Admin', to: '/admin', secondary: true }
          ]}
        >
          DXCP did not return any Deployment Groups for this route yet. Governance review remains object-first once the first Deployment Group is available.
        </NewStateBlock>
      </div>
    )
  }

  return (
    <div className="new-admin-page">
      <NewExperiencePageHeader
        title="Admin"
        objectIdentity={`Deployment Group: ${viewModel?.baseGroup?.name || 'Deployment Group'}`}
        role={role}
        stateSummaryItems={[
          { label: 'Workspace', value: 'Deployment Groups' },
          { label: 'Mode', value: mode === 'view' ? 'Inspect' : mode === 'edit' ? 'Edit' : 'Review' },
          { label: 'Pending changes', value: viewModel?.hasChanges ? `${viewModel.changeSummary.length}` : 'None' }
        ]}
        primaryAction={primaryAction}
        secondaryActions={[
          mode === 'review'
            ? { label: 'Back to edit', onClick: () => setMode('edit') }
            : mode === 'edit'
              ? { label: 'Cancel edit', onClick: () => resetReviewState('view') }
              : { label: 'Open Applications', to: '/new/applications' },
          { label: isRefreshing ? 'Refreshing...' : 'Refresh', onClick: () => refreshAdmin({ bypassCache: true }), disabled: isLoading || isRefreshing },
          { label: 'Open Legacy Admin', to: '/admin' }
        ]}
        actionNote={actionNote}
      />

      {isDegraded ? (
        <NewExplanation title="Supporting reads are degraded" tone="warning">
          {(adminState.viewModel?.degradedReasons || []).join(' ')}
        </NewExplanation>
      ) : null}

      <div className="new-admin-layout">
        <div className="new-admin-primary">
          {saveNote ? (
            <NewExplanation title="Save complete" tone="neutral">
              {saveNote}
            </NewExplanation>
          ) : null}
          {saveError ? (
            <NewExplanation title="Save could not be completed" tone="danger">
              {saveError}
            </NewExplanation>
          ) : null}

          <SectionCard className="new-admin-card">
            <div className="new-section-header">
              <div>
                <h3>Governance object</h3>
                <p className="helper">Admin stays object-first and review-first instead of collapsing into a generic settings list.</p>
              </div>
              <div className="links">
                <Link className="link secondary" to="/new/deployments">
                  Open Deployments
                </Link>
              </div>
            </div>

            <label className="new-field" htmlFor="new-admin-group">
              <span>Deployment Group</span>
              <select
                id="new-admin-group"
                value={selectedGroupId}
                onChange={(event) => {
                  setSelectedGroupId(event.target.value)
                  setDraft(null)
                  resetReviewState('view')
                }}
              >
                {(adminState.viewModel?.groups || []).map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
            </label>

            <dl className="new-object-summary-grid" aria-label="Deployment Group summary">
              <dt>Deployment Group</dt>
              <dd>{viewModel?.baseGroup?.name}</dd>
              <dt>Owner</dt>
              <dd>{viewModel?.baseGroup?.owner}</dd>
              <dt>Applications governed</dt>
              <dd>{viewModel?.baseGroup?.services.length}</dd>
              <dt>Allowed Deployment Strategies</dt>
              <dd>{formatStrategies(viewModel?.baseGroup?.allowedRecipes || [], viewModel?.recipesById || new Map())}</dd>
              <dt>Current deploy quota</dt>
              <dd>{viewModel?.baseGroup?.guardrails.dailyDeployQuota} deploys/day</dd>
              <dt>Current rollback quota</dt>
              <dd>{viewModel?.baseGroup?.guardrails.dailyRollbackQuota} rollbacks/day</dd>
              <dt>Current concurrency</dt>
              <dd>{viewModel?.baseGroup?.guardrails.maxConcurrentDeployments} active deployment(s)</dd>
            </dl>
          </SectionCard>

          <SectionCard className="new-admin-card">
            <div className="new-section-header">
              <div>
                <h3>{mode === 'view' ? 'Current policy shape' : mode === 'edit' ? 'Edit draft' : 'Review before save'}</h3>
                <p className="helper">
                  {mode === 'view'
                    ? 'Current policy stays visible before edit so governance understanding comes first.'
                    : mode === 'edit'
                      ? 'Editing is section-based and calm. Review is a separate, visible step before mutation.'
                      : 'Review compares current and proposed state so Save is never the first serious review moment.'}
                </p>
              </div>
            </div>

            {mode === 'view' ? (
              <div className="new-explanation-stack">
                <NewExplanation title="Current governance posture" tone="neutral">
                  {viewModel?.baseGroup?.description}
                </NewExplanation>
                <NewExplanation title="Current impact" tone="neutral">
                  Applications in this Deployment Group currently use the listed Deployment Strategies and guardrails for future deployments.
                </NewExplanation>
              </div>
            ) : (
              <div className="new-admin-edit-grid">
                <label className="new-field">
                  <span>Daily deploy quota</span>
                  <input
                    aria-label="Daily deploy quota"
                    type="number"
                    value={draft?.dailyDeployQuota || ''}
                    onChange={(event) => updateDraft('dailyDeployQuota', event.target.value)}
                    readOnly={mode === 'review'}
                  />
                </label>
                <label className="new-field">
                  <span>Daily rollback quota</span>
                  <input
                    aria-label="Daily rollback quota"
                    type="number"
                    value={draft?.dailyRollbackQuota || ''}
                    onChange={(event) => updateDraft('dailyRollbackQuota', event.target.value)}
                    readOnly={mode === 'review'}
                  />
                </label>
                <label className="new-field">
                  <span>Max concurrent deployments</span>
                  <input
                    aria-label="Max concurrent deployments"
                    type="number"
                    value={draft?.maxConcurrentDeployments || ''}
                    onChange={(event) => updateDraft('maxConcurrentDeployments', event.target.value)}
                    readOnly={mode === 'review'}
                  />
                </label>
                <label className="new-field new-field-full">
                  <span>Allowed Deployment Strategies</span>
                  <div className="new-admin-checkbox-row">
                    {(viewModel?.availableRecipes || []).map((recipe) => (
                      <label key={recipe.id} className="new-admin-checkbox">
                        <input
                          aria-label={recipe.name}
                          checked={draft?.allowedRecipes?.includes(recipe.id) === true}
                          onChange={() => toggleRecipe(recipe.id)}
                          disabled={mode === 'review' || recipe.status === 'deprecated'}
                          type="checkbox"
                        />
                        <span>{recipe.name}</span>
                      </label>
                    ))}
                  </div>
                </label>
              </div>
            )}

            {mode === 'review' ? (
              <div className="new-admin-review-stack">
                <div className="new-admin-comparison-list" aria-label="Pending change summary">
                  {viewModel?.changeSummary.map((change) => (
                    <div key={change.label} className="new-admin-comparison-row">
                      <strong>{change.label}</strong>
                      <div className="new-admin-comparison-values">
                        <span>Current: {change.current}</span>
                        <span>Proposed: {change.proposed}</span>
                      </div>
                    </div>
                  ))}
                </div>

                {viewModel?.warnings.length > 0 ? (
                  <NewExplanation title="Warnings to review" tone="warning">
                    <ul className="new-admin-message-list">
                      {viewModel.warnings.map((warning) => (
                        <li key={warning.id}>{warning.text}</li>
                      ))}
                    </ul>
                  </NewExplanation>
                ) : null}

                {viewModel?.errors.length > 0 ? (
                  <NewExplanation title="Errors blocking save" tone="danger">
                    <ul className="new-admin-message-list">
                      {viewModel.errors.map((error) => (
                        <li key={error.id}>{error.text}</li>
                      ))}
                    </ul>
                  </NewExplanation>
                ) : null}

                {viewModel?.saveBlockedBySettings ? (
                  <NewExplanation title="Blocked save explanation" tone="danger">
                    {adminState.viewModel?.mutationAvailability === 'unknown'
                      ? 'DXCP could not confirm mutation availability on this route. Review stays available, but Save remains blocked until the route can confirm mutation posture again.'
                      : 'DXCP is currently in read-only mode. Review stays available, but this change cannot be saved until platform mutations are re-enabled.'}
                  </NewExplanation>
                ) : null}

                {viewModel?.saveRequiresWarningAcknowledgement ? (
                  <label className="new-admin-acknowledgement">
                    <input
                      checked={warningAcknowledged}
                      onChange={(event) => setWarningAcknowledged(event.target.checked)}
                      type="checkbox"
                    />
                    <span>I reviewed the warning impact and want to keep this change eligible for save.</span>
                  </label>
                ) : null}
              </div>
            ) : null}
          </SectionCard>
        </div>

        <div className="new-admin-support">
          <SectionCard className="new-admin-card">
            <h3>Impact preview</h3>
            <p className="helper">Impact stays visible before save so governance changes remain serious without becoming diagnostic-first.</p>

            <div className="new-admin-impact-columns">
              <div>
                <strong>Newly blocked</strong>
                <ul className="new-supporting-list">
                  {viewModel?.impactPreview.newlyBlocked.length > 0 ? (
                    viewModel.impactPreview.newlyBlocked.map((item) => <li key={item}>{item}</li>)
                  ) : (
                    <li>No newly blocked behavior is predicted.</li>
                  )}
                </ul>
              </div>
              <div>
                <strong>Newly allowed</strong>
                <ul className="new-supporting-list">
                  {viewModel?.impactPreview.newlyAllowed.length > 0 ? (
                    viewModel.impactPreview.newlyAllowed.map((item) => <li key={item}>{item}</li>)
                  ) : (
                    <li>No newly allowed behavior is predicted.</li>
                  )}
                </ul>
              </div>
            </div>

            <NewExplanation title="Unchanged" tone="neutral">
              <ul className="new-admin-message-list">
                {viewModel?.impactPreview.unchanged.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </NewExplanation>
          </SectionCard>

          <SectionCard className="new-admin-card">
            <h3>Validation summary</h3>
            <p className="helper">Warnings, errors, and blocked save remain separate so review meaning stays legible before mutation.</p>
            <dl className="new-application-support-grid">
              <dt>Warnings</dt>
              <dd>{viewModel?.warnings.length}</dd>
              <dt>Errors</dt>
              <dd>{viewModel?.errors.length}</dd>
              <dt>Save posture</dt>
              <dd>{viewModel?.saveBlockedBySettings ? 'Blocked before mutation' : viewModel?.canSave ? 'Ready after review' : 'Needs review'}</dd>
            </dl>
          </SectionCard>

          <SectionCard className="new-admin-card">
            <h3>Audit and review discipline</h3>
            <div className="new-explanation-stack">
              <NewExplanation title="Audit visibility" tone="neutral">
                {viewModel?.auditSummary}
              </NewExplanation>
              <NewExplanation title="Legacy boundary" tone="neutral">
                Admin remains contained under <code>/new/*</code> while the current Admin experience stays available during rollout.
              </NewExplanation>
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  )
}
