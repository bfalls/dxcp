import React, { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import SectionCard from '../components/SectionCard.jsx'
import NewExperiencePageHeader from './NewExperiencePageHeader.jsx'
import { NewExplanation, NewStateBlock } from './NewExperienceStatePrimitives.jsx'
import { useNewExperienceAlertRail } from './NewExperienceShell.jsx'

const BASE_GROUP = {
  id: 'payments-core',
  name: 'Payments Core',
  owner: 'Payments Platform',
  description: 'Governs sandbox, staging, and production delivery behavior for payment-path applications.',
  applicationsCount: 5,
  environments: ['sandbox', 'staging', 'production'],
  allowedStrategies: ['Blue-Green', 'Rolling'],
  guardrails: {
    maxConcurrentDeployments: 1,
    dailyDeployQuota: 10,
    dailyRollbackQuota: 3
  },
  lastChanged: 'March 10, 2026 at 09:18 AM UTC'
}

function buildDraftForScenario(scenario) {
  if (scenario === 'warnings' || scenario === 'blocked-save') {
    return {
      ...BASE_GROUP,
      allowedStrategies: ['Blue-Green'],
      guardrails: {
        ...BASE_GROUP.guardrails,
        dailyDeployQuota: 8
      }
    }
  }

  if (scenario === 'errors') {
    return {
      ...BASE_GROUP,
      allowedStrategies: [],
      guardrails: {
        ...BASE_GROUP.guardrails,
        dailyDeployQuota: 2
      }
    }
  }

  return BASE_GROUP
}

function formatStrategies(strategies) {
  return strategies.length > 0 ? strategies.join(', ') : 'None selected'
}

function buildValidation(draft, scenario) {
  const warnings = []
  const errors = []

  if (draft.guardrails.dailyDeployQuota < BASE_GROUP.guardrails.dailyDeployQuota) {
    warnings.push(
      'Future deployments in sandbox and staging will stop earlier each day after the lower deploy quota is reached.'
    )
  }

  if (!draft.allowedStrategies.includes('Rolling')) {
    warnings.push('5 Applications would no longer be allowed to use Rolling.')
  }

  if (draft.allowedStrategies.length === 0) {
    errors.push('At least one deployment strategy must remain allowed before DXCP can save this Deployment Group.')
  }

  if (draft.guardrails.dailyDeployQuota < draft.guardrails.dailyRollbackQuota) {
    errors.push('Daily deploy quota must stay greater than or equal to the daily rollback quota.')
  }

  if (scenario === 'blocked-save') {
    warnings.push('Policy review is complete, but platform-wide read-only mode is active.')
  }

  return { warnings, errors }
}

function buildImpactPreview(draft, base, validation) {
  const newlyBlocked = []
  const newlyAllowed = []
  const unchanged = ['Current running deployments stay unchanged until a future deployment is requested.']

  if (draft.guardrails.dailyDeployQuota < base.guardrails.dailyDeployQuota) {
    newlyBlocked.push(
      `Future deployments will stop after ${draft.guardrails.dailyDeployQuota} deploys in one day for ${draft.name}.`
    )
  }

  if (!draft.allowedStrategies.includes('Rolling') && base.allowedStrategies.includes('Rolling')) {
    newlyBlocked.push(`${draft.applicationsCount} governed Applications would lose access to Rolling.`)
  }

  if (draft.allowedStrategies.includes('Rolling') && !base.allowedStrategies.includes('Rolling')) {
    newlyAllowed.push(`${draft.applicationsCount} governed Applications would regain access to Rolling.`)
  }

  if (draft.guardrails.dailyDeployQuota > base.guardrails.dailyDeployQuota) {
    newlyAllowed.push(
      `Future deployments could continue until ${draft.guardrails.dailyDeployQuota} deploys in one day are reached.`
    )
  }

  if (validation.errors.length > 0) {
    unchanged.push('Impact preview is partial until blocking review errors are resolved.')
  }

  return { newlyBlocked, newlyAllowed, unchanged }
}

function buildChangeSummary(draft, base) {
  const changes = []

  if (draft.guardrails.dailyDeployQuota !== base.guardrails.dailyDeployQuota) {
    changes.push({
      label: 'Daily deploy quota',
      current: `${base.guardrails.dailyDeployQuota} deploys/day`,
      proposed: `${draft.guardrails.dailyDeployQuota} deploys/day`
    })
  }

  if (formatStrategies(draft.allowedStrategies) !== formatStrategies(base.allowedStrategies)) {
    changes.push({
      label: 'Allowed strategies',
      current: formatStrategies(base.allowedStrategies),
      proposed: formatStrategies(draft.allowedStrategies)
    })
  }

  return changes
}

function buildAuditSummary(draft, base) {
  if (draft.guardrails.dailyDeployQuota !== base.guardrails.dailyDeployQuota) {
    return 'Audit will record the new quota and the operator who changed delivery limits for this Deployment Group.'
  }

  if (formatStrategies(draft.allowedStrategies) !== formatStrategies(base.allowedStrategies)) {
    return 'Audit will record which Applications gained or lost strategy access before the change becomes active.'
  }

  return 'Audit remains quiet until you stage a governance change.'
}

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
          { label: 'Open Applications', to: '/new/applications/payments-api' },
          { label: 'Open Deployments', to: '/new/deployments' },
          { label: 'Open Insights', to: '/new/insights' }
        ]}
      />
      <NewStateBlock
        eyebrow="Blocked access"
        title="Admin access required"
        tone="danger"
        actions={[
          { label: 'Open Applications', to: '/new/applications/payments-api' },
          { label: 'Open Deployments', to: '/new/deployments', secondary: true },
          { label: 'Open Insights', to: '/new/insights', secondary: true }
        ]}
      >
        This area is limited to platform administration. Use Applications, Deployments, or Insights for standard delivery work.
      </NewStateBlock>
    </>
  )
}

function PlatformAdminAdminPage({ role, scenario }) {
  const [baseGroup, setBaseGroup] = useState(BASE_GROUP)
  const [draftGroup, setDraftGroup] = useState(buildDraftForScenario(scenario))
  const [mode, setMode] = useState(scenario === 'default' ? 'view' : 'review')
  const [warningAcknowledged, setWarningAcknowledged] = useState(false)
  const [saveNote, setSaveNote] = useState('')

  useEffect(() => {
    setBaseGroup(BASE_GROUP)
    setDraftGroup(buildDraftForScenario(scenario))
    setMode(scenario === 'default' ? 'view' : 'review')
    setWarningAcknowledged(false)
    setSaveNote('')
  }, [scenario])

  const validation = useMemo(
    () => buildValidation(draftGroup, scenario),
    [draftGroup, scenario]
  )
  const impactPreview = useMemo(
    () => buildImpactPreview(draftGroup, baseGroup, validation),
    [draftGroup, baseGroup, validation]
  )
  const changeSummary = useMemo(
    () => buildChangeSummary(draftGroup, baseGroup),
    [draftGroup, baseGroup]
  )
  const hasChanges = changeSummary.length > 0
  const saveBlockedByScenario = scenario === 'blocked-save'
  const saveRequiresWarningAcknowledgement = validation.warnings.length > 0 && scenario === 'warnings'
  const canSave =
    mode === 'review' &&
    hasChanges &&
    validation.errors.length === 0 &&
    !saveBlockedByScenario &&
    (!saveRequiresWarningAcknowledgement || warningAcknowledged)

  function handleQuotaChange(event) {
    const nextValue = Number(event.target.value)
    setSaveNote('')
    setDraftGroup((current) => ({
      ...current,
      guardrails: {
        ...current.guardrails,
        dailyDeployQuota: Number.isNaN(nextValue) ? 0 : nextValue
      }
    }))
  }

  function handleRollingToggle(event) {
    const checked = event.target.checked
    setSaveNote('')
    setDraftGroup((current) => ({
      ...current,
      allowedStrategies: checked
        ? ['Blue-Green', 'Rolling']
        : current.allowedStrategies.filter((strategy) => strategy !== 'Rolling')
    }))
  }

  function startEdit() {
    setSaveNote('')
    setMode('edit')
  }

  function moveToReview() {
    setSaveNote('')
    setMode('review')
  }

  function returnToEdit() {
    setSaveNote('')
    setMode('edit')
  }

  function handleSave() {
    if (!canSave) return
    setBaseGroup(draftGroup)
    setMode('view')
    setSaveNote('Deployment Group saved. Future deployments now use the reviewed quota and strategy access rules.')
  }

  const primaryAction = (() => {
    if (mode === 'view') {
      return {
        label: 'Edit',
        state: 'available',
        onClick: startEdit,
        description: 'Enter edit mode for this Deployment Group.'
      }
    }

    if (mode === 'edit') {
      return {
        label: 'Review changes',
        state: hasChanges ? 'available' : 'disabled',
        onClick: moveToReview,
        disabled: !hasChanges,
        description: 'Open the review step before save.'
      }
    }

    return {
      label: 'Save',
      state: saveBlockedByScenario || validation.errors.length > 0 ? 'blocked' : canSave ? 'available' : 'disabled',
      onClick: handleSave,
      disabled: !canSave,
      description: 'Save becomes available only after review is complete.'
    }
  })()

  const actionNote = (() => {
    if (mode === 'view') {
      return 'Admin objects stay read-first. Enter Edit before DXCP exposes review and save actions.'
    }
    if (mode === 'edit') {
      return 'Review changes before save so impact, warnings, and blocked outcomes stay visible before mutation.'
    }
    if (saveBlockedByScenario) {
      return 'Save is blocked before mutation because DXCP is in read-only mode. Review remains visible so you can understand the impact without attempting a failed save.'
    }
    if (validation.errors.length > 0) {
      return 'Save is blocked before mutation. Resolve the blocking review errors and return to this review step.'
    }
    if (saveRequiresWarningAcknowledgement && !warningAcknowledged) {
      return 'Warnings do not block this change, but acknowledgement is required before Save becomes available.'
    }
    return 'Review stays visible before save so the policy impact remains explicit, not implied.'
  })()
  const alertRailItems = useMemo(
    () => [
      {
        id: `admin-${mode}-${scenario}`,
        tone:
          saveBlockedByScenario || validation.errors.length > 0
            ? 'danger'
            : saveRequiresWarningAcknowledgement && !warningAcknowledged
              ? 'warning'
              : 'neutral',
        title:
          saveBlockedByScenario || validation.errors.length > 0
            ? 'Save blocked'
            : saveRequiresWarningAcknowledgement && !warningAcknowledged
              ? 'Warnings to review'
              : mode === 'view'
                ? 'Read-first posture'
                : mode === 'edit'
                  ? 'Review required before save'
                  : 'Review before save',
        body: actionNote
      }
    ],
    [
      actionNote,
      mode,
      saveBlockedByScenario,
      saveRequiresWarningAcknowledgement,
      scenario,
      validation.errors.length,
      warningAcknowledged
    ]
  )

  useNewExperienceAlertRail(alertRailItems)

  return (
    <div className="new-admin-page">
      <NewExperiencePageHeader
        title="Admin"
        objectIdentity="Deployment Group: Payments Core"
        role={role}
        stateSummaryItems={[
          { label: 'Workspace', value: 'Deployment Groups' },
          { label: 'Mode', value: mode === 'view' ? 'Inspect' : mode === 'edit' ? 'Edit' : 'Review' },
          { label: 'Pending changes', value: hasChanges ? `${changeSummary.length}` : 'None' }
        ]}
        primaryAction={primaryAction}
        secondaryActions={[
          mode !== 'view'
            ? { label: 'Back to edit', onClick: returnToEdit, disabled: mode !== 'review' }
            : { label: 'Open Applications', to: '/new/applications/payments-api' },
          { label: 'Open Legacy Admin', to: '/admin' }
        ]}
      />

      <div className="new-admin-layout">
        <div className="new-admin-primary">
          {saveNote ? (
            <NewExplanation title="Save complete" tone="neutral">
              {saveNote}
            </NewExplanation>
          ) : null}

          <SectionCard className="new-admin-card">
            <div className="new-section-header">
              <div>
                <h3>Governance object</h3>
                <p className="helper">This selected Deployment Group keeps Admin object-first instead of collapsing into a generic settings list.</p>
              </div>
              <div className="links">
                <Link className="link secondary" to="/new/deployments">
                  Open Deployments
                </Link>
              </div>
            </div>

            <dl className="new-object-summary-grid" aria-label="Deployment Group summary">
              <dt>Deployment Group</dt>
              <dd>{baseGroup.name}</dd>
              <dt>Owner</dt>
              <dd>{baseGroup.owner}</dd>
              <dt>Applications governed</dt>
              <dd>{baseGroup.applicationsCount}</dd>
              <dt>Environments</dt>
              <dd>{baseGroup.environments.join(', ')}</dd>
              <dt>Allowed strategies</dt>
              <dd>{formatStrategies(baseGroup.allowedStrategies)}</dd>
              <dt>Current deploy quota</dt>
              <dd>{baseGroup.guardrails.dailyDeployQuota} deploys/day</dd>
              <dt>Current rollback quota</dt>
              <dd>{baseGroup.guardrails.dailyRollbackQuota} rollbacks/day</dd>
              <dt>Last changed</dt>
              <dd>{baseGroup.lastChanged}</dd>
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
                  {baseGroup.description}
                </NewExplanation>
                <NewExplanation title="Current impact" tone="neutral">
                  One active deployment at a time. Rolling remains allowed. Current running deployments stay unchanged until a future deployment is requested.
                </NewExplanation>
              </div>
            ) : (
              <div className="new-admin-edit-grid">
                <label className="new-field">
                  <span>Daily deploy quota</span>
                  <input
                    aria-label="Daily deploy quota"
                    type="number"
                    value={draftGroup.guardrails.dailyDeployQuota}
                    onChange={handleQuotaChange}
                    readOnly={mode === 'review'}
                  />
                </label>
                <label className="new-field">
                  <span>Daily rollback quota</span>
                  <input
                    aria-label="Daily rollback quota"
                    type="number"
                    value={draftGroup.guardrails.dailyRollbackQuota}
                    readOnly
                  />
                </label>
                <label className="new-field new-field-full">
                  <span>Allowed strategies</span>
                  <div className="new-admin-checkbox-row">
                    <label className="new-admin-checkbox">
                      <input checked disabled type="checkbox" />
                      <span>Blue-Green</span>
                    </label>
                    <label className="new-admin-checkbox">
                      <input
                        aria-label="Rolling"
                        checked={draftGroup.allowedStrategies.includes('Rolling')}
                        onChange={handleRollingToggle}
                        disabled={mode === 'review'}
                        type="checkbox"
                      />
                      <span>Rolling</span>
                    </label>
                  </div>
                </label>
              </div>
            )}

            {mode === 'review' ? (
              <div className="new-admin-review-stack">
                <div className="new-admin-comparison-list" aria-label="Pending change summary">
                  {changeSummary.map((change) => (
                    <div key={change.label} className="new-admin-comparison-row">
                      <strong>{change.label}</strong>
                      <div className="new-admin-comparison-values">
                        <span>Current: {change.current}</span>
                        <span>Proposed: {change.proposed}</span>
                      </div>
                    </div>
                  ))}
                </div>

                {validation.warnings.length > 0 ? (
                  <NewExplanation title="Warnings to review" tone="warning">
                    <ul className="new-admin-message-list">
                      {validation.warnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  </NewExplanation>
                ) : null}

                {validation.errors.length > 0 ? (
                  <NewExplanation title="Errors blocking save" tone="danger">
                    <ul className="new-admin-message-list">
                      {validation.errors.map((error) => (
                        <li key={error}>{error}</li>
                      ))}
                    </ul>
                  </NewExplanation>
                ) : null}

                {saveBlockedByScenario ? (
                  <NewExplanation title="Blocked save explanation" tone="danger">
                    DXCP is currently in read-only mode. Review stays available, but this change cannot be saved until platform mutations are re-enabled.
                  </NewExplanation>
                ) : null}

                {saveRequiresWarningAcknowledgement ? (
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
                  {impactPreview.newlyBlocked.length > 0 ? (
                    impactPreview.newlyBlocked.map((item) => <li key={item}>{item}</li>)
                  ) : (
                    <li>No newly blocked behavior is predicted.</li>
                  )}
                </ul>
              </div>
              <div>
                <strong>Newly allowed</strong>
                <ul className="new-supporting-list">
                  {impactPreview.newlyAllowed.length > 0 ? (
                    impactPreview.newlyAllowed.map((item) => <li key={item}>{item}</li>)
                  ) : (
                    <li>No newly allowed behavior is predicted.</li>
                  )}
                </ul>
              </div>
            </div>

            <div className="new-explanation-stack">
              <NewExplanation title="Unchanged" tone="neutral">
                <ul className="new-admin-message-list">
                  {impactPreview.unchanged.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </NewExplanation>
            </div>
          </SectionCard>

          <SectionCard className="new-admin-card">
            <h3>Validation summary</h3>
            <p className="helper">Warnings and errors differ in both meaning and consequence.</p>
            <dl className="new-application-support-grid">
              <dt>Warnings</dt>
              <dd>{validation.warnings.length}</dd>
              <dt>Errors</dt>
              <dd>{validation.errors.length}</dd>
              <dt>Save posture</dt>
              <dd>{saveBlockedByScenario ? 'Blocked before mutation' : canSave ? 'Ready after review' : 'Needs review'}</dd>
            </dl>
          </SectionCard>

          <SectionCard className="new-admin-card">
            <h3>Audit and review discipline</h3>
            <div className="new-explanation-stack">
              <NewExplanation title="Audit visibility" tone="neutral">
                {buildAuditSummary(draftGroup, baseGroup)}
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

export default function NewExperienceAdminPage({ role = 'UNKNOWN' }) {
  const { scenario = 'default' } = useParams()
  const normalizedScenario =
    ['default', 'review', 'warnings', 'errors', 'blocked-save'].includes(scenario) ? scenario : 'default'

  if (role === 'PLATFORM_ADMIN') {
    return <PlatformAdminAdminPage role={role} scenario={normalizedScenario} />
  }

  return <BlockedAdminState role={role} />
}
