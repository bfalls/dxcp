import React from 'react'

export default function AppShell({
  view,
  setView,
  services,
  loadServices,
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
  return (
    <div className="app">
      <header className="header">
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
          <button
            className={view === 'services' ? 'active' : ''}
            data-testid="nav-services"
            onClick={() => setView('services')}
          >
            Services
          </button>
          <button
            className={view === 'deploy' ? 'active' : ''}
            data-testid="nav-deploy"
            onClick={() => setView('deploy')}
          >
            Deploy
          </button>
          <button
            className={view === 'deployments' ? 'active' : ''}
            onClick={() => {
              setView('deployments')
              refreshDeployments()
            }}
          >
            Deployments
          </button>
          <button
            className={view === 'detail' ? 'active' : ''}
            onClick={() => {
              setView('detail')
              if (services.length === 0) loadServices()
            }}
          >
            Detail
          </button>
          <button
            className={view === 'insights' ? 'active' : ''}
            onClick={() => {
              setView('insights')
              loadInsights()
            }}
          >
            Insights
          </button>
          <button className={view === 'settings' ? 'active' : ''} onClick={() => setView('settings')}>
            Settings
          </button>
          <button className={view === 'admin' ? 'active' : ''} onClick={() => setView('admin')}>
            Admin
          </button>
        </nav>
      </header>
      {children}
    </div>
  )
}
