import React from 'react'
import { NavLink } from 'react-router-dom'
import SectionCard from '../components/SectionCard.jsx'

export const NEW_EXPERIENCE_MAX_WIDTH_PX = 1200

export default function NewExperienceShell({ children }) {
  return (
    <div className="new-shell" style={{ '--new-shell-max-width': `${NEW_EXPERIENCE_MAX_WIDTH_PX}px` }}>
      <header className="new-shell-top-nav">
        <div className="new-shell-frame new-shell-top-nav-inner">
          <div className="new-shell-brand">
            <strong>DXCP</strong>
            <span>New Experience Preview</span>
          </div>
          <nav className="new-shell-nav-links" aria-label="New experience navigation">
            <NavLink to="/new/applications/payments-api">Applications</NavLink>
            <NavLink to="/services">Back to Legacy</NavLink>
          </nav>
        </div>
      </header>

      <div className="new-shell-alert-rail" aria-live="polite">
        <div className="new-shell-frame">
          <SectionCard className="new-shell-alert-card">
            <strong>Preview mode. </strong>
            You are in the opt-in DXCP new experience shell.
          </SectionCard>
        </div>
      </div>

      <main className="new-shell-page" role="main">
        <div className="new-shell-frame">
          <div className="new-shell-page-frame">
            <section className="new-shell-primary-region">{children}</section>
            <aside className="new-shell-supporting-region">
              <SectionCard>
                <h3>Supporting Context</h3>
                <p className="helper">Reserved shell-level supporting region for later slices.</p>
              </SectionCard>
            </aside>
          </div>
        </div>
      </main>
    </div>
  )
}
