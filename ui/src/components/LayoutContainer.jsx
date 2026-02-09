import React from 'react'

export default function LayoutContainer({ children, className = '' }) {
  const classes = ['layout-container', className].filter(Boolean).join(' ')
  return <div className={classes}>{children}</div>
}
