import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { createAuth0Client } from '@auth0/auth0-spa-js'
import { createApiClient } from './apiClient.js'
import { clampRefreshIntervalSeconds, getUserSettingsKey, loadUserSettings, saveUserSettings } from './settings.js'

const ENV = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : {}
const DEFAULT_API_BASE = (ENV.VITE_API_BASE || 'http://localhost:8000').replace(/\/$/, '')
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
let sharedUiConfigPromise = null
let sharedUiConfig = null

function normalizeApiBase(value) {
  if (!value) return `${DEFAULT_API_BASE}/v1`
  const trimmed = value.replace(/\/$/, '')
  return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`
}

async function loadUiConfig() {
  if (typeof window !== 'undefined' && window.__DXCP_AUTH0_CONFIG__) {
    return window.__DXCP_AUTH0_CONFIG__
  }
  if (sharedUiConfig) return sharedUiConfig
  if (!sharedUiConfigPromise) {
    sharedUiConfigPromise = (async () => {
      try {
        const response = await fetch('/config.json', { cache: 'no-store' })
        if (!response.ok) return null
        return await response.json()
      } catch (err) {
        return null
      }
    })()
  }
  const config = await sharedUiConfigPromise
  sharedUiConfig = config
  return config
}

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
  if (import.meta?.env?.DEV && typeof window !== 'undefined' && window.__DXCP_AUTH0_RESET__) {
    sharedAuthInitPromise = null
    sharedAuthResult = null
    sharedAuthError = null
    sharedRedirectCode = null
    sharedUiConfigPromise = null
    sharedUiConfig = null
    window.__DXCP_AUTH0_RESET__ = false
  }
  const [authClient, setAuthClient] = useState(null)
  const [authReady, setAuthReady] = useState(false)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [user, setUser] = useState(null)
  const [authError, setAuthError] = useState('')
  const [accessToken, setAccessToken] = useState('')
  const [authAudience, setAuthAudience] = useState(AUTH0_AUDIENCE)
  const [apiBase, setApiBase] = useState(normalizeApiBase(DEFAULT_API_BASE))
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
  const [servicesView, setServicesView] = useState([])
  const [servicesViewLoading, setServicesViewLoading] = useState(false)
  const [servicesViewError, setServicesViewError] = useState('')
  const [serviceDetailName, setServiceDetailName] = useState('')
  const [serviceDetailTab, setServiceDetailTab] = useState('overview')
  const [serviceDetailStatus, setServiceDetailStatus] = useState(null)
  const [serviceDetailHistory, setServiceDetailHistory] = useState([])
  const [serviceDetailFailures, setServiceDetailFailures] = useState([])
  const [serviceDetailLoading, setServiceDetailLoading] = useState(false)
  const [serviceDetailError, setServiceDetailError] = useState('')
  const [publicSettings, setPublicSettings] = useState({
    default_refresh_interval_seconds: 300,
    min_refresh_interval_seconds: 60,
    max_refresh_interval_seconds: 3600
  })
  const [adminSettings, setAdminSettings] = useState(null)
  const [userSettingsKey, setUserSettingsKey] = useState('')
  const [userSettings, setUserSettings] = useState(null)
  const [userSettingsLoaded, setUserSettingsLoaded] = useState(false)
  const [refreshMinutesInput, setRefreshMinutesInput] = useState('')
  const [refreshClampNote, setRefreshClampNote] = useState('')
  const [refreshInputError, setRefreshInputError] = useState('')

  const validVersion = useMemo(() => VERSION_RE.test(version), [version])
  const contextService = selected?.service || service
  const findDeliveryGroup = useCallback(
    (serviceName) =>
      deliveryGroups.find((group) => Array.isArray(group.services) && group.services.includes(serviceName)) || null,
    [deliveryGroups]
  )
  const currentDeliveryGroup = useMemo(() => {
    if (!contextService) return null
    return findDeliveryGroup(contextService)
  }, [contextService, findDeliveryGroup])
  const decodedToken = useMemo(() => decodeJwt(accessToken), [accessToken])
  const derivedRoles = decodedToken?.[rolesClaim] || []
  const serviceDetailGroup = useMemo(() => {
    if (!serviceDetailName) return null
    return findDeliveryGroup(serviceDetailName)
  }, [serviceDetailName, findDeliveryGroup])
  const serviceDetailLatest = serviceDetailStatus?.latest || null
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
  const minRefreshSeconds = publicSettings.min_refresh_interval_seconds || 60
  const maxRefreshSeconds = publicSettings.max_refresh_interval_seconds || 3600
  const defaultRefreshSeconds = publicSettings.default_refresh_interval_seconds || 300
  const rawRefreshSeconds = userSettings?.refresh_interval_seconds ?? defaultRefreshSeconds
  const { value: refreshIntervalSeconds, reason: refreshIntervalClamp } = useMemo(
    () => clampRefreshIntervalSeconds(rawRefreshSeconds, minRefreshSeconds, maxRefreshSeconds),
    [rawRefreshSeconds, minRefreshSeconds, maxRefreshSeconds]
  )
  const refreshIntervalMinutes = Math.round(refreshIntervalSeconds / 60)

  const getAccessToken = useCallback(async () => {
    if (!authClient || !isAuthenticated) return null
    return authClient.getTokenSilently({
      authorizationParams: { audience: authAudience }
    })
  }, [authClient, isAuthenticated, authAudience])

  const api = useMemo(() => createApiClient({ baseUrl: apiBase, getToken: getAccessToken }), [apiBase, getAccessToken])

  const getRuntimeConfig = useCallback(async () => {
    const config = await loadUiConfig()
    if (config && config.auth0) {
      return {
        domain: config.auth0.domain,
        clientId: config.auth0.clientId,
        audience: config.auth0.audience,
        rolesClaim: config.auth0.rolesClaim,
        apiBase: config.apiBase
      }
    }
    if (config) {
      return {
        domain: config.auth0Domain || config.domain || AUTH0_DOMAIN,
        clientId: config.auth0ClientId || config.clientId || AUTH0_CLIENT_ID,
        audience: config.auth0Audience || config.audience || AUTH0_AUDIENCE,
        rolesClaim: config.auth0RolesClaim || config.rolesClaim || ROLES_CLAIM,
        apiBase: config.apiBase || DEFAULT_API_BASE
      }
    }
    return {
      domain: AUTH0_DOMAIN,
      clientId: AUTH0_CLIENT_ID,
      audience: AUTH0_AUDIENCE,
      rolesClaim: ROLES_CLAIM,
      apiBase: DEFAULT_API_BASE
    }
  }, [])

  const ensureAuthClient = useCallback(async () => {
    if (authClient) return authClient
    const runtimeConfig = await getRuntimeConfig()
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
      const runtimeConfig = await getRuntimeConfig()
      if (!runtimeConfig.domain || !runtimeConfig.clientId || !runtimeConfig.audience) {
        if (active) {
          setAuthError('Auth0 configuration is missing.')
          setAuthReady(true)
        }
        return
      }
      if (runtimeConfig.apiBase) {
        setApiBase(normalizeApiBase(runtimeConfig.apiBase))
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
      const list = Array.isArray(data) ? data : []
      setDeliveryGroups(list)
      return list
    } catch (err) {
      if (isLoginRequiredError(err)) return
      setDeliveryGroups([])
    }
    return []
  }

  async function loadServicesList() {
    setServicesViewError('')
    setServicesViewLoading(true)
    try {
      const data = await api.get('/services')
      const list = Array.isArray(data) ? data : []
      const groups = deliveryGroups.length > 0 ? deliveryGroups : await loadDeliveryGroups()
      const statusResults = await Promise.allSettled(
        list.map((svc) => api.get(`/services/${encodeURIComponent(svc.service_name)}/delivery-status`))
      )
      const rows = list.map((svc, idx) => {
        const status = statusResults[idx].status === 'fulfilled' ? statusResults[idx].value : null
        const latest = status?.latest || null
        const group =
          groups.find((entry) => Array.isArray(entry.services) && entry.services.includes(svc.service_name)) || null
        return {
          name: svc.service_name,
          deliveryGroup: group?.name || 'Unassigned',
          latestVersion: latest?.version || '-',
          latestState: latest?.state || '-',
          updatedAt: latest?.updatedAt || latest?.createdAt || '',
          latestDeploymentId: latest?.id || ''
        }
      })
      rows.sort((a, b) => a.name.localeCompare(b.name))
      setServicesView(rows)
    } catch (err) {
      if (isLoginRequiredError(err)) return
      setServicesView([])
      setServicesViewError('Failed to load services')
    } finally {
      setServicesViewLoading(false)
    }
  }

  async function loadServiceDetail(serviceName) {
    if (!serviceName) return
    setServiceDetailError('')
    setServiceDetailLoading(true)
    try {
      const [status, deployments] = await Promise.all([
        api.get(`/services/${encodeURIComponent(serviceName)}/delivery-status`),
        api.get(`/deployments?service=${encodeURIComponent(serviceName)}`)
      ])
      const history = Array.isArray(deployments) ? deployments : []
      const latest = status?.latest || history[0] || null
      setServiceDetailStatus(status || null)
      setServiceDetailHistory(history)
      if (latest?.id) {
        const failures = await api.get(`/deployments/${latest.id}/failures`)
        setServiceDetailFailures(Array.isArray(failures) ? failures : [])
      } else {
        setServiceDetailFailures([])
      }
    } catch (err) {
      if (isLoginRequiredError(err)) return
      setServiceDetailStatus(null)
      setServiceDetailHistory([])
      setServiceDetailFailures([])
      setServiceDetailError('Failed to load service detail')
    } finally {
      setServiceDetailLoading(false)
    }
  }

  async function loadPublicSettings() {
    try {
      const data = await api.get('/settings/public')
      if (!data || data.code) return
      setPublicSettings({
        default_refresh_interval_seconds: data.default_refresh_interval_seconds ?? 300,
        min_refresh_interval_seconds: data.min_refresh_interval_seconds ?? 60,
        max_refresh_interval_seconds: data.max_refresh_interval_seconds ?? 3600
      })
    } catch (err) {
      if (isLoginRequiredError(err)) return
    }
  }

  async function loadAdminSettings() {
    try {
      const data = await api.get('/settings/admin')
      if (!data || data.code) return
      setAdminSettings({
        default_refresh_interval_seconds: data.default_refresh_interval_seconds ?? 300,
        min_refresh_interval_seconds: data.min_refresh_interval_seconds ?? 60,
        max_refresh_interval_seconds: data.max_refresh_interval_seconds ?? 3600
      })
    } catch (err) {
      if (isLoginRequiredError(err)) return
      setAdminSettings(null)
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

  function handleRefreshMinutesChange(value) {
    setRefreshMinutesInput(value)
    setRefreshInputError('')
    if (value.trim() === '') {
      setRefreshInputError('Enter a number.')
      return
    }
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) {
      setRefreshInputError('Enter a number.')
      return
    }
    const minutes = Math.floor(parsed)
    if (minutes <= 0) {
      setRefreshInputError('Enter a positive number.')
      return
    }
    const seconds = minutes * 60
    const { value: clampedSeconds, reason } = clampRefreshIntervalSeconds(
      seconds,
      minRefreshSeconds,
      maxRefreshSeconds
    )
    if (userSettingsKey) {
      saveUserSettings(userSettingsKey, { refresh_interval_seconds: clampedSeconds })
    }
    setUserSettings({ refresh_interval_seconds: clampedSeconds })
    setRefreshClampNote(reason ? `Clamped to admin ${reason}.` : '')
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
    if (!authReady || !isAuthenticated) return
    loadPublicSettings()
    if (isPlatformAdmin) {
      loadAdminSettings()
    } else {
      setAdminSettings(null)
    }
  }, [authReady, isAuthenticated, isPlatformAdmin])

  useEffect(() => {
    if (!isAuthenticated) {
      setUserSettingsKey('')
      setUserSettings(null)
      setUserSettingsLoaded(false)
      setRefreshMinutesInput('')
      setRefreshClampNote('')
      setRefreshInputError('')
      return
    }
    const key = getUserSettingsKey(user, decodedToken)
    setUserSettingsKey(key)
    const stored = loadUserSettings(key)
    setUserSettings(stored)
    setUserSettingsLoaded(true)
  }, [isAuthenticated, user, decodedToken])

  useEffect(() => {
    if (!userSettingsLoaded) return
    const seconds = userSettings?.refresh_interval_seconds ?? defaultRefreshSeconds
    const minutes = Math.round(seconds / 60)
    setRefreshMinutesInput(String(minutes))
  }, [userSettingsLoaded, userSettings, defaultRefreshSeconds])

  useEffect(() => {
    if (!userSettingsLoaded || !userSettingsKey || !userSettings) return
    const rawSeconds = userSettings.refresh_interval_seconds
    const { value: clampedSeconds, reason } = clampRefreshIntervalSeconds(
      rawSeconds,
      minRefreshSeconds,
      maxRefreshSeconds
    )
    if (clampedSeconds !== rawSeconds) {
      saveUserSettings(userSettingsKey, { refresh_interval_seconds: clampedSeconds })
      setUserSettings({ refresh_interval_seconds: clampedSeconds })
      setRefreshClampNote(reason ? `Clamped to admin ${reason}.` : '')
    } else {
      setRefreshClampNote('')
    }
  }, [userSettingsLoaded, userSettingsKey, userSettings, minRefreshSeconds, maxRefreshSeconds])

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
        setServicesView([])
        setServicesViewError('')
        setServiceDetailName('')
        setServiceDetailStatus(null)
        setServiceDetailHistory([])
        setServiceDetailFailures([])
        setServiceDetailError('')
        setPublicSettings({
          default_refresh_interval_seconds: 300,
          min_refresh_interval_seconds: 60,
          max_refresh_interval_seconds: 3600
        })
        setAdminSettings(null)
        setUserSettingsKey('')
        setUserSettings(null)
        setUserSettingsLoaded(false)
        setRefreshMinutesInput('')
        setRefreshClampNote('')
        setRefreshInputError('')
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
    const intervalMs = Math.max(refreshIntervalSeconds, 1) * 1000
    const tick = () => {
      if (cancelled) return
      if (typeof document !== 'undefined' && document.hidden) return
      loadVersions()
    }
    const interval = setInterval(tick, intervalMs)
    const onVisibility = () => {
      if (typeof document !== 'undefined' && !document.hidden) tick()
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibility)
    }
    return () => {
      cancelled = true
      clearInterval(interval)
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility)
      }
    }
  }, [view, service, isAuthenticated, refreshIntervalSeconds])

  useEffect(() => {
    if (!isAuthenticated || view !== 'detail' || !selected?.id) return undefined
    let cancelled = false
    const intervalMs = Math.max(refreshIntervalSeconds, 1) * 1000
    const tick = async () => {
      if (cancelled) return
      if (typeof document !== 'undefined' && document.hidden) return
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
    }
    const interval = setInterval(tick, intervalMs)
    const onVisibility = () => {
      if (typeof document !== 'undefined' && !document.hidden) tick()
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibility)
    }
    return () => {
      cancelled = true
      clearInterval(interval)
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility)
      }
    }
  }, [view, selected?.id, isAuthenticated, refreshIntervalSeconds])

  useEffect(() => {
    if (!isAuthenticated || view !== 'insights') return
    loadInsights()
  }, [view, isAuthenticated])

  useEffect(() => {
    if (!authReady || !isAuthenticated || view !== 'services') return
    loadServicesList()
  }, [authReady, isAuthenticated, view])

  useEffect(() => {
    if (!authReady || !isAuthenticated || view !== 'service' || !serviceDetailName) return
    loadServiceDetail(serviceDetailName)
  }, [authReady, isAuthenticated, view, serviceDetailName])

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
          <button className={view === 'services' ? 'active' : ''} onClick={() => setView('services')}>
            Services
          </button>
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
            <button className={view === 'settings' ? 'active' : ''} onClick={() => setView('settings')}>
              Settings
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
          <div className="card">Loading session...</div>
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

      {authReady && isAuthenticated && view === 'services' && (
        <div className="shell">
          <div className="card" style={{ gridColumn: '1 / -1' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h2>Services</h2>
                <div className="helper">Browse services and their latest delivery status.</div>
              </div>
              <button className="button secondary" onClick={loadServicesList} disabled={servicesViewLoading}>
                {servicesViewLoading ? 'Refreshing...' : 'Refresh'}
              </button>
            </div>
            {servicesViewError && <div className="helper" style={{ marginTop: '8px' }}>{servicesViewError}</div>}
            {servicesViewLoading && <div className="helper" style={{ marginTop: '8px' }}>Loading services...</div>}
            {!servicesViewLoading && servicesView.length === 0 && (
              <div className="helper" style={{ marginTop: '8px' }}>No services registered.</div>
            )}
            {servicesView.length > 0 && (
              <div className="table" style={{ marginTop: '12px' }}>
                <div className="table-row header">
                  <div>Service</div>
                  <div>Delivery group</div>
                  <div>Latest version</div>
                  <div>Latest state</div>
                  <div>Updated</div>
                </div>
                {servicesView.map((row) => (
                  <button
                    key={row.name}
                    className="table-row button-row"
                    onClick={() => {
                      setServiceDetailName(row.name)
                      setServiceDetailTab('overview')
                      setView('service')
                    }}
                  >
                    <div>{row.name}</div>
                    <div>{row.deliveryGroup}</div>
                    <div>{row.latestVersion}</div>
                    <div><span className={statusClass(row.latestState)}>{row.latestState}</span></div>
                    <div>{row.updatedAt ? formatTime(row.updatedAt) : '-'}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {authReady && isAuthenticated && view === 'service' && (
        <div className="shell">
          <div className="card" style={{ gridColumn: '1 / -1' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h2>Service detail</h2>
                <div className="helper">{serviceDetailName || 'Unknown service'}</div>
              </div>
              <button className="button secondary" onClick={() => setView('services')}>
                Back to services
              </button>
            </div>
            <div className="tabs" style={{ marginTop: '12px' }}>
              {['overview', 'deploy', 'history', 'failures', 'insights'].map((tab) => (
                <button
                  key={tab}
                  className={serviceDetailTab === tab ? 'active' : ''}
                  onClick={() => setServiceDetailTab(tab)}
                >
                  {tab[0].toUpperCase() + tab.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {serviceDetailError && (
            <div className="card" style={{ gridColumn: '1 / -1' }}>
              {serviceDetailError}
            </div>
          )}

          {serviceDetailLoading && (
            <div className="card" style={{ gridColumn: '1 / -1' }}>
              Loading service detail...
            </div>
          )}

          {!serviceDetailLoading && serviceDetailTab === 'overview' && (
            <>
              <div className="card">
                <h2>Latest delivery status</h2>
                {serviceDetailLatest ? (
                  <div>
                    <div className={statusClass(serviceDetailLatest.state)}>
                      {serviceDetailLatest.state}
                    </div>
                    <p>Version: {serviceDetailLatest.version || '-'}</p>
                    <p>Updated: {formatTime(serviceDetailLatest.updatedAt || serviceDetailLatest.createdAt)}</p>
                    {serviceDetailLatest.rollbackOf && (
                      <p>Rollback of: {serviceDetailLatest.rollbackOf}</p>
                    )}
                    <div className="links" style={{ marginTop: '8px' }}>
                      <button
                        className="button secondary"
                        onClick={() => openDeployment({ id: serviceDetailLatest.id })}
                      >
                        Open deployment detail
                      </button>
                      {serviceDetailLatest.spinnakerExecutionUrl && (
                        <a
                          className="link"
                          href={serviceDetailLatest.spinnakerExecutionUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open in Spinnaker
                        </a>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="helper">No deployments recorded yet.</div>
                )}
              </div>
              <div className="card">
                <h2>Delivery group</h2>
                {serviceDetailGroup ? (
                  <>
                    <p>{serviceDetailGroup.name}</p>
                    <div className="helper">Owner: {serviceDetailGroup.owner || 'Unassigned'}</div>
                    <div className="guardrails" style={{ marginTop: '12px' }}>
                      <div className="helper" style={{ marginBottom: '6px' }}>Guardrails</div>
                      <div className="list">
                        <div className="list-item">
                          <div>Max concurrent deployments</div>
                          <div>{serviceDetailGroup.guardrails?.max_concurrent_deployments || '-'}</div>
                        </div>
                        <div className="list-item">
                          <div>Daily deploy quota</div>
                          <div>{serviceDetailGroup.guardrails?.daily_deploy_quota || '-'}</div>
                        </div>
                        <div className="list-item">
                          <div>Daily rollback quota</div>
                          <div>{serviceDetailGroup.guardrails?.daily_rollback_quota || '-'}</div>
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="helper">Service is not assigned to a delivery group.</div>
                )}
              </div>
            </>
          )}

          {!serviceDetailLoading && serviceDetailTab === 'deploy' && (
            <div className="card" style={{ gridColumn: '1 / -1' }}>
              <h2>Deploy</h2>
              <div className="helper">
                Deployment intent stays in the Deploy view for now.
              </div>
              <button
                className="button secondary"
                style={{ marginTop: '12px' }}
                onClick={() => {
                  if (serviceDetailName) setService(serviceDetailName)
                  setView('deploy')
                }}
              >
                Go to Deploy
              </button>
            </div>
          )}

          {!serviceDetailLoading && serviceDetailTab === 'history' && (
            <div className="card" style={{ gridColumn: '1 / -1' }}>
              <h2>Deployment history</h2>
              {serviceDetailHistory.length === 0 && <div className="helper">No deployments yet.</div>}
              {serviceDetailHistory.length > 0 && (
                <div className="table" style={{ marginTop: '12px' }}>
                <div className="table-row header history">
                  <div>State</div>
                  <div>Version</div>
                  <div>Created</div>
                  <div>Deployment</div>
                </div>
                {serviceDetailHistory.map((item) => (
                    <div className="table-row history" key={item.id}>
                      <div><span className={statusClass(item.state)}>{item.state}</span></div>
                      <div>{item.version || '-'}</div>
                      <div>{formatTime(item.createdAt)}</div>
                      <div>
                        <button className="button secondary" onClick={() => openDeployment({ id: item.id })}>
                          Open detail
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {!serviceDetailLoading && serviceDetailTab === 'failures' && (
            <div className="card" style={{ gridColumn: '1 / -1' }}>
              <h2>Latest failures</h2>
              {serviceDetailFailures.length === 0 && <div className="helper">No failures recorded.</div>}
              {serviceDetailFailures.map((failure, idx) => (
                <div key={idx} className="failure">
                  <div><strong>{failure.category}</strong> - {failure.summary}</div>
                  {failure.actionHint && <div className="helper">Next action: {failure.actionHint}</div>}
                  {failure.detail && <div className="helper">Evidence: {failure.detail}</div>}
                  {failure.observedAt && <div className="helper">Observed: {formatTime(failure.observedAt)}</div>}
                </div>
              ))}
            </div>
          )}

          {!serviceDetailLoading && serviceDetailTab === 'insights' && (
            <div className="card" style={{ gridColumn: '1 / -1' }}>
              <h2>Insights</h2>
              <div className="helper">
                Service-level insights are not available yet. Use the Insights view for system-wide trends.
              </div>
            </div>
          )}
        </div>
      )}

      {authReady && isAuthenticated && view === 'deploy' && (
        <div className="shell">
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2>Deploy intent</h2>
              <button className="button secondary" onClick={refreshData} disabled={refreshing}>
                {refreshing ? 'Refreshing...' : 'Refresh data'}
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
                {versions.length === 0 && <option value="__custom__">Custom...</option>}
                {versions.map((item) => (
                  <option key={item.version} value={item.version}>
                    {item.version}
                  </option>
                ))}
                <option value="__custom__">Custom...</option>
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
              {versionsLoading && <div className="helper">Loading versions...</div>}
              {versionsRefreshing && <div className="helper">Refreshing versions...</div>}
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

      {authReady && isAuthenticated && view === 'settings' && (
        <div className="shell">
          <div className="card" style={{ gridColumn: '1 / -1' }}>
            <h2>Settings</h2>
            <div className="helper">Control auto-refresh behavior for the UI.</div>
          </div>
          <div className="card">
            <h2>User settings</h2>
            <div className="field">
              <label htmlFor="refresh-interval-minutes">Auto-refresh interval (minutes)</label>
              <input
                id="refresh-interval-minutes"
                type="number"
                min={Math.ceil(minRefreshSeconds / 60)}
                max={Math.floor(maxRefreshSeconds / 60)}
                step="1"
                value={refreshMinutesInput}
                onChange={(e) => handleRefreshMinutesChange(e.target.value)}
                disabled={!userSettingsKey}
              />
              <div className="helper">Default is {Math.round(defaultRefreshSeconds / 60)} minutes.</div>
              <div className="helper">Applies to versions and deployment detail refresh.</div>
              {refreshInputError && <div className="helper">{refreshInputError}</div>}
              {refreshClampNote && <div className="helper">{refreshClampNote}</div>}
              <div className="helper">Resolved refresh interval: {refreshIntervalMinutes} minutes.</div>
            </div>
          </div>
          {isPlatformAdmin && (
            <div className="card">
              <h2>Admin defaults</h2>
              <div className="helper">Config-driven defaults and guardrails.</div>
              <div className="list" style={{ marginTop: '8px' }}>
                <div className="list-item">
                  <div>Default</div>
                  <div>{Math.round((adminSettings?.default_refresh_interval_seconds ?? defaultRefreshSeconds) / 60)} minutes</div>
                </div>
                <div className="list-item">
                  <div>Minimum</div>
                  <div>{Math.round((adminSettings?.min_refresh_interval_seconds ?? minRefreshSeconds) / 60)} minutes</div>
                </div>
                <div className="list-item">
                  <div>Maximum</div>
                  <div>{Math.round((adminSettings?.max_refresh_interval_seconds ?? maxRefreshSeconds) / 60)} minutes</div>
                </div>
              </div>
            </div>
          )}
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
