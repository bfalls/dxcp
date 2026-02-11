import React, { useId } from 'react'

export default function InfoTooltip({ label = 'Info', children, className = '' }) {
  const tooltipId = useId()

  return (
    <span className={`info-tooltip ${className}`.trim()}>
      <button
        type="button"
        className="info-tooltip-button"
        aria-label={label}
        aria-describedby={tooltipId}
      >
        i
      </button>
      <span className="info-tooltip-content" id={tooltipId} role="tooltip">
        {children}
      </span>
    </span>
  )
}
