import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { createAuth0Client } from '@auth0/auth0-spa-js'
import { createApiClient } from './apiClient.js'

const ENV = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : {}
const API_BASE = (ENV.VITE_API_BASE || 'http://localhost:8000').replace(/\/$/, '') + '/v1'
const AUTH0_DOMAIN = ENV.VITE_AUTH0_DOMAIN || ''
const AUTH0_CLIENT_ID = ENV.VITE_AUTH0_CLIENT_ID || ''
const AUTH0_AUDIENCE = ENV.VITE_AUTH0_AUDIENCE || ''
const ROLES_CLAIM = ENV.VITE_AUTH0_ROLES_CLAIM || 'https://dxcp.example/claims/roles'
const SERVICE_URL_BASE = ENV.VITE_SERVICE_URL_BASE || ''

const VERSION_RE = /^[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.-]+)?$/
const INSIGHTS_WINDOW_DAYS = 7

let sharedAuthInitPromise = null
let sharedAuthResult = null
let sharedAuthError = null
let sharedRedirectCode = null

async function initAuthOnce(runtimeConfig, factory) {
  if (sharedAuthResult) return sharedAuthResult
  if (sharedAuthError) throw sharedAuthError
  if (sharedAuthInitPromise) return sharedAuthInitPromise
  sharedAuthInitPromise = (async () => {
    const client = await factory({
      domain: runtimeConfig.domain,
      clientId: runtimeConfig.clientId,
      cacheLocation: 'localstorage',
      useCookiesForTransactions: true,
      authorizationParams: {
        redirect_uri: window.location.origin,
        audience: runtimeConfig.audience
      }
    })
    const params = new URLSearchParams(window.location.search || '')
    const code = params.get('code')
    const state = params.get('state')
    if (code && state && code !== sharedRedirectCode) {
      sharedRedirectCode = code
      await client.handleRedirectCallback()
      window.history.replaceState({}, document.title, window.location.pathname)
    }
    let token = ''
    let user = null
    try {
      token = await client.getTokenSilently({ authorizationParams: { audience: runtimeConfig.audience } })
      if (token) {
        user = (await client.getUser()) || null
      }
    } catch (err) {
      // Ignore silent auth errors; fall back to isAuthenticated.
    }
    let isAuthenticated = false
    if (token) {
      isAuthenticated = true
    } else {
      isAuthenticated = await client.isAuthenticated()
      if (isAuthenticated) {
        user = (await client.getUser()) || null
      }
    }
    const result = { client, isAuthenticated, user, token }
    sharedAuthResult = result
    return result
  })()
  try {
    return await sharedAuthInitPromise
  } catch (err) {
    sharedAuthError = err
    throw err
  } finally {
    sharedAuthInitPromise = null
  }
}

function decodeJwt(token) {
  if (!token) return null
  const parts = token.split('.')
  if (parts.length < 2) return null
  try {
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const decoded =
      typeof atob === 'function'
        ? atob(payload)
        : Buffer.from(payload, 'base64').toString('utf-8')
    return JSON.parse(decoded)
  } catch (err) {
    return null
  }
}

function isLoginRequiredError(err) {
  return err?.code === 'LOGIN_REQUIRED' || err?.message === 'LOGIN_REQUIRED'
}

function formatTime(value) {
  if (!value) return '-'
  try {
    return new Date(value).toLocaleString()
  } catch (err) {
    return value
  }
}

function formatPercent(value) {
  if (value === null || value === undefined) return '-'
  return `${(value * 100).toFixed(1)}%`
}

function statusClass(state) {
  return `status ${state || ''}`
}

export default function App() {
  const [authClient, setAuthClient] = useState(null)
  const [authReady, setAuthReady] = useState(false)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [user, setUser] = useState(null)
  const [authError, setAuthError] = useState('')
  const [accessToken, setAccessToken] = useState('')
  const [authAudience, setAuthAudience] = useState(AUTH0_AUDIENCE)
  const [rolesClaim, setRolesClaim] = useState(ROLES_CLAIM)
  const [view, setView] = useState('deploy')
  const [services, setServices] = useState([])
  const [service, setService] = useState('')
  const [version, setVersion] = useState('1.0.0')
  const [versionMode, setVersionMode] = useState('custom')
  const [versionSelection, setVersionSelection] = useState('auto')
  const [changeSummary, setChangeSummary] = useState('Initial demo deploy')
  const [deployResult, setDeployResult] = useState(null)
  const [deployments, setDeployments] = useState([])
  const [selected, setSelected] = useState(null)
  const [failures, setFailures] = useState([])
  const [statusMessage, setStatusMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [rollbackResult, setRollbackResult] = useState(null)
  const [recipes, setRecipes] = useState([])
  const [recipeId, setRecipeId] = useState('')
  const [versions, setVersions] = useState([])
  const [versionsLoading, setVersionsLoading] = useState(false)
  const [versionsRefreshing, setVersionsRefreshing] = useState(false)
  const [versionsError, setVersionsError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [timeline, setTimeline] = useState([])
  const [insights, setInsights] = useState(null)
  const [actionInfo, setActionInfo] = useState({
    actions: { view: true, deploy: false, rollback: false },
    loading: true,
    error: ''
  })
  const [deliveryGroups, setDeliveryGroups] = useState([])

  const validVersion = useMemo(() => VERSION_RE.test(version), [version])
  const contextService = selected?.service || service
  const currentDeliveryGroup = useMemo(() => {
    if (!contextService) return null
    return deliveryGroups.find((group) => Array.isArray(group.services) && group.services.includes(contextService)) || null
  }, [deliveryGroups, contextService])
  const decodedToken = useMemo(() => decodeJwt(accessToken), [accessToken])
  const derivedRoles = decodedToken?.[rolesClaim] || []
  // UI-only role display; API permissions are authoritative.
  const derivedRole = Array.isArray(derivedRoles)
    ? derivedRoles.includes('dxcp-platform-admins')
      ? 'PLATFORM_ADMIN'
      : derivedRoles.includes('dxcp-observers')
        ? 'OBSERVER'
        : 'UNKNOWN'
    : 'UNKNOWN'
  const canDeploy = actionInfo.actions?.deploy === true
  const canRollback = actionInfo.actions?.rollback === true
  const isPlatformAdmin = derivedRole === 'PLATFORM_ADMIN'
  const deployDisabledReason = actionInfo.loading
    ? 'Loading access policy.'
    : derivedRole === 'OBSERVER'
      ? 'Observers are read-only.'
      : `Role ${derivedRole} cannot deploy.`
  const rollbackDisabledReason = actionInfo.loading
    ? 'Loading access policy.'
    : derivedRole === 'OBSERVER'
      ? 'Observers are read-only.'
      : `Role ${derivedRole} cannot rollback.`

  const getAccessToken = useCallback(async () => {
    if (!authClient || !isAuthenticated) return null
    return authClient.getTokenSilently({
      authorizationParams: { audience: authAudience }
    })
  }, [authClient, isAuthenticated, authAudience])

  const api = useMemo(() => createApiClient({ baseUrl: API_BASE, getToken: getAccessToken }), [getAccessToken])

  const getRuntimeConfig = useCallback(() => {
    return typeof window !== 'undefined' && window.__DXCP_AUTH0_CONFIG__
      ? window.__DXCP_AUTH0_CONFIG__
      : {
          domain: AUTH0_DOMAIN,
          clientId: AUTH0_CLIENT_ID,
          audience: AUTH0_AUDIENCE,
          rolesClaim: ROLES_CLAIM
        }
  }, [])

  const ensureAuthClient = useCallback(async () => {
    if (authClient) return authClient
    const runtimeConfig = getRuntimeConfig()
    if (!runtimeConfig.domain || !runtimeConfig.clientId || !runtimeConfig.audience) {
      throw new Error('Auth0 configuration is missing.')
    }
    const factory =
      typeof window !== 'undefined' && window.__DXCP_AUTH0_FACTORY__
        ? window.__DXCP_AUTH0_FACTORY__
        : createAuth0Client
    const result = await initAuthOnce(runtimeConfig, factory)
    setAuthClient(result.client)
    return result.client
  }, [authClient, getRuntimeConfig])

  const handleLogin = useCallback(async () => {
    try {
      const client = await ensureAuthClient()
      client.loginWithRedirect({
        authorizationParams: { audience: authAudience }
      })
    } catch (err) {
      const message = err?.error_description || err?.error || err?.message || 'Failed to initialize Auth0.'
      setAuthError(message)
    }
  }, [ensureAuthClient, authAudience])

  const handleLogout = useCallback(async () => {
    try {
      const client = await ensureAuthClient()
      sharedAuthResult = null
      sharedAuthError = null
      sharedRedirectCode = null
      client.logout({
        logoutParams: { returnTo: window.location.origin }
      })
    } catch (err) {
      const message = err?.error_description || err?.error || err?.message || 'Failed to initialize Auth0.'
      setAuthError(message)
    }
  }, [ensureAuthClient])

  useEffect(() => {
    let active = true
    async function initAuth() {
      const runtimeConfig = getRuntimeConfig()
      if (!runtimeConfig.domain || !runtimeConfig.clientId || !runtimeConfig.audience) {
        if (active) {
          setAuthError('Auth0 configuration is missing.')
          setAuthReady(true)
        }
        return
      }
      setAuthAudience(runtimeConfig.audience)
      setRolesClaim(runtimeConfig.rolesClaim || ROLES_CLAIM)
      try {
        const factory =
          typeof window !== 'undefined' && window.__DXCP_AUTH0_FACTORY__
            ? window.__DXCP_AUTH0_FACTORY__
            : createAuth0Client
        const result = await initAuthOnce(runtimeConfig, factory)
        if (!active) return
        setAuthClient(result.client)
        setAccessToken(result.token || '')
        setUser(result.user || null)
        setIsAuthenticated(Boolean(result.isAuthenticated))
        setAuthReady(true)
      } catch (err) {
        if (active) {
          const message = err?.error_description || err?.error || err?.message || 'Failed to initialize Auth0.'
          setAuthError(message)
          setAuthReady(true)
        }
      }
    }
    initAuth()
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!authClient || !isAuthenticated) {
      setAccessToken('')
      return
    }
    let cancelled = false
    authClient
      .getTokenSilently({ authorizationParams: { audience: authAudience } })
      .then((token) => {
        if (!cancelled) setAccessToken(token || '')
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [authClient, isAuthenticated, authAudience])

  async function refreshDeployments() {
    setErrorMessage('')
    try {
      const data = await api.get('/deployments')
      setDeployments(Array.isArray(data) ? data : [])
    } catch (err) {
      if (isLoginRequiredError(err)) return
      setErrorMessage('Failed to load deployments')
    }
  }

  async function loadServices() {
    setErrorMessage('')
    try {
      const data = await api.get('/services')
      if (Array.isArray(data)) {
        setServices(data)
        if (!service && data.length > 0) {
          setService(data[0].service_name)
        }
      }
    } catch (err) {
      if (isLoginRequiredError(err)) return
      setErrorMessage('Failed to load services')
    }
  }

  async function loadRecipes() {
    setErrorMessage('')
    try {
      const data = await api.get('/recipes')
      const list = Array.isArray(data) ? data : []
      setRecipes(list)
      if (!recipeId && list.length > 0) {
        setRecipeId(list[0].id)
      }
    } catch (err) {
      if (isLoginRequiredError(err)) return
      setErrorMessage('Failed to load recipes')
    }
  }

  async function loadDeliveryGroups() {
    try {
      const data = await api.get('/delivery-groups')
      setDeliveryGroups(Array.isArray(data) ? data : [])
    } catch (err) {
      if (isLoginRequiredError(err)) return
      setDeliveryGroups([])
    }
  }

  async function loadAllowedActions(serviceName) {
    if (!serviceName) return
    setActionInfo((prev) => ({ ...prev, loading: true, error: '' }))
    try {
      const data = await api.get(`/services/${encodeURIComponent(serviceName)}/allowed-actions`)
      if (data && data.code) {
        setActionInfo({
          actions: { view: true, deploy: false, rollback: false },
          loading: false,
          error: data.message || 'Access check failed'
        })
        return
      }
      setActionInfo({
        actions: data?.actions || { view: true, deploy: false, rollback: false },
        loading: false,
        error: ''
      })
    } catch (err) {
      if (isLoginRequiredError(err)) return
      setActionInfo({
        actions: { view: true, deploy: false, rollback: false },
        loading: false,
        error: 'Access check failed'
      })
    }
  }

  async function loadVersions(refresh = false) {
    if (!service) return
    if (refresh) {
      setVersionsRefreshing(true)
    } else {
      setVersionsLoading(true)
    }
    setVersionsError('')
    try {
      const suffix = refresh ? '?refresh=1' : ''
      const data = await api.get(`/services/${encodeURIComponent(service)}/versions${suffix}`)
      const list = Array.isArray(data?.versions) ? data.versions : []
      setVersions(list)
    } catch (err) {
      if (isLoginRequiredError(err)) return
      setVersionsError('Failed to load versions')
    } finally {
      if (refresh) {
        setVersionsRefreshing(false)
      } else {
        setVersionsLoading(false)
      }
    }
  }

  async function refreshData() {
    setRefreshing(true)
    const tasks = [loadRecipes(), loadVersions(true)]
    await Promise.allSettled(tasks)
    setRefreshing(false)
  }

  async function loadInsights() {
    setErrorMessage('')
    try {
      const data = await api.get(`/insights/failures?windowDays=${INSIGHTS_WINDOW_DAYS}`)
      if (data && data.code) {
        setErrorMessage(`${data.code}: ${data.message}`)
        return
      }
      setInsights(data)
    } catch (err) {
      if (isLoginRequiredError(err)) return
      setErrorMessage('Failed to load insights')
    }
  }

  async function handleDeploy() {
    setErrorMessage('')
    setStatusMessage('')
    setDeployResult(null)
    if (!validVersion) {
      setErrorMessage('Version format is invalid')
      return
    }
    if (!recipeId) {
      setErrorMessage('Recipe is required')
      return
    }
    const key = `deploy-${Date.now()}`
    const payload = {
      service,
      environment: 'sandbox',
      version,
      changeSummary,
      recipeId
    }
    const result = await api.post('/deployments', payload, key)
    if (result && result.code) {
      setErrorMessage(`${result.code}: ${result.message}`)
      return
    }
    setDeployResult(result)
    setStatusMessage(`Deployment created with id ${result.id}`)
    await refreshDeployments()
  }

  async function openDeployment(deployment) {
    setSelected(null)
    setFailures([])
    setRollbackResult(null)
    setTimeline([])
    setErrorMessage('')
    setStatusMessage('')
    try {
      const detail = await api.get(`/deployments/${deployment.id}`)
      if (detail && detail.code) {
        setErrorMessage(`${detail.code}: ${detail.message}`)
        return
      }
      setSelected(detail)
      const failureData = await api.get(`/deployments/${deployment.id}/failures`)
      setFailures(Array.isArray(failureData) ? failureData : [])
      const timelineData = await api.get(`/deployments/${deployment.id}/timeline`)
      setTimeline(Array.isArray(timelineData) ? timelineData : [])
      setView('detail')
    } catch (err) {
      if (isLoginRequiredError(err)) return
      setErrorMessage('Failed to load deployment detail')
    }
  }

  async function handleRollback() {
    if (!selected) return
    setErrorMessage('')
    setStatusMessage('')
    const ok = window.confirm('Confirm rollback?')
    if (!ok) return
    const key = `rollback-${Date.now()}`
    const result = await api.post(`/deployments/${selected.id}/rollback`, {}, key)
    if (result && result.code) {
      setErrorMessage(`${result.code}: ${result.message}`)
      return
    }
    setRollbackResult(result)
    setSelected(result)
    setFailures([])
    setStatusMessage(`Rollback started with id ${result.id}`)
    await refreshDeployments()
  }

  useEffect(() => {
    if (!authReady || !isAuthenticated) return
    loadServices()
    loadRecipes()
    loadDeliveryGroups()
  }, [authReady, isAuthenticated])

  useEffect(() => {
    if (!isAuthenticated) {
      setServices([])
      setService('')
      setRecipes([])
      setRecipeId('')
      setDeployments([])
      setSelected(null)
      setFailures([])
      setTimeline([])
      setInsights(null)
      setActionInfo({
        actions: { view: true, deploy: false, rollback: false },
        loading: true,
        error: ''
      })
    }
  }, [isAuthenticated])

  useEffect(() => {
    if (!isAuthenticated) return
    setVersions([])
    if (service) {
      setVersionSelection('auto')
      loadVersions()
      loadAllowedActions(service)
    }
  }, [service, isAuthenticated])

  useEffect(() => {
    if (versions.length > 0 && versionMode === 'auto') {
      if (versionSelection === 'auto') {
        setVersion(versions[0].version)
      }
    }
  }, [versions, versionMode, versionSelection])

  useEffect(() => {
    if (!isAuthenticated || view !== 'deploy' || !service) return undefined
    let cancelled = false
    const interval = setInterval(() => {
      if (!cancelled) loadVersions()
    }, 60000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [view, service])

  useEffect(() => {
    if (!isAuthenticated || view !== 'detail' || !selected?.id) return undefined
    let cancelled = false
    const interval = setInterval(async () => {
    try {
      const detail = await api.get(`/deployments/${selected.id}`)
      if (!cancelled && detail && !detail.code) {
        setSelected(detail)
        const failureData = await api.get(`/deployments/${selected.id}/failures`)
        setFailures(Array.isArray(failureData) ? failureData : [])
        const timelineData = await api.get(`/deployments/${selected.id}/timeline`)
        setTimeline(Array.isArray(timelineData) ? timelineData : [])
      }
    } catch (err) {
      if (isLoginRequiredError(err)) return
      if (!cancelled) setErrorMessage('Failed to refresh deployment status')
    }
    }, 5000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [view, selected?.id])

  useEffect(() => {
    if (!isAuthenticated || view !== 'insights') return
    loadInsights()
  }, [view, isAuthenticated])

  const selectedService = services.find((s) => s.service_name === selected?.service)
  let serviceUrl = ''
  if (selectedService?.stable_service_url_template) {
    serviceUrl = selectedService.stable_service_url_template
      .replace('{service}', selected?.service || '')
      .replace('{version}', selected?.version || '')
  } else if (SERVICE_URL_BASE && selected) {
    serviceUrl = `${SERVICE_URL_BASE}/${selected.service}`
  }

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
          <button className={view === 'deploy' ? 'active' : ''} onClick={() => setView('deploy')}>
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
          {isPlatformAdmin && (
            <button className={view === 'admin' ? 'active' : ''} onClick={() => setView('admin')}>
              Admin
            </button>
          )}
        </nav>
      </header>

      {errorMessage && (
        <div className="shell">
          <div className="card">{errorMessage}</div>
        </div>
      )}

      {authError && (
        <div className="shell">
          <div className="card">{authError}</div>
        </div>
      )}

      {!authReady && (
        <div className="shell">
          <div className="card">Loading session…</div>
        </div>
      )}

      {authReady && !isAuthenticated && !authError && (
        <div className="shell">
          <div className="card">
            <h2>Login required</h2>
            <div className="helper">Sign in with Auth0 to view services and deployments.</div>
            <button className="button" style={{ marginTop: '12px' }} onClick={handleLogin}>
              Login
            </button>
          </div>
        </div>
      )}

      {authReady && isAuthenticated && view === 'deploy' && (
        <div className="shell">
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2>Deploy intent</h2>
              <button className="button secondary" onClick={refreshData} disabled={refreshing}>
                {refreshing ? 'Refreshing…' : 'Refresh data'}
              </button>
            </div>
            <div className="field">
              <label>Service</label>
              <select
                value={service}
                onFocus={() => {
                  if (services.length === 0) loadServices()
                }}
                onChange={(e) => setService(e.target.value)}
              >
                {services.length === 0 && <option value="">No services registered</option>}
                {services.map((svc) => (
                  <option key={svc.service_name} value={svc.service_name}>
                    {svc.service_name}
                  </option>
                ))}
              </select>
              <div className="helper">Allowlisted services only.</div>
            </div>
            <div className="field">
              <label>Recipe</label>
              <select value={recipeId} onChange={(e) => setRecipeId(e.target.value)}>
                {recipes.length === 0 && <option value="">No recipes registered</option>}
                {recipes.map((recipe) => (
                  <option key={recipe.id} value={recipe.id}>
                    {recipe.name}
                  </option>
                ))}
              </select>
              <div className="helper">Recipe controls the delivery path.</div>
            </div>
            <div className="row">
              <div className="field">
                <label>Environment</label>
                <input value="sandbox" disabled />
                <div className="helper">Single environment for demo safety.</div>
              </div>
            <div className="field">
              <label>Version</label>
              <select
                value={versionMode === 'auto' ? version : '__custom__'}
                onChange={(e) => {
                  if (e.target.value === '__custom__') {
                    setVersionMode('custom')
                    setVersionSelection('user')
                  } else {
                    setVersionMode('auto')
                    setVersion(e.target.value)
                    setVersionSelection('user')
                  }
                }}
                disabled={versions.length === 0}
              >
                {versions.length === 0 && <option value="__custom__">Custom…</option>}
                {versions.map((item) => (
                  <option key={item.version} value={item.version}>
                    {item.version}
                  </option>
                ))}
                <option value="__custom__">Custom…</option>
              </select>
              {versionMode === 'custom' && (
                <input
                  style={{ marginTop: '8px' }}
                  value={version}
                  onChange={(e) => setVersion(e.target.value)}
                  placeholder="Enter a version"
                />
              )}
              <div className="helper">
                  Format: 1.2.3 or 1.2.3-suffix. {validVersion ? 'Valid' : 'Invalid'}
              </div>
              {versionsLoading && <div className="helper">Loading versions…</div>}
              {versionsRefreshing && <div className="helper">Refreshing versions…</div>}
              {versionsError && <div className="helper">{versionsError}</div>}
              {!versionsLoading && !versionsRefreshing && !versionsError && versions.length > 0 && (
                <div className="helper">Latest discovered: {versions[0].version}</div>
              )}
              <div className="helper">
                If no build is registered, DXCP auto-registers s3://&lt;runtime-bucket&gt;/{service}/{service}-{version}.zip.
              </div>
            </div>
            </div>
            <div className="field">
              <label>Change summary</label>
              <input value={changeSummary} onChange={(e) => setChangeSummary(e.target.value)} />
            </div>
            <button
              className="button"
              onClick={handleDeploy}
              disabled={!canDeploy}
              title={!canDeploy ? deployDisabledReason : ''}
            >
              Deploy now
            </button>
            {!canDeploy && (
              <div className="helper" style={{ marginTop: '8px' }}>
                Deploy disabled. {deployDisabledReason}
              </div>
            )}
            {statusMessage && <div className="helper" style={{ marginTop: '12px' }}>{statusMessage}</div>}
          </div>
          <div className="card">
            <h2>Latest deployment</h2>
            {deployResult ? (
              <div>
                <div className={statusClass(deployResult.state)}>{deployResult.state}</div>
                <p>Service: {deployResult.service}</p>
                <p>Version: {deployResult.version}</p>
                <p>Deployment id: {deployResult.id}</p>
                {deployResult.spinnakerExecutionId && <p>Spinnaker execution: {deployResult.spinnakerExecutionId}</p>}
                <button className="button secondary" onClick={() => openDeployment(deployResult)}>
                  View detail
                </button>
              </div>
            ) : (
              <div className="helper">No deployment created yet.</div>
            )}
          </div>
        </div>
      )}

      {authReady && isAuthenticated && view === 'deployments' && (
        <div className="shell">
          <div className="card" style={{ gridColumn: '1 / -1' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2>Recent deployments</h2>
              <button className="button secondary" onClick={refreshDeployments}>Refresh</button>
            </div>
            <div className="list">
              {deployments.length === 0 && <div className="helper">No deployments yet.</div>}
              {deployments.map((d) => (
                <div className="list-item" key={d.id}>
                  <div className={statusClass(d.state)}>{d.state}</div>
                  <div>{d.service}</div>
                  <div>{d.version}</div>
                  <div>{formatTime(d.createdAt)}</div>
                  <button className="button secondary" onClick={() => openDeployment(d)}>
                    Details
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {authReady && isAuthenticated && view === 'detail' && (
        <div className="shell">
          <div className="card">
            <h2>Deployment detail</h2>
            {!selected && <div className="helper">Select a deployment from the list.</div>}
            {selected && (
              <div>
                <div className={statusClass(selected.state)}>{selected.state}</div>
                {statusMessage && <div className="helper" style={{ marginTop: '8px' }}>{statusMessage}</div>}
                <p>Service: {selected.service}</p>
                <p>Version: {selected.version}</p>
                <p>Created: {formatTime(selected.createdAt)}</p>
                <p>Updated: {formatTime(selected.updatedAt)}</p>
                {selected.spinnakerExecutionId && <p>Spinnaker execution: {selected.spinnakerExecutionId}</p>}
                <div className="links">
                  {selected.spinnakerExecutionUrl && (
                    <a className="link" href={selected.spinnakerExecutionUrl} target="_blank" rel="noreferrer">
                      Debug in Spinnaker
                    </a>
                  )}
                  {serviceUrl && (
                    <a className="link" href={serviceUrl} target="_blank" rel="noreferrer">
                      Service URL
                    </a>
                  )}
                </div>
                <button
                  className="button danger"
                  onClick={handleRollback}
                  style={{ marginTop: '12px' }}
                  disabled={!canRollback}
                  title={!canRollback ? rollbackDisabledReason : ''}
                >
                  Rollback
                </button>
                {!canRollback && (
                  <div className="helper" style={{ marginTop: '8px' }}>
                    Rollback disabled. {rollbackDisabledReason}
                  </div>
                )}
                {selected.rollbackOf && (
                  <button className="button secondary" onClick={() => openDeployment({ id: selected.rollbackOf })} style={{ marginTop: '8px' }}>
                    View original deployment
                  </button>
                )}
                {rollbackResult && (
                  <div className="helper" style={{ marginTop: '8px' }}>
                    Rollback created: {rollbackResult.id}
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="card">
            <h2>Timeline</h2>
            <div className="timeline">
              {timeline.length === 0 && <div className="helper">No timeline events available.</div>}
              {timeline.map((step) => (
                <div key={step.key} className="timeline-step active">
                  <strong>{step.label}</strong>
                  <div className="helper">{formatTime(step.occurredAt)}</div>
                  {step.detail && <div className="helper">{step.detail}</div>}
                </div>
              ))}
            </div>
          </div>
          <div className="card">
            <h2>Failures</h2>
            {failures.length === 0 && <div className="helper">No failures reported.</div>}
            {failures.map((f, idx) => (
              <div key={idx} className="failure">
                <div><strong>{f.category}</strong> - {f.summary}</div>
                {f.actionHint && <div className="helper">Next action: {f.actionHint}</div>}
                {f.detail && <div className="helper">Evidence: {f.detail}</div>}
                {f.observedAt && <div className="helper">Observed: {formatTime(f.observedAt)}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {authReady && isAuthenticated && view === 'insights' && (
        <div className="shell">
          <div className="card" style={{ gridColumn: '1 / -1' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2>Insights (last {INSIGHTS_WINDOW_DAYS} days)</h2>
              <button className="button secondary" onClick={loadInsights}>Refresh</button>
            </div>
            {!insights && <div className="helper">No insights yet.</div>}
            {insights && (
              <div className="list">
                <div className="list-item">
                  <div><strong>Rollback rate</strong></div>
                  <div>{formatPercent(insights.rollbackRate)}</div>
                  <div>Deployments: {insights.totalDeployments}</div>
                  <div>Rollbacks: {insights.totalRollbacks}</div>
                </div>
                <div style={{ marginTop: '16px' }}>
                  <strong>Top failure categories</strong>
                  {insights.failuresByCategory?.length === 0 && <div className="helper">No failures in window.</div>}
                  {insights.failuresByCategory?.map((item) => (
                    <div className="list-item" key={item.key}>
                      <div>{item.key}</div>
                      <div>{item.count}</div>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: '16px' }}>
                  <strong>Deployments by recipe</strong>
                  {insights.deploymentsByRecipe?.length === 0 && <div className="helper">No deployments in window.</div>}
                  {insights.deploymentsByRecipe?.map((item) => (
                    <div className="list-item" key={item.key}>
                      <div>{item.key}</div>
                      <div>{item.count}</div>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: '16px' }}>
                  <strong>Deployments by delivery group</strong>
                  {insights.deploymentsByGroup?.length === 0 && <div className="helper">No deployments in window.</div>}
                  {insights.deploymentsByGroup?.map((item) => (
                    <div className="list-item" key={item.key}>
                      <div>{item.key}</div>
                      <div>{item.count}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {authReady && isAuthenticated && view === 'admin' && (
        <div className="shell">
          {!isPlatformAdmin && (
            <div className="card forbidden">
              <h2>403 - Access denied</h2>
              <div className="helper">Your role does not allow access to Admin.</div>
              <button className="button secondary" style={{ marginTop: '12px' }} onClick={() => setView('deploy')}>
                Return to Deploy
              </button>
            </div>
          )}
          {isPlatformAdmin && (
            <>
              <div className="card">
                <h2>Delivery Groups</h2>
                {deliveryGroups.length === 0 && <div className="helper">No delivery groups available.</div>}
                {deliveryGroups.length > 0 && (
                  <div className="list">
                    {deliveryGroups.map((group) => (
                      <div className="list-item" key={group.id}>
                        <div>{group.name}</div>
                        <div>{group.id}</div>
                        <div>{group.owner || 'Unassigned owner'}</div>
                        <div>{Array.isArray(group.services) ? `${group.services.length} services` : '0 services'}</div>
                        <div>{Array.isArray(group.allowed_recipes) ? `${group.allowed_recipes.length} recipes` : '0 recipes'}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="card">
                <h2>Recipes</h2>
                {recipes.length === 0 && <div className="helper">No recipes available.</div>}
                {recipes.length > 0 && (
                  <div className="list">
                    {recipes.map((recipe) => (
                      <div className="list-item" key={recipe.id}>
                        <div>{recipe.name}</div>
                        <div>{recipe.id}</div>
                        <div>{recipe.description || 'No description'}</div>
                        <div>{recipe.deploy_pipeline || 'No deploy pipeline'}</div>
                        <div>{recipe.rollback_pipeline || 'No rollback pipeline'}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      <footer className="footer">
        DXCP UI. Guardrails enforced by the API: allowlist, sandbox only, per-group lock, rate limits, idempotency.
      </footer>
    </div>
  )
}
