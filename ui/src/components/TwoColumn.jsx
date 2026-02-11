import React from 'react'

export default function TwoColumn({ header, primary, secondary, footer, className = '' }) {
  const classes = ['two-column-layout', className].filter(Boolean).join(' ')
  return (
    <div className={classes}>
      {header ? <div className="page-header-zone">{header}</div> : null}
      <div className="two-column-primary">{primary}</div>
      <div className="two-column-secondary">{secondary}</div>
      {footer ? <div className="two-column-footer">{footer}</div> : null}
    </div>
  )
}
