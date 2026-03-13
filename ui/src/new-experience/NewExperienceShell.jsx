import React from 'react'
import { NavLink } from 'react-router-dom'

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
            <NavLink to="/new/deployments">Deployments</NavLink>
            <NavLink to="/new/insights">Insights</NavLink>
            <NavLink to="/new/admin">Admin</NavLink>
            <NavLink to="/services">Back to Legacy</NavLink>
          </nav>
        </div>
      </header>

      <div className="new-shell-alert-rail" aria-live="polite">
        <div className="new-shell-frame">
          <div className="new-shell-alert-card" role="note">
            <strong>New experience preview.</strong>
            <span>This route stays contained under <code>/new/*</code> while the current legacy experience remains available.</span>
          </div>
        </div>
      </div>

      <main className="new-shell-page" role="main">
        <div className="new-shell-frame">
          <section className="new-shell-primary-region">{children}</section>
        </div>
      </main>
    </div>
  )
}
