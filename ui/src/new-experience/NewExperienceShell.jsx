import React, { createContext, useContext, useState } from 'react'
import { Link, NavLink } from 'react-router-dom'

export const NEW_EXPERIENCE_MAX_WIDTH_PX = 1200

const NewExperienceAlertRailContext = createContext(() => {})

export function useNewExperienceAlertRail(items) {
  const setAlertItems = useContext(NewExperienceAlertRailContext)
  React.useEffect(() => {
    setAlertItems(Array.isArray(items) ? items : [])
    return () => setAlertItems([])
  }, [items, setAlertItems])
}

export default function NewExperienceShell({ children, role = 'UNKNOWN' }) {
  const [pageAlertItems, setPageAlertItems] = useState([])
  const showAdminNav = role === 'PLATFORM_ADMIN'

  return (
    <NewExperienceAlertRailContext.Provider value={setPageAlertItems}>
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
              {showAdminNav ? <NavLink to="/new/admin">Admin</NavLink> : null}
            </nav>
            <div className="new-shell-nav-utility">
              <span className="new-shell-preview-pill">Preview under /new/*</span>
              <Link className="new-shell-legacy-link" to="/services">
                Open Legacy
              </Link>
            </div>
          </div>
        </header>

        {pageAlertItems.length > 0 ? (
          <div className="new-shell-alert-rail" aria-live="polite">
            <div className="new-shell-frame">
              <div className="new-shell-alert-stack">
                {pageAlertItems.map((item) => (
                  <div
                    key={item.id}
                    className={`new-shell-alert-card new-shell-alert-card-${item.tone || 'neutral'}`}
                    role="note"
                  >
                    <strong>{item.title}</strong>
                    <span>{item.body}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        <main className="new-shell-page" role="main">
          <div className="new-shell-frame">
            <section className="new-shell-primary-region">{children}</section>
          </div>
        </main>
      </div>
    </NewExperienceAlertRailContext.Provider>
  )
}
