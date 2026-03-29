import React from 'react'
import { Link } from 'react-router-dom'

function formatRoleLabel(role) {
  if (role === 'PLATFORM_ADMIN') return ''
  if (role === 'DELIVERY_OWNER') return 'Delivery owner view'
  if (role === 'OBSERVER') return 'Observer view'
  return 'Role unavailable'
}

function getActionStateTitle(state, label) {
  if (state === 'blocked') return `${label} blocked`
  if (state === 'disabled') return `${label} not ready`
  if (state === 'read-only') return 'Read-only access'
  if (state === 'unavailable') return 'Unavailable on this route'
  return 'Action guidance'
}

function getActionStateTone(state) {
  if (state === 'blocked') return 'danger'
  if (state === 'disabled') return 'warning'
  if (state === 'read-only' || state === 'unavailable') return 'neutral'
  return 'neutral'
}

export default function NewExperiencePageHeader({
  title,
  objectIdentity,
  stateSummaryItems = [],
  primaryAction,
  secondaryActions = [],
  role = 'UNKNOWN',
  actionNote = '',
  showRoleNote = true,
  showActionNote = true
}) {
  const hasPrimaryAction = Boolean(primaryAction)
  const primaryActionState = primaryAction?.state || 'available'
  const primaryActionLabel = primaryAction?.label || 'Action'
  const showPrimaryAction = hasPrimaryAction && primaryActionState !== 'unavailable'
  const actionNoteId = hasPrimaryAction && actionNote ? `new-header-note-${title.replace(/\s+/g, '-').toLowerCase()}` : undefined
  const actionStateTitle = getActionStateTitle(primaryActionState, primaryActionLabel)
  const actionStateTone = getActionStateTone(primaryActionState)
  const hasObjectIdentity = Boolean(objectIdentity)
  const hasStateSummary = stateSummaryItems.length > 0
  const hasHeaderActions = secondaryActions.length > 0 || hasPrimaryAction

  return (
    <header className="new-page-header">
      <div className="new-page-header-identity">
        <h1 className={hasObjectIdentity ? 'new-page-header-eyebrow' : 'new-page-header-title'}>{title}</h1>
        {hasObjectIdentity ? <div className="new-page-object-identity">{objectIdentity}</div> : null}
        {showRoleNote && formatRoleLabel(role) ? (
          <div className="new-page-meta-row">
            <div className="new-page-role-note">{formatRoleLabel(role)}</div>
          </div>
        ) : null}
        {hasStateSummary ? (
          <div className="new-page-state-summary" aria-label="State summary">
            {stateSummaryItems.map((item) => (
              <span key={item.label} className="new-page-state-item">
                <span className="new-page-state-label">{item.label}</span>
                <span className="new-page-state-value">{item.value || '\u00A0'}</span>
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {hasHeaderActions ? (
        <div className="new-page-header-actions" aria-label="Header actions">
          <div className="new-page-secondary-actions">
            {secondaryActions.map((action) => (
              action.to ? (
                <Link
                  key={action.label}
                  className="button secondary"
                  to={action.to}
                  title={action.description || ''}
                >
                  {action.label}
                </Link>
              ) : (
                <button
                  key={action.label}
                  className="button secondary"
                  type="button"
                  onClick={action.onClick}
                  disabled={action.disabled}
                  title={action.description || ''}
                >
                  {action.label}
                </button>
              )
            ))}
          </div>
          <div className="new-page-primary-action-group">
            {showPrimaryAction ? (
              primaryActionState === 'read-only' ? (
                <div className="new-page-read-only-action" aria-describedby={actionNoteId}>
                  <span className="new-page-read-only-label">{primaryAction.label}</span>
                  <span className="new-page-read-only-value">Read-only</span>
                </div>
              ) : (
                <button
                  className={`button new-page-primary-action${
                    primaryActionState === 'blocked' ? ' new-page-primary-action-blocked' : ''
                  }`}
                  type="button"
                  onClick={primaryAction.onClick}
                  disabled={primaryActionState === 'blocked' || primaryActionState === 'disabled' || primaryAction.disabled}
                  aria-disabled={primaryActionState === 'blocked' ? 'true' : undefined}
                  aria-describedby={actionNoteId}
                  title={primaryAction.description || ''}
                >
                  {primaryAction.label}
                </button>
              )
            ) : (
              hasPrimaryAction ? <div className="new-page-unavailable-action">Unavailable on this route</div> : null
            )}
          </div>
        </div>
      ) : null}
      {actionNoteId ? <span id={actionNoteId} className="visually-hidden">{actionNote}</span> : null}
      {showActionNote && actionNote && hasPrimaryAction ? (
        <div className="new-page-header-note">
          <div className={`new-page-header-note-inline new-page-header-note-inline-${actionStateTone}`}>
            <strong>{actionStateTitle}</strong>
            <span>{actionNote}</span>
          </div>
        </div>
      ) : null}
    </header>
  )
}
