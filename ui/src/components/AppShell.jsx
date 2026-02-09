import React from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import LayoutContainer from './LayoutContainer.jsx'

export default function AppShell({
  refreshDeployments,
  loadInsights,
  user,
  isAuthenticated,
  authReady,
  handleLogin,
  handleLogout,
  derivedRole,
  currentDeliveryGroup,
  children
}) {
  const location = useLocation()
  const onDeploymentsClick = () => {
    if (location.pathname.startsWith('/deployments')) {
      refreshDeployments()
    }
  }
  const onInsightsClick = () => {
    if (location.pathname.startsWith('/insights')) {
      loadInsights()
    }
  }
  return (
    <div className="app">
      <header className="header">
        <LayoutContainer className="header-content">
          <div className="brand">
            <h1>DXCP Control Plane</h1>
            <span>Deploy intent, see normalized status, and recover fast.</span>
          </div>
          <div className="context">
            <div className="context-item">
              <span className="context-label">Role</span>
              <span className="context-value">{derivedRole}</span>
            </div>
            {currentDeliveryGroup && (
              <div className="context-item">
                <span className="context-label">Delivery Group</span>
                <span className="context-value">{currentDeliveryGroup.name}</span>
              </div>
            )}
          </div>
          <div className="session">
            <div className="session-user">
              {user?.email || user?.name || (isAuthenticated ? 'Authenticated' : 'Not signed in')}
            </div>
            {isAuthenticated ? (
              <button className="button secondary" onClick={handleLogout}>
                Logout
              </button>
            ) : (
              <button className="button" onClick={handleLogin} disabled={!authReady}>
                Login
              </button>
            )}
          </div>
          <nav className="nav">
            {/* Stable E2E selectors for primary navigation */}
            <NavLink
              className={({ isActive }) => (isActive ? 'active' : '')}
              data-testid="nav-services"
              to="/services"
            >
              Services
            </NavLink>
            <NavLink
              className={({ isActive }) => (isActive ? 'active' : '')}
              data-testid="nav-deploy"
              to="/deploy"
              end
            >
              Deploy
            </NavLink>
            <NavLink
              className={({ isActive }) => (isActive ? 'active' : '')}
              to="/deployments"
              onClick={onDeploymentsClick}
            >
              Deployments
            </NavLink>
            <NavLink
              className={({ isActive }) => (isActive ? 'active' : '')}
              to="/insights"
              end
              onClick={onInsightsClick}
            >
              Insights
            </NavLink>
            <NavLink className={({ isActive }) => (isActive ? 'active' : '')} to="/settings" end>
              Settings
            </NavLink>
            <NavLink className={({ isActive }) => (isActive ? 'active' : '')} to="/admin" end>
              Admin
            </NavLink>
          </nav>
        </LayoutContainer>
      </header>
      <LayoutContainer className="page-body">{children}</LayoutContainer>
    </div>
  )
}
