import React from 'react'

export default function AlertRail({ errorMessage, errorHeadline, authError }) {
  if (!errorMessage && !authError) return null
  return (
    <>
      {errorMessage && (
        <div className="shell">
          <div className="card">
            {errorHeadline && <strong>{errorHeadline}. </strong>}
            {errorMessage}
          </div>
        </div>
      )}
      {authError && (
        <div className="shell">
          <div className="card">{authError}</div>
        </div>
      )}
    </>
  )
}
