import React from 'react'
import { Link } from 'react-router-dom'
import { NewExplanation } from './NewExperienceStatePrimitives.jsx'

function formatRoleLabel(role) {
  if (role === 'PLATFORM_ADMIN') return 'Platform admin'
  if (role === 'DELIVERY_OWNER') return 'Delivery owner'
  if (role === 'OBSERVER') return 'Observer'
  return 'Unknown role'
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
  const showPrimaryAction = primaryActionState !== 'unavailable'
  const actionNoteId = showPrimaryAction && actionNote ? `new-header-note-${title.replace(/\s+/g, '-').toLowerCase()}` : undefined

  return (
    <header className="new-page-header">
      <div className="new-page-header-identity">
        <h2>{title}</h2>
        <div className="new-page-object-identity">{objectIdentity}</div>
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
                disabled={primaryActionState === 'disabled' || primaryAction.disabled}
                aria-disabled={primaryActionState === 'blocked' ? 'true' : undefined}
                aria-describedby={actionNoteId}
                title={primaryAction.description || ''}
              >
                {primaryAction.label}
              </button>
            )
          ) : (
            <div className="new-page-unavailable-action">Not available on this route</div>
          )}
          <div className="new-page-role-note">Role: {formatRoleLabel(role)}</div>
        </div>
      </div>
      {actionNote ? (
        <div className="new-page-header-note">
          <NewExplanation
            title={
              primaryActionState === 'blocked'
                ? 'Deploy blocked'
                : primaryActionState === 'disabled'
                  ? 'Deploy not ready'
                  : primaryActionState === 'read-only'
                    ? 'Read-only access'
                    : 'Action note'
            }
            tone={
              primaryActionState === 'blocked'
                ? 'danger'
                : primaryActionState === 'disabled'
                  ? 'neutral'
                  : 'warning'
            }
          >
            <span id={actionNoteId}>{actionNote}</span>
          </NewExplanation>
        </div>
      ) : null}
    </header>
  )
}
