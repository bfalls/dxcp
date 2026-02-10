import React from 'react'

export default function PageHeader({ title, subtitle, actions, className = '' }) {
  const classes = ['page-header', className].filter(Boolean).join(' ')
  return (
    <div className={classes}>
      <div>
        <h2>{title}</h2>
        {subtitle && <div className="helper">{subtitle}</div>}
      </div>
      {actions ? <div className="page-header-actions">{actions}</div> : null}
    </div>
  )
}
