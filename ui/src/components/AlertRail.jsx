import React from 'react'
import LayoutContainer from './LayoutContainer.jsx'
import SectionCard from './SectionCard.jsx'

export default function AlertRail({ errorMessage, errorHeadline, authError, infoItems = [] }) {
  // Message placement rule: global/page-level notices live here; field validation stays inline.
  const normalizedInfo = Array.isArray(infoItems) ? infoItems.filter(Boolean) : []
  const hasAlerts = Boolean(errorMessage || authError || normalizedInfo.length > 0)
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
            {normalizedInfo.map((item, idx) => (
              <SectionCard key={`${item.headline || 'info'}-${idx}`}>
                {item.headline && <strong>{item.headline}. </strong>}
                {item.message}
              </SectionCard>
            ))}
          </div>
        ) : null}
      </LayoutContainer>
    </div>
  )
}
