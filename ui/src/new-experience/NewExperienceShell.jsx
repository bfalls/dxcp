import React, { createContext, useContext, useLayoutEffect, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { getLegacyExperiencePath, saveExperienceChoice } from '../experiencePreference.js'

export const NEW_EXPERIENCE_MAX_WIDTH_PX = 1200

const NewExperienceAlertRailContext = createContext(() => {})
const NewExperiencePageChromeContext = createContext(() => {})
const NewExperienceStickyRailContext = createContext(() => {})

export function useNewExperienceAlertRail(items) {
  const setAlertItems = useContext(NewExperienceAlertRailContext)
  React.useEffect(() => {
    setAlertItems(Array.isArray(items) ? items : [])
    return () => setAlertItems([])
  }, [items, setAlertItems])
}

export function useNewExperiencePageChrome(content) {
  const setPageChrome = useContext(NewExperiencePageChromeContext)
  useLayoutEffect(() => {
    setPageChrome(content || null)
    return () => setPageChrome(null)
  }, [content, setPageChrome])
}

export function useNewExperienceStickyRail(content) {
  const setStickyRail = useContext(NewExperienceStickyRailContext)
  useLayoutEffect(() => {
    setStickyRail(content || null)
    return () => setStickyRail(null)
  }, [content, setStickyRail])
}

function getUserLabel(user) {
  if (!user) return 'Not signed in'
  return user.name || user.nickname || user.email || 'Signed in'
}

export default function NewExperienceShell({
  children,
  role = 'UNKNOWN',
  user = null,
  isAuthenticated = false,
  authReady = false,
  onLogin,
  onLogout
}) {
  const location = useLocation()
  const [pageAlertItems, setPageAlertItems] = useState([])
  const [pageChrome, setPageChrome] = useState(null)
  const [stickyRail, setStickyRail] = useState(null)
  const showAdminNav = role === 'PLATFORM_ADMIN'
  const userLabel = getUserLabel(user)
  const legacyPath = getLegacyExperiencePath(location.pathname, location.search)

  return (
    <NewExperienceAlertRailContext.Provider value={setPageAlertItems}>
      <NewExperiencePageChromeContext.Provider value={setPageChrome}>
      <NewExperienceStickyRailContext.Provider value={setStickyRail}>
        <div className="new-shell" style={{ '--new-shell-max-width': `${NEW_EXPERIENCE_MAX_WIDTH_PX}px` }}>
          <div className="new-shell-sticky-region">
            <header className="new-shell-top-nav">
              <div className="new-shell-frame new-shell-top-nav-inner">
              <div className="new-shell-brand">
                <strong>DXCP</strong>
              </div>
                <nav className="new-shell-nav-links" aria-label="New experience navigation">
                  <NavLink to="/new/applications">Applications</NavLink>
                  <NavLink to="/new/deployments">Deployments</NavLink>
                  <NavLink to="/new/insights">Insights</NavLink>
                  {showAdminNav ? <NavLink to="/new/admin">Admin</NavLink> : null}
                </nav>
                <div className="new-shell-nav-utility">
                  <span className="new-shell-preview-pill">Preview under /new/*</span>
                  <Link
                    className="new-shell-legacy-link"
                    to={legacyPath}
                    onClick={() => saveExperienceChoice('legacy')}
                  >
                    Return to Legacy
                  </Link>
                  <div className="new-shell-user-actions" aria-label="Authenticated user actions">
                    <span className="new-shell-user-label">{authReady ? userLabel : 'Loading session...'}</span>
                    {authReady ? (
                      isAuthenticated ? (
                        <button className="button secondary new-shell-auth-button" type="button" onClick={onLogout}>
                          Logout
                        </button>
                      ) : (
                        <button className="button secondary new-shell-auth-button" type="button" onClick={onLogin}>
                          Login
                        </button>
                      )
                    ) : null}
                  </div>
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

            {stickyRail ? (
              <div className="new-shell-sticky-rail">
                <div className="new-shell-frame">{stickyRail}</div>
              </div>
            ) : null}
          </div>

          {pageChrome ? (
            <div className="new-shell-page-chrome">
              <div className="new-shell-frame">{pageChrome}</div>
            </div>
          ) : null}

          <main className="new-shell-page" role="main">
            <div className="new-shell-frame">
              <section className="new-shell-primary-region">{children}</section>
            </div>
          </main>
        </div>
      </NewExperienceStickyRailContext.Provider>
      </NewExperiencePageChromeContext.Provider>
    </NewExperienceAlertRailContext.Provider>
  )
}
