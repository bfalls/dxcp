import React from 'react'
import NewQuietIconButton from './NewQuietIconButton.jsx'

export default function NewRefreshButton({ onClick, disabled = false, busy = false, label = 'Refresh' }) {
  return (
    <NewQuietIconButton
      label={label}
      onClick={onClick}
      disabled={disabled}
      icon="refresh"
      className={busy ? 'is-busy' : ''}
    />
  )
}
