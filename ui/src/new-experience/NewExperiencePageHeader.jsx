import React from 'react'
import { Link } from 'react-router-dom'
import { NewExplanation } from './NewExperienceStatePrimitives.jsx'

function formatRoleLabel(role) {
  if (role === 'PLATFORM_ADMIN') return 'Platform admin'
  if (role === 'DELIVERY_OWNER') return 'Delivery owner'
  if (role === 'OBSERVER') return 'Observer'
  return 'Unknown role'
}

function getActionStateTitle(state, label) {
  if (state === 'blocked') return `${label} blocked`
  if (state === 'disabled') return `${label} not ready`
  if (state === 'read-only') return 'Read-only access'
  if (state === 'unavailable') return 'Unavailable on this route'
  return 'Action note'
}

function getActionStateTone(state) {
  if (state === 'blocked') return 'danger'
  if (state === 'read-only' || state === 'unavailable') return 'neutral'
  if (state === 'disabled') return 'neutral'
  return 'warning'
}

export default function NewExperiencePageHeader({
  title,
  objectIdentity,
  stateSummaryItems = [],
  primaryAction,
  secondaryActions = [],
  role = 'UNKNOWN',
  actionNote = ''
}) {
  const primaryActionState = primaryAction?.state || 'available'
  const primaryActionLabel = primaryAction?.label || 'Action'
  const showPrimaryAction = primaryActionState !== 'unavailable'
  const actionNoteId = showPrimaryAction && actionNote ? `new-header-note-${title.replace(/\s+/g, '-').toLowerCase()}` : undefined
  const actionStateTitle = getActionStateTitle(primaryActionState, primaryActionLabel)
  const actionStateTone = getActionStateTone(primaryActionState)

  return (
    <header className="new-page-header">
      <div className="new-page-header-identity">
        <h2>{title}</h2>
        <div className="new-page-object-identity">{objectIdentity}</div>
        <div className="new-page-role-note">{formatRoleLabel(role)}</div>
        <div className="new-page-state-summary" aria-label="State summary">
          {stateSummaryItems.map((item) => (
            <span key={item.label} className="new-page-state-item">
              <span className="new-page-state-label">{item.label}</span>
              <span className="new-page-state-value">{item.value}</span>
            </span>
          ))}
        </div>
      </div>

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
                disabled={primaryActionState === 'disabled' || primaryAction.disabled}
                aria-disabled={primaryActionState === 'blocked' ? 'true' : undefined}
                aria-describedby={actionNoteId}
                title={primaryAction.description || ''}
              >
                {primaryAction.label}
              </button>
            )
          ) : (
            <div className="new-page-unavailable-action">Unavailable on this route</div>
          )}
        </div>
      </div>
      {actionNote ? (
        <div className="new-page-header-note">
          <NewExplanation title={actionStateTitle} tone={actionStateTone}>
            <span id={actionNoteId}>{actionNote}</span>
          </NewExplanation>
        </div>
      ) : null}
    </header>
  )
}
