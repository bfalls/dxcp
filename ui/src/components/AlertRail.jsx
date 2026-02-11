import React from 'react'
import LayoutContainer from './LayoutContainer.jsx'
import SectionCard from './SectionCard.jsx'

export default function AlertRail({ errorMessage, errorHeadline, authError }) {
  const hasAlerts = Boolean(errorMessage || authError)
  return (
    <div className={`alert-rail${hasAlerts ? ' has-alerts' : ''}`} aria-live="polite">
      <LayoutContainer>
        {hasAlerts ? (
          <div className="alert-rail-stack">
            {errorMessage && (
              <SectionCard>
                {errorHeadline && <strong>{errorHeadline}. </strong>}
                {errorMessage}
              </SectionCard>
            )}
            {authError && <SectionCard>{authError}</SectionCard>}
          </div>
        ) : null}
      </LayoutContainer>
    </div>
  )
}
