import React from 'react'

export default function HeaderStatus({ items = [] }) {
  const cleaned = items.filter((item) => item && item.label && item.value)
  if (cleaned.length === 0) return null
  return (
    <div className="header-status">
      {cleaned.map((item) => (
        <div className="header-status-item" key={`${item.label}-${item.value}`}>
          <span className="header-status-label">{item.label}</span>
          <span>{item.value}</span>
        </div>
      ))}
    </div>
  )
}
