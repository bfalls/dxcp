import React, { createContext, useContext, useMemo, useState } from 'react'
import { NavLink } from 'react-router-dom'

export const NEW_EXPERIENCE_MAX_WIDTH_PX = 1200

const BASE_ALERT = {
  id: 'preview',
  tone: 'neutral',
  title: 'New experience preview.',
  body: (
    <>
      This route stays contained under <code>/new/*</code> while the current legacy experience remains available.
    </>
  )
}

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
  const alertItems = useMemo(() => [BASE_ALERT, ...pageAlertItems], [pageAlertItems])
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
              <NavLink to="/services">Back to Legacy</NavLink>
            </nav>
          </div>
        </header>

        <div className="new-shell-alert-rail" aria-live="polite">
          <div className="new-shell-frame">
            <div className="new-shell-alert-stack">
              {alertItems.map((item) => (
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

        <main className="new-shell-page" role="main">
          <div className="new-shell-frame">
            <section className="new-shell-primary-region">{children}</section>
          </div>
        </main>
      </div>
    </NewExperienceAlertRailContext.Provider>
  )
}
