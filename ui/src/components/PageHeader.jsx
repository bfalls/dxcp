import React from 'react'

export default function PageHeader({ title, subtitle, actions, meta, className = '' }) {
  const classes = ['page-header', className].filter(Boolean).join(' ')
  return (
    <div className={classes}>
      <div>
        <h2>{title}</h2>
        {subtitle && <div className="helper">{subtitle}</div>}
      </div>
      {actions || meta ? (
        <div className="page-header-actions">
          {meta ? <div className="page-header-meta">{meta}</div> : null}
          {actions}
        </div>
      ) : null}
    </div>
  )
}
