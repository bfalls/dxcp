import React from 'react'

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
  readOnlyNote = ''
}) {
  return (
    <header className="new-page-header">
      <div className="new-page-header-identity">
        <h2>{title}</h2>
        <div className="new-page-object-identity">{objectIdentity}</div>
        <div className="new-page-state-summary" aria-label="State summary">
          {stateSummaryItems.map((item) => (
            <span key={item.label} className="new-page-state-item">
              <span className="new-page-state-label">{item.label}:</span> {item.value}
            </span>
          ))}
        </div>
      </div>

      <div className="new-page-header-actions" aria-label="Header actions">
        <div className="new-page-secondary-actions">
          {secondaryActions.map((action) => (
            <button
              key={action.label}
              className="button secondary"
              type="button"
              disabled={action.disabled}
              title={action.description || ''}
            >
              {action.label}
            </button>
          ))}
        </div>
        <button
          className="button new-page-primary-action"
          type="button"
          disabled={primaryAction.disabled}
          title={primaryAction.description || ''}
        >
          {primaryAction.label}
        </button>
        <div className="new-page-role-note">
          Role: {formatRoleLabel(role)}
          {readOnlyNote ? ` - ${readOnlyNote}` : ''}
        </div>
      </div>
    </header>
  )
}
