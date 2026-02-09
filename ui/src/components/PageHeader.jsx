import React from 'react'

export default function PageHeader({ title, subtitle, actions }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <div>
        <h2>{title}</h2>
        {subtitle && <div className="helper">{subtitle}</div>}
      </div>
      {actions}
    </div>
  )
}
