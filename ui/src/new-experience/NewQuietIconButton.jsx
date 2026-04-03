import React from 'react'

function RefreshIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 1 1 .908-.417A6 6 0 1 1 8 2z"
        fill="currentColor"
      />
      <path
        d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966a.25.25 0 0 1 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466"
        fill="currentColor"
      />
    </svg>
  )
}

export default function NewQuietIconButton({
  label,
  onClick,
  disabled = false,
  icon = 'refresh',
  className = ''
}) {
  const iconNode = icon === 'refresh' ? <RefreshIcon /> : null

  return (
    <button
      className={`new-quiet-icon-button${className ? ` ${className}` : ''}`}
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
    >
      {iconNode}
    </button>
  )
}
