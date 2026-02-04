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
const BACKSTAGE_BASE_URL = ENV.VITE_BACKSTAGE_BASE_URL || ''

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

const TIMELINE_LABELS = {
  submitted: 'Submitted',
  validated: 'Validated',
  in_progress: 'In progress',
  active: 'Active',
  succeeded: 'Succeeded',
  failed: 'Failed',
  rollback_started: 'Rollback started',
  rollback_failed: 'Rollback failed',
  rollback_succeeded: 'Rollback succeeded'
}

function normalizeTimelineSteps(items) {
  if (!Array.isArray(items)) return []
  const mapped = items.map((item, idx) => {
    const key = item?.key || `step-${idx}`
    const rawLabel = item?.label || ''
    const label = TIMELINE_LABELS[key] || rawLabel || 'Event'
    const occurredAt = item?.occurredAt || ''
    const detail = item?.detail || ''
    return { key, label, occurredAt, detail }
  })
  mapped.sort((a, b) => {
    const at = Date.parse(a.occurredAt || '')
    const bt = Date.parse(b.occurredAt || '')
    if (Number.isNaN(at) && Number.isNaN(bt)) return 0
    if (Number.isNaN(at)) return 1
    if (Number.isNaN(bt)) return -1
    return at - bt
  })
  return mapped
}

function normalizeFailureCategory(value) {
  if (!value) return 'UNKNOWN'
  const raw = String(value).trim().toUpperCase()
  const mapping = {
    INFRA: 'INFRASTRUCTURE',
    INFRASTRUCTURE: 'INFRASTRUCTURE',
    CONFIG: 'CONFIG',
    APP: 'APP',
    POLICY: 'POLICY',
    VALIDATION: 'VALIDATION',
    ARTIFACT: 'ARTIFACT',
    TIMEOUT: 'TIMEOUT',
    ROLLBACK: 'ROLLBACK',
    UNKNOWN: 'UNKNOWN'
  }
  return mapping[raw] || 'UNKNOWN'
}

function failureTone(category) {
  if (category === 'INFRASTRUCTURE' || category === 'TIMEOUT' || category === 'ARTIFACT') return 'danger'
  if (category === 'POLICY' || category === 'VALIDATION' || category === 'CONFIG') return 'warn'
  if (category === 'ROLLBACK') return 'neutral'
  if (category === 'APP') return 'info'
  return 'neutral'
}

function statusClass(state) {
  return `status ${state || ''}`
}

function isSameUtcDay(date, now) {
  return (
    date.getUTCFullYear() === now.getUTCFullYear() &&
    date.getUTCMonth() === now.getUTCMonth() &&
    date.getUTCDate() === now.getUTCDate()
  )
}

function computeQuotaStats(deployments, groupId) {
  if (!groupId) return { deployUsed: 0, rollbackUsed: 0 }
  const now = new Date()
  let deployUsed = 0
  let rollbackUsed = 0
  deployments.forEach((item) => {
    if (!item || item.deliveryGroupId !== groupId || !item.createdAt) return
    const createdAt = new Date(item.createdAt)
    if (Number.isNaN(createdAt.getTime())) return
    if (!isSameUtcDay(createdAt, now)) return
    if (item.rollbackOf) {
      rollbackUsed += 1
    } else {
      deployUsed += 1
    }
  })
  return { deployUsed, rollbackUsed }
}

function applyTemplate(value, serviceName) {
  if (!value) return ''
  if (!serviceName) return value
  return String(value).replace('{service}', serviceName)
}

function parseBackstageRef(ref) {
  if (!ref) return null
  const trimmed = String(ref).trim()
  const parts = trimmed.split(':')
  if (parts.length < 2) return null
  const kind = parts[0].toLowerCase()
  const rest = parts.slice(1).join(':')
  const slash = rest.split('/')
  if (slash.length !== 2) return null
  const namespace = slash[0]
  const name = slash[1]
  if (!namespace || !name) return null
  return { kind, namespace, name }
}

function buildBackstageUrl(ref, explicitUrl, baseUrl) {
  if (explicitUrl) return explicitUrl
  if (!baseUrl || !ref) return ''
  const parsed = parseBackstageRef(ref)
  if (!parsed) return ''
  const trimmedBase = baseUrl.replace(/\/$/, '')
  return `${trimmedBase}/catalog/${parsed.namespace}/${parsed.kind}/${parsed.name}`
}

function buildGroupDraft(group, guardrailDefaults) {
  const guardrails = group?.guardrails || {}
  const defaults = guardrailDefaults || {}
  const defaultDeployQuota = defaults.daily_deploy_quota ?? 25
  const defaultRollbackQuota = defaults.daily_rollback_quota ?? 10
  return {
    id: group?.id || '',
    name: group?.name || '',
    description: group?.description || '',
    owner: group?.owner || '',
    services: Array.isArray(group?.services) ? [...group.services] : [],
    allowed_environments: Array.isArray(group?.allowed_environments) ? [...group.allowed_environments] : ['sandbox'],
    allowed_recipes: Array.isArray(group?.allowed_recipes) ? [...group.allowed_recipes] : [],
    change_reason: '',
    guardrails: {
      max_concurrent_deployments:
        guardrails.max_concurrent_deployments !== undefined && guardrails.max_concurrent_deployments !== null
          ? String(guardrails.max_concurrent_deployments)
          : '1',
      daily_deploy_quota:
        guardrails.daily_deploy_quota !== undefined && guardrails.daily_deploy_quota !== null
          ? String(guardrails.daily_deploy_quota)
          : String(defaultDeployQuota),
      daily_rollback_quota:
        guardrails.daily_rollback_quota !== undefined && guardrails.daily_rollback_quota !== null
          ? String(guardrails.daily_rollback_quota)
          : String(defaultRollbackQuota)
    }
  }
}

function buildRecipeDraft(recipe) {
  return {
    id: recipe?.id || '',
    name: recipe?.name || '',
    description: recipe?.description || '',
    allowed_parameters: Array.isArray(recipe?.allowed_parameters) ? recipe.allowed_parameters.join(', ') : '',
    spinnaker_application: recipe?.spinnaker_application || '',
    deploy_pipeline: recipe?.deploy_pipeline || '',
    rollback_pipeline: recipe?.rollback_pipeline || '',
    status: recipe?.status || 'active',
    change_reason: ''
  }
}

function formatAuditValue(by, at) {
  const who = by || 'Unknown'
  const when = at || 'Unknown'
  return `${who} at ${when}`
}

function parseAllowedParameters(value) {
  if (!value) return []
  const parts = String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  return Array.from(new Set(parts))
}

function recipeStatusLabel(value) {
  const status = String(value || 'active').toLowerCase()
  return status === 'deprecated' ? 'Deprecated' : 'Active'
}

function parseGuardrailValue(value) {
  if (value === null || value === undefined) return null
  const trimmed = String(value).trim()
  if (!trimmed) return null
  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed) || parsed <= 0) return NaN
  return Math.floor(parsed)
}

function summarizeGuardrails(guardrails) {
  if (!guardrails) return 'No guardrails'
  const parts = []
  if (guardrails.max_concurrent_deployments) parts.push(`Max ${guardrails.max_concurrent_deployments}`)
  if (guardrails.daily_deploy_quota) parts.push(`Deploy ${guardrails.daily_deploy_quota}/day`)
  if (guardrails.daily_rollback_quota) parts.push(`Rollback ${guardrails.daily_rollback_quota}/day`)
  return parts.length ? parts.join(' | ') : 'No guardrails'
}

function diffLists(nextList, prevList) {
  const next = new Set(nextList)
  const prev = new Set(prevList)
  const added = [...next].filter((item) => !prev.has(item))
  const removed = [...prev].filter((item) => !next.has(item))
  return { added, removed }
}

function findServiceConflicts(services, groups, currentId) {
  const conflicts = []
  groups.forEach((group) => {
    if (group.id === currentId) return
    const groupServices = Array.isArray(group.services) ? group.services : []
    groupServices.forEach((svc) => {
      if (services.includes(svc)) {
        conflicts.push({ service: svc, groupId: group.id, groupName: group.name })
      }
    })
  })
  return conflicts
}

export default function App() {
  if (typeof window !== 'undefined' && window.__DXCP_AUTH0_RESET__) {
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
  const [changeSummary, setChangeSummary] = useState('')
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
  const [insightsLoading, setInsightsLoading] = useState(false)
  const [insightsError, setInsightsError] = useState('')
  const [insightsWindowDays, setInsightsWindowDays] = useState(INSIGHTS_WINDOW_DAYS)
  const [insightsGroupId, setInsightsGroupId] = useState('')
  const [insightsService, setInsightsService] = useState('')
  const [insightsDefaultsApplied, setInsightsDefaultsApplied] = useState(false)
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
  const [deployInlineMessage, setDeployInlineMessage] = useState('')
  const [policyDeployments, setPolicyDeployments] = useState([])
  const [policyDeploymentsLoading, setPolicyDeploymentsLoading] = useState(false)
  const [policyDeploymentsError, setPolicyDeploymentsError] = useState('')
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
  const [adminTab, setAdminTab] = useState('delivery-groups')
  const [adminGroupId, setAdminGroupId] = useState('')
  const [adminGroupMode, setAdminGroupMode] = useState('view')
  const [adminGroupDraft, setAdminGroupDraft] = useState(buildGroupDraft(null))
  const [adminGroupError, setAdminGroupError] = useState('')
  const [adminGroupNote, setAdminGroupNote] = useState('')
  const [adminGroupSaving, setAdminGroupSaving] = useState(false)
  const [adminGroupValidation, setAdminGroupValidation] = useState(null)
  const [adminGroupConfirmWarning, setAdminGroupConfirmWarning] = useState(false)
  const [adminRecipeId, setAdminRecipeId] = useState('')
  const [adminRecipeMode, setAdminRecipeMode] = useState('view')
  const [adminRecipeDraft, setAdminRecipeDraft] = useState(buildRecipeDraft(null))
  const [adminRecipeError, setAdminRecipeError] = useState('')
  const [adminRecipeNote, setAdminRecipeNote] = useState('')
  const [adminRecipeSaving, setAdminRecipeSaving] = useState(false)
  const [adminRecipeValidation, setAdminRecipeValidation] = useState(null)
  const [adminRecipeConfirmWarning, setAdminRecipeConfirmWarning] = useState(false)
  const [auditEvents, setAuditEvents] = useState([])
  const [auditLoading, setAuditLoading] = useState(false)
  const [auditError, setAuditError] = useState('')

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
  const serviceDetailService = useMemo(
    () => services.find((svc) => svc.service_name === serviceDetailName) || null,
    [services, serviceDetailName]
  )
  const backstageEntityRef = serviceDetailService?.backstage_entity_ref || ''
  const backstageEntityUrl = buildBackstageUrl(
    backstageEntityRef,
    applyTemplate(serviceDetailService?.backstage_entity_url, serviceDetailName),
    BACKSTAGE_BASE_URL
  )
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
  const adminGuardrailDefaults = useMemo(
    () => ({
      daily_deploy_quota: adminSettings?.daily_deploy_quota ?? 25,
      daily_rollback_quota: adminSettings?.daily_rollback_quota ?? 10
    }),
    [adminSettings]
  )
  const adminReadOnly = !isPlatformAdmin
  const rawRefreshSeconds = userSettings?.refresh_interval_seconds ?? defaultRefreshSeconds
  const { value: refreshIntervalSeconds } = useMemo(
    () => clampRefreshIntervalSeconds(rawRefreshSeconds, minRefreshSeconds, maxRefreshSeconds),
    [rawRefreshSeconds, minRefreshSeconds, maxRefreshSeconds]
  )
  const refreshIntervalMinutes = Math.round(refreshIntervalSeconds / 60)
  const filteredRecipes = useMemo(() => {
    if (!currentDeliveryGroup) return []
    const allowed = Array.isArray(currentDeliveryGroup.allowed_recipes) ? currentDeliveryGroup.allowed_recipes : []
    return recipes.filter((recipe) => allowed.includes(recipe.id))
  }, [recipes, currentDeliveryGroup])
  const selectedRecipe = useMemo(
    () => recipes.find((recipe) => recipe.id === recipeId) || null,
    [recipes, recipeId]
  )
  const selectedRecipeDeprecated = selectedRecipe?.status === 'deprecated'
  const policyQuotaStats = useMemo(
    () => computeQuotaStats(policyDeployments, currentDeliveryGroup?.id || ''),
    [policyDeployments, currentDeliveryGroup]
  )
  const timelineSteps = useMemo(() => normalizeTimelineSteps(timeline), [timeline])
  const sortedServiceNames = useMemo(
    () => services.map((svc) => svc.service_name).filter(Boolean).sort((a, b) => a.localeCompare(b)),
    [services]
  )
  const sortedRecipes = useMemo(
    () =>
      recipes
        .slice()
        .sort((a, b) => (a.name || a.id || '').localeCompare(b.name || b.id || '')),
    [recipes]
  )
  const recipeUsageCounts = useMemo(() => {
    const counts = {}
    deliveryGroups.forEach((group) => {
      const allowed = Array.isArray(group.allowed_recipes) ? group.allowed_recipes : []
      allowed.forEach((recipeIdValue) => {
        if (!recipeIdValue) return
        counts[recipeIdValue] = (counts[recipeIdValue] || 0) + 1
      })
    })
    return counts
  }, [deliveryGroups])
  const activeAdminGroup = useMemo(
    () => deliveryGroups.find((group) => group.id === adminGroupId) || null,
    [deliveryGroups, adminGroupId]
  )
  const activeAdminRecipe = useMemo(
    () => recipes.find((recipe) => recipe.id === adminRecipeId) || null,
    [recipes, adminRecipeId]
  )
  const activeAdminRecipeUsage = recipeUsageCounts[adminRecipeId] || 0
  const adminServiceConflicts = useMemo(
    () => findServiceConflicts(adminGroupDraft.services, deliveryGroups, adminGroupDraft.id),
    [adminGroupDraft.services, adminGroupDraft.id, deliveryGroups]
  )
  const adminServiceDiff = useMemo(() => {
    if (adminGroupMode !== 'edit' || !activeAdminGroup) return null
    return diffLists(adminGroupDraft.services, activeAdminGroup.services || [])
  }, [adminGroupMode, adminGroupDraft.services, activeAdminGroup])
  const adminRecipeDiff = useMemo(() => {
    if (adminGroupMode !== 'edit' || !activeAdminGroup) return null
    return diffLists(adminGroupDraft.allowed_recipes, activeAdminGroup.allowed_recipes || [])
  }, [adminGroupMode, adminGroupDraft.allowed_recipes, activeAdminGroup])
  const getRecipeLabel = useCallback(
    (recipeIdValue) => {
      if (!recipeIdValue) return '-'
      const found = recipes.find((recipe) => recipe.id === recipeIdValue)
      return found?.name || recipeIdValue
    },
    [recipes]
  )

  const getAccessToken = useCallback(async () => {
    if (!authClient) return accessToken || null
    const token = await authClient.getTokenSilently({
      authorizationParams: { audience: authAudience }
    })
    return token || accessToken || null
  }, [authClient, authAudience, accessToken])

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
    if (!isAuthenticated) {
      setAccessToken('')
      return
    }
    if (!authClient) return
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
          const nextService = data[0].service_name
          setService(nextService)
          loadAllowedActions(nextService)
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

  async function loadAuditEvents() {
    setAuditError('')
    setAuditLoading(true)
    try {
      const data = await api.get('/audit/events')
      setAuditEvents(Array.isArray(data) ? data : [])
    } catch (err) {
      if (isLoginRequiredError(err)) return
      setAuditError('Failed to load audit events.')
    } finally {
      setAuditLoading(false)
    }
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
        max_refresh_interval_seconds: data.max_refresh_interval_seconds ?? 3600,
        daily_deploy_quota: data.daily_deploy_quota ?? 25,
        daily_rollback_quota: data.daily_rollback_quota ?? 10
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

  async function loadPolicyDeployments() {
    setPolicyDeploymentsError('')
    setPolicyDeploymentsLoading(true)
    try {
      const data = await api.get('/deployments')
      setPolicyDeployments(Array.isArray(data) ? data : [])
    } catch (err) {
      if (isLoginRequiredError(err)) return
      setPolicyDeployments([])
      setPolicyDeploymentsError('Failed to load policy context')
    } finally {
      setPolicyDeploymentsLoading(false)
    }
  }

  function startAdminGroupCreate() {
    setAdminGroupMode('create')
    setAdminGroupId('')
    setAdminGroupDraft(buildGroupDraft(null, adminGuardrailDefaults))
    setAdminGroupError('')
    setAdminGroupNote('')
    setAdminGroupValidation(null)
    setAdminGroupConfirmWarning(false)
  }

  function startAdminGroupEdit(group) {
    if (!group) return
    setAdminGroupMode('edit')
    setAdminGroupId(group.id)
    setAdminGroupDraft(buildGroupDraft(group, adminGuardrailDefaults))
    setAdminGroupError('')
    setAdminGroupNote('')
    setAdminGroupValidation(null)
    setAdminGroupConfirmWarning(false)
  }

  function handleAdminGroupDraftChange(field, value) {
    setAdminGroupDraft((prev) => ({ ...prev, [field]: value }))
  }

  function toggleAdminGroupService(serviceName) {
    setAdminGroupDraft((prev) => {
      const set = new Set(prev.services)
      if (set.has(serviceName)) {
        set.delete(serviceName)
      } else {
        set.add(serviceName)
      }
      return { ...prev, services: Array.from(set) }
    })
  }

  function toggleAdminGroupRecipe(recipeIdValue) {
    setAdminGroupDraft((prev) => {
      const set = new Set(prev.allowed_recipes)
      if (set.has(recipeIdValue)) {
        set.delete(recipeIdValue)
      } else {
        set.add(recipeIdValue)
      }
      return { ...prev, allowed_recipes: Array.from(set) }
    })
  }

  function handleAdminGuardrailChange(key, value) {
    setAdminGroupDraft((prev) => ({
      ...prev,
      guardrails: {
        ...prev.guardrails,
        [key]: value
      }
    }))
  }

  function buildAdminGroupPayload() {
    const guardrails = adminGroupDraft.guardrails || {}
    const parsedGuardrails = {
      max_concurrent_deployments: parseGuardrailValue(guardrails.max_concurrent_deployments),
      daily_deploy_quota: parseGuardrailValue(guardrails.daily_deploy_quota),
      daily_rollback_quota: parseGuardrailValue(guardrails.daily_rollback_quota)
    }
    for (const value of Object.values(parsedGuardrails)) {
      if (Number.isNaN(value)) {
        return { error: 'Guardrails must be positive integers.' }
      }
    }
    const guardrailValues = Object.values(parsedGuardrails).filter((value) => value !== null)
    const guardrailsPayload = guardrailValues.length > 0 ? parsedGuardrails : null
    const payload = {
      id: adminGroupDraft.id.trim(),
      name: adminGroupDraft.name.trim(),
      description: adminGroupDraft.description.trim() || null,
      owner: adminGroupDraft.owner.trim() || null,
      services: adminGroupDraft.services.slice().sort(),
      allowed_environments: adminGroupDraft.allowed_environments.slice().sort(),
      allowed_recipes: adminGroupDraft.allowed_recipes.slice().sort(),
      guardrails: guardrailsPayload
    }
    const changeReason = adminGroupDraft.change_reason.trim()
    if (changeReason) {
      payload.change_reason = changeReason
    }
    if (!payload.id) return { error: 'Delivery group id is required.' }
    if (!payload.name) return { error: 'Delivery group name is required.' }
    if (adminServiceConflicts.length > 0) {
      return {
        error: `Service ${adminServiceConflicts[0].service} already belongs to ${adminServiceConflicts[0].groupName}.`
      }
    }
    return { payload }
  }

  async function validateAdminGroupDraft() {
    if (adminReadOnly) {
      setAdminGroupError('Only Platform Admins can modify this.')
      return
    }
    setAdminGroupError('')
    setAdminGroupValidation(null)
    setAdminGroupConfirmWarning(false)
    const { payload, error } = buildAdminGroupPayload()
    if (error) {
      setAdminGroupError(error)
      return
    }
    try {
      const result = await api.post('/admin/guardrails/validate', payload)
      if (result && result.code) {
        setAdminGroupError(`${result.code}: ${result.message}`)
        return
      }
      setAdminGroupValidation(result)
    } catch (err) {
      if (isLoginRequiredError(err)) return
      setAdminGroupError('Failed to validate guardrails.')
    }
  }

  async function saveAdminGroup() {
    if (adminReadOnly) {
      setAdminGroupError('Only Platform Admins can modify this.')
      return
    }
    setAdminGroupError('')
    setAdminGroupNote('')
    if (adminGroupValidation?.validation_status === 'ERROR') {
      setAdminGroupError('Fix validation errors before saving.')
      return
    }
    if (adminGroupValidation?.validation_status === 'WARNING' && !adminGroupConfirmWarning) {
      setAdminGroupError('Warnings require confirmation before saving.')
      return
    }
    const { payload, error } = buildAdminGroupPayload()
    if (error) {
      setAdminGroupError(error)
      return
    }
    if (!payload) return
    setAdminGroupSaving(true)
    try {
      const result =
        adminGroupMode === 'create'
          ? await api.post('/delivery-groups', payload)
          : await api.put(`/delivery-groups/${encodeURIComponent(payload.id)}`, payload)
      if (result && result.code) {
        setAdminGroupError(`${result.code}: ${result.message}`)
        return
      }
      await loadDeliveryGroups()
      setAdminGroupId(result.id || payload.id)
      setAdminGroupMode('view')
      setAdminGroupDraft(buildGroupDraft(result || payload, adminGuardrailDefaults))
      setAdminGroupNote('Delivery group saved.')
      setAdminGroupValidation(null)
      setAdminGroupConfirmWarning(false)
    } catch (err) {
      if (isLoginRequiredError(err)) return
      setAdminGroupError('Failed to save delivery group.')
    } finally {
      setAdminGroupSaving(false)
    }
  }

  function startAdminRecipeCreate() {
    setAdminRecipeMode('create')
    setAdminRecipeId('')
    setAdminRecipeDraft(buildRecipeDraft(null))
    setAdminRecipeError('')
    setAdminRecipeNote('')
    setAdminRecipeValidation(null)
    setAdminRecipeConfirmWarning(false)
  }

  function startAdminRecipeEdit(recipe) {
    if (!recipe) return
    setAdminRecipeMode('edit')
    setAdminRecipeId(recipe.id)
    setAdminRecipeDraft(buildRecipeDraft(recipe))
    setAdminRecipeError('')
    setAdminRecipeNote('')
    setAdminRecipeValidation(null)
    setAdminRecipeConfirmWarning(false)
  }

  function handleAdminRecipeDraftChange(field, value) {
    setAdminRecipeDraft((prev) => ({ ...prev, [field]: value }))
  }

  function buildAdminRecipePayload() {
    const mappingLocked = adminRecipeMode === 'edit' && activeAdminRecipeUsage > 0 && activeAdminRecipe
    const spinnakerApplication = mappingLocked
      ? activeAdminRecipe.spinnaker_application
      : adminRecipeDraft.spinnaker_application.trim() || null
    const deployPipeline = mappingLocked
      ? activeAdminRecipe.deploy_pipeline
      : adminRecipeDraft.deploy_pipeline.trim() || null
    const rollbackPipeline = mappingLocked
      ? activeAdminRecipe.rollback_pipeline
      : adminRecipeDraft.rollback_pipeline.trim() || null
    const payload = {
      id: adminRecipeDraft.id.trim(),
      name: adminRecipeDraft.name.trim(),
      description: adminRecipeDraft.description.trim() || null,
      allowed_parameters: parseAllowedParameters(adminRecipeDraft.allowed_parameters),
      spinnaker_application: spinnakerApplication,
      deploy_pipeline: deployPipeline,
      rollback_pipeline: rollbackPipeline,
      status: adminRecipeDraft.status === 'deprecated' ? 'deprecated' : 'active'
    }
    const changeReason = adminRecipeDraft.change_reason.trim()
    if (changeReason) {
      payload.change_reason = changeReason
    }
    if (!payload.id) return { error: 'Recipe id is required.' }
    if (!payload.name) return { error: 'Recipe name is required.' }
    const hasAnyPipeline = Boolean(payload.deploy_pipeline) || Boolean(payload.rollback_pipeline)
    if (hasAnyPipeline && !payload.spinnaker_application) {
      return { error: 'Spinnaker application is required when pipelines are set.' }
    }
    if (payload.spinnaker_application && (!payload.deploy_pipeline || !payload.rollback_pipeline)) {
      return { error: 'Deploy and rollback pipelines are required when Spinnaker application is set.' }
    }
    return { payload }
  }

  async function validateAdminRecipeDraft() {
    if (adminReadOnly) {
      setAdminRecipeError('Only Platform Admins can modify this.')
      return
    }
    setAdminRecipeError('')
    setAdminRecipeValidation(null)
    setAdminRecipeConfirmWarning(false)
    const { payload, error } = buildAdminRecipePayload()
    if (error) {
      setAdminRecipeError(error)
      return
    }
    try {
      const result = await api.post('/admin/guardrails/validate', payload)
      if (result && result.code) {
        setAdminRecipeError(`${result.code}: ${result.message}`)
        return
      }
      setAdminRecipeValidation(result)
    } catch (err) {
      if (isLoginRequiredError(err)) return
      setAdminRecipeError('Failed to validate recipe.')
    }
  }

  async function saveAdminRecipe() {
    if (adminReadOnly) {
      setAdminRecipeError('Only Platform Admins can modify this.')
      return
    }
    setAdminRecipeError('')
    setAdminRecipeNote('')
    if (adminRecipeValidation?.validation_status === 'ERROR') {
      setAdminRecipeError('Fix validation errors before saving.')
      return
    }
    if (adminRecipeValidation?.validation_status === 'WARNING' && !adminRecipeConfirmWarning) {
      setAdminRecipeError('Warnings require confirmation before saving.')
      return
    }
    const { payload, error } = buildAdminRecipePayload()
    if (error) {
      setAdminRecipeError(error)
      return
    }
    if (!payload) return
    setAdminRecipeSaving(true)
    try {
      const result =
        adminRecipeMode === 'create'
          ? await api.post('/recipes', payload)
          : await api.put(`/recipes/${encodeURIComponent(payload.id)}`, payload)
      if (result && result.code) {
        setAdminRecipeError(`${result.code}: ${result.message}`)
        return
      }
      await loadRecipes()
      setAdminRecipeId(result.id || payload.id)
      setAdminRecipeMode('view')
      setAdminRecipeDraft(buildRecipeDraft(result || payload))
      setAdminRecipeNote('Recipe saved.')
      setAdminRecipeValidation(null)
      setAdminRecipeConfirmWarning(false)
    } catch (err) {
      if (isLoginRequiredError(err)) return
      setAdminRecipeError('Failed to save recipe.')
    } finally {
      setAdminRecipeSaving(false)
    }
  }

  function handleRefreshMinutesChange(value) {
    const rawValue = String(value ?? '')
    setRefreshMinutesInput(rawValue)
    setRefreshInputError('')
    if (rawValue.trim() === '') {
      setRefreshInputError('Enter a number.')
      return
    }
    const parsed = Number(rawValue)
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
    const resolvedKey = userSettingsKey || getUserSettingsKey(user, decodedToken)
    if (resolvedKey) {
      if (resolvedKey !== userSettingsKey) {
        setUserSettingsKey(resolvedKey)
      }
      saveUserSettings(resolvedKey, { refresh_interval_seconds: clampedSeconds })
    }
    setUserSettings({ refresh_interval_seconds: clampedSeconds })
    setRefreshClampNote(reason ? `Clamped to admin ${reason}.` : '')
  }

  function renderFailures(list, spinnakerUrl) {
    if (!list || list.length === 0) {
      return <div className="helper">No failures reported.</div>
    }
    return (
      <>
        {list.map((failure, idx) => {
          const category = normalizeFailureCategory(failure?.category)
          const tone = failureTone(category)
          const summary = failure?.summary || 'Failure reported.'
          const actionHint = failure?.actionHint || 'Review deployment logs and guardrails.'
          return (
            <div key={idx} className="failure">
              <div className="failure-header">
                <span className={`badge ${tone}`}>{category}</span>
                <span>{summary}</span>
              </div>
              <div className="helper">Suggested action: {actionHint}</div>
              {failure?.detail && <div className="helper">Evidence: {failure.detail}</div>}
              {failure?.observedAt && <div className="helper">Observed: {formatTime(failure.observedAt)}</div>}
            </div>
          )
        })}
        {spinnakerUrl && (
          <div className="links" style={{ marginTop: '12px' }}>
            <a className="link secondary" href={spinnakerUrl} target="_blank" rel="noreferrer">
              Open Spinnaker execution
            </a>
          </div>
        )}
      </>
    )
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
    setInsightsError('')
    setInsightsLoading(true)
    try {
      const params = new URLSearchParams()
      params.set('windowDays', String(insightsWindowDays))
      if (insightsGroupId) params.set('groupId', insightsGroupId)
      if (insightsService) params.set('service', insightsService)
      const data = await api.get(`/insights/failures?${params.toString()}`)
      if (data && data.code) {
        setInsightsError(`${data.code}: ${data.message}`)
        setInsights(null)
        return
      }
      setInsights(data)
    } catch (err) {
      if (isLoginRequiredError(err)) return
      setInsightsError('Failed to load insights')
      setInsights(null)
    } finally {
      setInsightsLoading(false)
    }
  }

  async function handleDeploy() {
    setErrorMessage('')
    setStatusMessage('')
    setDeployResult(null)
    setDeployInlineMessage('')
    if (!validVersion) {
      setErrorMessage('Version format is invalid')
      return
    }
    if (!recipeId) {
      setErrorMessage('Recipe is required')
      return
    }
    if (selectedRecipeDeprecated) {
      setErrorMessage('Selected recipe is deprecated and cannot be used for new deployments.')
      return
    }
    if (!changeSummary.trim()) {
      setErrorMessage('Change summary is required')
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
      const inlineMessages = {
        DEPLOYMENT_LOCKED: 'Deployment lock active for this delivery group.',
        RATE_LIMITED: 'Daily deploy quota exceeded for this delivery group.',
        RECIPE_NOT_ALLOWED: 'Selected recipe is not allowed for this delivery group.',
        RECIPE_DEPRECATED: 'Selected recipe is deprecated and cannot be used for new deployments.',
        SERVICE_NOT_IN_DELIVERY_GROUP: 'Service is not assigned to a delivery group.'
      }
      const inline = inlineMessages[result.code]
      if (inline) {
        setDeployInlineMessage(`${result.code}: ${inline}`)
      } else {
        setErrorMessage(`${result.code}: ${result.message}`)
      }
      return
    }
    setDeployResult(result)
    setStatusMessage(`Deployment created with id ${result.id}`)
    await refreshDeployments()
    await openDeployment(result)
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
    if (!authReady || !isAuthenticated || !isPlatformAdmin) {
      setAuditEvents([])
      setAuditError('')
      setAuditLoading(false)
      return
    }
    if (view === 'admin' && adminTab === 'audit') {
      loadAuditEvents()
    }
  }, [authReady, isAuthenticated, isPlatformAdmin, view, adminTab])

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
    if (isPlatformAdmin) return
    if (adminTab === 'audit') {
      setAdminTab('delivery-groups')
    }
    setAdminGroupMode('view')
    setAdminRecipeMode('view')
    setAdminGroupValidation(null)
    setAdminRecipeValidation(null)
    setAdminGroupConfirmWarning(false)
    setAdminRecipeConfirmWarning(false)
  }, [isPlatformAdmin, adminTab])

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
    const nextValue = String(minutes)
    if (!refreshMinutesInput) {
      setRefreshMinutesInput(nextValue)
      return
    }
    if (userSettings && refreshMinutesInput !== nextValue) {
      setRefreshMinutesInput(nextValue)
    }
  }, [userSettingsLoaded, userSettings, defaultRefreshSeconds, refreshMinutesInput])

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
      setPolicyDeployments([])
      setPolicyDeploymentsError('')
      setPolicyDeploymentsLoading(false)
      setDeployInlineMessage('')
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
    if (!currentDeliveryGroup) {
      setRecipeId('')
      return
    }
    if (filteredRecipes.length === 0) {
      setRecipeId('')
      return
    }
    const allowedIds = filteredRecipes.map((recipe) => recipe.id)
    if (!allowedIds.includes(recipeId)) {
      setRecipeId(allowedIds[0])
    }
  }, [isAuthenticated, currentDeliveryGroup, filteredRecipes, recipeId])

  useEffect(() => {
    if (!isAuthenticated) return
    setVersions([])
    if (service) {
      setVersionSelection('auto')
      loadVersions()
      loadAllowedActions(service)
    }
  }, [service, isAuthenticated, accessToken])

  useEffect(() => {
    if (!isAuthenticated || !service || !accessToken) return
    if (actionInfo.loading) {
      loadAllowedActions(service)
    }
  }, [accessToken, actionInfo.loading, isAuthenticated, service])

  useEffect(() => {
    if (!isPlatformAdmin) return
    if (adminGroupMode === 'create') return
    if (activeAdminGroup) {
      setAdminGroupDraft(buildGroupDraft(activeAdminGroup, adminGuardrailDefaults))
    } else if (!adminGroupId) {
      setAdminGroupDraft(buildGroupDraft(null, adminGuardrailDefaults))
    }
  }, [isPlatformAdmin, activeAdminGroup, adminGroupId, adminGroupMode])

  useEffect(() => {
    if (!isPlatformAdmin) return
    if (adminRecipeMode === 'create') return
    if (activeAdminRecipe) {
      setAdminRecipeDraft(buildRecipeDraft(activeAdminRecipe))
    } else if (!adminRecipeId) {
      setAdminRecipeDraft(buildRecipeDraft(null))
    }
  }, [isPlatformAdmin, activeAdminRecipe, adminRecipeId, adminRecipeMode])

  useEffect(() => {
    if (!isAuthenticated) return
    if (insightsDefaultsApplied) return
    if (isPlatformAdmin) {
      setInsightsGroupId('')
      setInsightsDefaultsApplied(true)
      return
    }
    if (deliveryGroups.length > 0) {
      const fallback = currentDeliveryGroup?.id || deliveryGroups[0]?.id || ''
      setInsightsGroupId(fallback)
      setInsightsDefaultsApplied(true)
    }
  }, [
    isAuthenticated,
    isPlatformAdmin,
    deliveryGroups,
    currentDeliveryGroup?.id,
    insightsDefaultsApplied
  ])

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
    if (!isPlatformAdmin && !insightsDefaultsApplied) return
    loadInsights()
  }, [view, isAuthenticated, insightsDefaultsApplied, isPlatformAdmin])

  useEffect(() => {
    if (!authReady || !isAuthenticated || view !== 'services') return
    loadServicesList()
  }, [authReady, isAuthenticated, view])

  useEffect(() => {
    if (!authReady || !isAuthenticated || view !== 'deploy') return
    loadPolicyDeployments()
  }, [authReady, isAuthenticated, view, currentDeliveryGroup?.id])

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
            <button className={view === 'admin' ? 'active' : ''} onClick={() => setView('admin')}>
              Admin
            </button>
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
              <div className="card">
                <h2>Integrations</h2>
                {!backstageEntityRef && !backstageEntityUrl && (
                  <div className="helper">No integrations configured for this service.</div>
                )}
                {(backstageEntityRef || backstageEntityUrl) && (
                  <div className="list">
                    {backstageEntityRef && (
                      <div className="list-item admin-detail">
                        <div>Backstage entity</div>
                        <div>{backstageEntityRef}</div>
                      </div>
                    )}
                    <div className="list-item admin-detail">
                      <div>Backstage</div>
                      <div>
                        {backstageEntityUrl ? (
                          <a className="link" href={backstageEntityUrl} target="_blank" rel="noreferrer">
                            Open in Backstage
                          </a>
                        ) : (
                          'Not linked'
                        )}
                      </div>
                    </div>
                  </div>
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
                      <div>Recipe</div>
                      <div>Rollback</div>
                      <div>Created</div>
                      <div>Deployment</div>
                    </div>
                    {serviceDetailHistory.map((item) => (
                      <div className="table-row history" key={item.id}>
                        <div><span className={statusClass(item.state)}>{item.state}</span></div>
                        <div>{item.version || '-'}</div>
                        <div>{getRecipeLabel(item.recipeId)}</div>
                        <div>{item.rollbackOf ? <span className="badge neutral">Rollback</span> : '-'}</div>
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
              {renderFailures(serviceDetailFailures, serviceDetailStatus?.latest?.spinnakerExecutionUrl)}
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
              <label htmlFor="deploy-recipe">Recipe</label>
              <select
                id="deploy-recipe"
                value={recipeId}
                onChange={(e) => setRecipeId(e.target.value)}
                disabled={!currentDeliveryGroup || filteredRecipes.length === 0}
              >
                {!currentDeliveryGroup && <option value="">No delivery group assigned</option>}
                {currentDeliveryGroup && filteredRecipes.length === 0 && <option value="">No allowed recipes</option>}
                {filteredRecipes.map((recipe) => (
                  <option key={recipe.id} value={recipe.id}>
                    {recipe.name}
                    {recipe.status === 'deprecated' ? ' (deprecated)' : ''}
                  </option>
                ))}
              </select>
              <div className="helper">Recipes are filtered by delivery group policy.</div>
              {selectedRecipeDeprecated && (
                <div className="helper">Selected recipe is deprecated and cannot be used for new deployments.</div>
              )}
            </div>
            <div className="row">
              <div className="field">
                <label>Environment</label>
                <input value="sandbox" disabled />
                <div className="helper">Single environment for controlled rollout.</div>
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
              <label htmlFor="change-summary">Change summary</label>
              <input
                id="change-summary"
                value={changeSummary}
                onChange={(e) => setChangeSummary(e.target.value)}
                onInput={(e) => setChangeSummary(e.target.value)}
              />
              {!changeSummary.trim() && <div className="helper">Required for audit trails.</div>}
            </div>
            <button
              className="button"
              onClick={handleDeploy}
              disabled={!canDeploy || !recipeId || !changeSummary.trim() || !validVersion || selectedRecipeDeprecated}
              title={!canDeploy ? deployDisabledReason : ''}
            >
              Deploy now
            </button>
            {!canDeploy && (
              <div className="helper" style={{ marginTop: '8px' }}>
                Deploy disabled. {deployDisabledReason}
              </div>
            )}
            {canDeploy && !changeSummary.trim() && (
              <div className="helper" style={{ marginTop: '8px' }}>
                Change summary is required.
              </div>
            )}
            {deployInlineMessage && (
              <div className="helper" style={{ marginTop: '8px' }}>
                {deployInlineMessage}
              </div>
            )}
            {statusMessage && <div className="helper" style={{ marginTop: '12px' }}>{statusMessage}</div>}
          </div>
          <div className="card">
            <h2>Policy context</h2>
            {!currentDeliveryGroup && <div className="helper">Service is not assigned to a delivery group.</div>}
            {currentDeliveryGroup && (
              <>
                <div className="list">
                  <div className="list-item">
                    <div>Delivery group</div>
                    <div>{currentDeliveryGroup.name}</div>
                  </div>
                  <div className="list-item">
                    <div>Owner</div>
                    <div>{currentDeliveryGroup.owner || 'Unassigned'}</div>
                  </div>
                </div>
                <div className="helper" style={{ marginTop: '12px' }}>Guardrails</div>
                <div className="list">
                  <div className="list-item">
                    <div>Max concurrent deployments</div>
                    <div>{currentDeliveryGroup.guardrails?.max_concurrent_deployments || '-'}</div>
                  </div>
                  <div className="list-item">
                    <div>Daily deploy quota</div>
                    <div>{currentDeliveryGroup.guardrails?.daily_deploy_quota || '-'}</div>
                  </div>
                  <div className="list-item">
                    <div>Deploys remaining today</div>
                    <div>
                      {currentDeliveryGroup.guardrails?.daily_deploy_quota
                        ? Math.max(currentDeliveryGroup.guardrails.daily_deploy_quota - policyQuotaStats.deployUsed, 0)
                        : '-'}
                    </div>
                  </div>
                  <div className="list-item">
                    <div>Daily rollback quota</div>
                    <div>{currentDeliveryGroup.guardrails?.daily_rollback_quota || '-'}</div>
                  </div>
                  <div className="list-item">
                    <div>Rollbacks remaining today</div>
                    <div>
                      {currentDeliveryGroup.guardrails?.daily_rollback_quota
                        ? Math.max(currentDeliveryGroup.guardrails.daily_rollback_quota - policyQuotaStats.rollbackUsed, 0)
                        : '-'}
                    </div>
                  </div>
                </div>
                {policyDeploymentsLoading && <div className="helper" style={{ marginTop: '8px' }}>Loading quota usage...</div>}
                {policyDeploymentsError && <div className="helper" style={{ marginTop: '8px' }}>{policyDeploymentsError}</div>}
                <div className="helper" style={{ marginTop: '12px' }}>Recipe</div>
                <div className="list">
                  <div className="list-item">
                    <div>Selected</div>
                    <div>{selectedRecipe?.name || 'None'}</div>
                  </div>
                  <div className="list-item">
                    <div>Description</div>
                    <div>{selectedRecipe?.description || 'No description'}</div>
                  </div>
                </div>
              </>
            )}
          </div>
          <div className="card" style={{ gridColumn: '1 / -1' }}>
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
              {timelineSteps.length === 0 && <div className="helper">No timeline events available.</div>}
              {timelineSteps.map((step) => (
                <div key={step.key} className="timeline-step active">
                  <strong>{step.label}</strong>
                  <div className="helper">Event time: {formatTime(step.occurredAt)}</div>
                  {step.detail && <div className="helper">{step.detail}</div>}
                </div>
              ))}
            </div>
          </div>
          <div className="card">
            <h2>Failures</h2>
            {renderFailures(failures, selected?.spinnakerExecutionUrl)}
          </div>
        </div>
      )}

      {authReady && isAuthenticated && view === 'insights' && (
        <div className="shell">
          <div className="card" style={{ gridColumn: '1 / -1' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2>Insights</h2>
              <button className="button secondary" onClick={loadInsights} disabled={insightsLoading}>
                {insightsLoading ? 'Refreshing...' : 'Refresh'}
              </button>
            </div>
            <div className="row" style={{ marginTop: '12px' }}>
              <div className="field">
                <label htmlFor="insights-service">Service</label>
                <select
                  id="insights-service"
                  value={insightsService}
                  onChange={(e) => setInsightsService(e.target.value)}
                >
                  <option value="">All services</option>
                  {sortedServiceNames.map((svc) => (
                    <option key={svc} value={svc}>{svc}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="insights-group">Delivery group</label>
                <select
                  id="insights-group"
                  value={insightsGroupId}
                  onChange={(e) => setInsightsGroupId(e.target.value)}
                >
                  <option value="">All delivery groups</option>
                  {deliveryGroups.map((group) => (
                    <option key={group.id} value={group.id}>{group.name}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="insights-window">Time window (days)</label>
                <select
                  id="insights-window"
                  value={String(insightsWindowDays)}
                  onChange={(e) => setInsightsWindowDays(Number(e.target.value))}
                >
                  {[7, 14, 30].map((value) => (
                    <option key={value} value={value}>{value}</option>
                  ))}
                </select>
              </div>
              <div className="field" style={{ alignSelf: 'flex-end' }}>
                <button className="button secondary" onClick={loadInsights} disabled={insightsLoading}>
                  Apply filters
                </button>
              </div>
            </div>
            {insightsError && <div className="helper" style={{ marginTop: '8px' }}>{insightsError}</div>}
            {!insights && !insightsLoading && !insightsError && (
              <div className="helper">No insights available for the selected filters.</div>
            )}
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
                onInput={(e) => handleRefreshMinutesChange(e.target.value)}
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
          <div className="card" style={{ gridColumn: '1 / -1' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2>Admin</h2>
              {adminReadOnly && <div className="helper">Only Platform Admins can modify this.</div>}
            </div>
            <div className="tabs" style={{ marginTop: '12px' }}>
              <button
                className={adminTab === 'delivery-groups' ? 'active' : ''}
                onClick={() => setAdminTab('delivery-groups')}
              >
                Delivery Groups
              </button>
              <button
                className={adminTab === 'recipes' ? 'active' : ''}
                onClick={() => setAdminTab('recipes')}
              >
                Recipes
              </button>
              {isPlatformAdmin && (
                <button
                  className={adminTab === 'audit' ? 'active' : ''}
                  onClick={() => setAdminTab('audit')}
                >
                  Audit
                </button>
              )}
            </div>
          </div>
          {adminTab === 'delivery-groups' && (
            <>
              <div className="card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <h2>Delivery groups</h2>
                      <button className="button secondary" onClick={startAdminGroupCreate} disabled={adminReadOnly}>
                        Create group
                      </button>
                    </div>
                    {deliveryGroups.length === 0 && <div className="helper">No delivery groups available.</div>}
                    {deliveryGroups.length > 0 && (
                      <div className="list" style={{ marginTop: '12px' }}>
                        {deliveryGroups.map((group) => (
                          <div className="list-item admin-group" key={group.id}>
                            <div>
                              <strong>{group.name}</strong>
                              <div className="helper">{group.id}</div>
                            </div>
                            <div>{group.owner || 'Unassigned owner'}</div>
                            <div>{Array.isArray(group.services) ? `${group.services.length} services` : '0 services'}</div>
                            <div>{summarizeGuardrails(group.guardrails)}</div>
                            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                                <button
                                  className="button secondary"
                                  onClick={() => {
                                    setAdminGroupMode('view')
                                    setAdminGroupId(group.id)
                                    setAdminGroupError('')
                                    setAdminGroupNote('')
                                  }}
                                >
                                  View
                                </button>
                                <button className="button secondary" onClick={() => startAdminGroupEdit(group)} disabled={adminReadOnly}>
                                  Edit
                                </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="card">
                    {adminGroupMode === 'view' && activeAdminGroup && (
                      <>
                        <h2>Group detail</h2>
                        <div className="helper">Delivery group details and policy context.</div>
                        <div className="list" style={{ marginTop: '12px' }}>
                          <div className="list-item admin-detail">
                            <div>Name</div>
                            <div>{activeAdminGroup.name}</div>
                          </div>
                          <div className="list-item admin-detail">
                            <div>Owner</div>
                            <div>{activeAdminGroup.owner || 'Unassigned'}</div>
                          </div>
                          <div className="list-item admin-detail">
                            <div>Description</div>
                            <div>{activeAdminGroup.description || 'No description'}</div>
                          </div>
                        </div>
                        <div className="helper" style={{ marginTop: '12px' }}>Audit</div>
                        <div className="list">
                          <div className="list-item admin-detail">
                            <div>Created</div>
                            <div>{formatAuditValue(activeAdminGroup.created_by, activeAdminGroup.created_at)}</div>
                          </div>
                          <div className="list-item admin-detail">
                            <div>Last updated</div>
                            <div>{formatAuditValue(activeAdminGroup.updated_by, activeAdminGroup.updated_at)}</div>
                          </div>
                          <div className="list-item admin-detail">
                            <div>Last change reason</div>
                            <div>{activeAdminGroup.last_change_reason || 'None'}</div>
                          </div>
                        </div>
                        <div className="helper" style={{ marginTop: '12px' }}>Services</div>
                        <div className="list">
                          {(activeAdminGroup.services || []).length === 0 && <div className="helper">No services assigned.</div>}
                          {(activeAdminGroup.services || []).map((svc) => (
                            <div key={svc} className="list-item admin-detail">
                              <div>{svc}</div>
                            </div>
                          ))}
                        </div>
                        <div className="helper" style={{ marginTop: '12px' }}>Allowed recipes</div>
                        <div className="list">
                          {(activeAdminGroup.allowed_recipes || []).length === 0 && <div className="helper">No recipes assigned.</div>}
                          {(activeAdminGroup.allowed_recipes || []).map((recipeIdValue) => (
                            <div key={recipeIdValue} className="list-item admin-detail">
                              <div>{getRecipeLabel(recipeIdValue)}</div>
                              <div className="helper">{recipeIdValue}</div>
                            </div>
                          ))}
                        </div>
                        <div className="helper" style={{ marginTop: '12px' }}>Guardrails</div>
                        <div className="list">
                          <div className="list-item admin-detail">
                            <div>Max concurrent deployments</div>
                            <div>{activeAdminGroup.guardrails?.max_concurrent_deployments || '-'}</div>
                          </div>
                          <div className="list-item admin-detail">
                            <div>Daily deploy quota</div>
                            <div>{activeAdminGroup.guardrails?.daily_deploy_quota || '-'}</div>
                          </div>
                          <div className="list-item admin-detail">
                            <div>Daily rollback quota</div>
                            <div>{activeAdminGroup.guardrails?.daily_rollback_quota || '-'}</div>
                          </div>
                        </div>
                        <button
                          className="button secondary"
                          style={{ marginTop: '12px' }}
                          onClick={() => startAdminGroupEdit(activeAdminGroup)}
                          disabled={adminReadOnly}
                        >
                          Edit group
                        </button>
                      </>
                    )}
                    {(adminGroupMode === 'create' || adminGroupMode === 'edit') && (
                      <>
                        <h2>{adminGroupMode === 'create' ? 'Create delivery group' : 'Edit delivery group'}</h2>
                        {adminGroupMode === 'edit' && activeAdminGroup && (
                          <>
                            <div className="helper" style={{ marginTop: '4px' }}>Audit</div>
                            <div className="list" style={{ marginTop: '12px' }}>
                              <div className="list-item admin-detail">
                                <div>Created</div>
                                <div>{formatAuditValue(activeAdminGroup.created_by, activeAdminGroup.created_at)}</div>
                              </div>
                              <div className="list-item admin-detail">
                                <div>Last updated</div>
                                <div>{formatAuditValue(activeAdminGroup.updated_by, activeAdminGroup.updated_at)}</div>
                              </div>
                              <div className="list-item admin-detail">
                                <div>Last change reason</div>
                                <div>{activeAdminGroup.last_change_reason || 'None'}</div>
                              </div>
                            </div>
                          </>
                        )}
                        {adminGroupMode === 'edit' && (
                          <div className="field">
                            <label htmlFor="admin-group-change-reason">Change reason (optional)</label>
                            <input
                              id="admin-group-change-reason"
                              value={adminGroupDraft.change_reason}
                              onChange={(e) => handleAdminGroupDraftChange('change_reason', e.target.value)}
                              onInput={(e) => handleAdminGroupDraftChange('change_reason', e.target.value)}
                              disabled={adminReadOnly}
                            />
                          </div>
                        )}
                        <button
                          className="button secondary"
                          style={{ marginTop: '12px' }}
                          onClick={validateAdminGroupDraft}
                          disabled={adminGroupSaving || adminReadOnly}
                        >
                          Preview changes
                        </button>
                        {adminGroupValidation && (
                          <div className="helper" style={{ marginTop: '8px' }}>
                            Validation: {adminGroupValidation.validation_status}
                          </div>
                        )}
                        {adminGroupValidation?.messages?.length > 0 && (
                          <div className="list" style={{ marginTop: '8px' }}>
                            {adminGroupValidation.messages.map((item, idx) => (
                              <div className="list-item admin-detail" key={`group-validate-${idx}`}>
                                <div>{item.type}</div>
                                <div>{item.field || 'general'}</div>
                                <div>{item.message}</div>
                              </div>
                            ))}
                          </div>
                        )}
                        {adminGroupValidation?.validation_status === 'WARNING' && (
                          <label className="check-item" style={{ marginTop: '8px' }}>
                            <input
                              type="checkbox"
                              checked={adminGroupConfirmWarning}
                              onChange={(e) => setAdminGroupConfirmWarning(e.target.checked)}
                              disabled={adminReadOnly}
                            />
                            <span>Confirm warnings and proceed to save.</span>
                          </label>
                        )}
                        <div className="field">
                          <label htmlFor="admin-group-id">Group id</label>
                          <input
                            id="admin-group-id"
                            value={adminGroupDraft.id}
                            onChange={(e) => handleAdminGroupDraftChange('id', e.target.value)}
                            onInput={(e) => handleAdminGroupDraftChange('id', e.target.value)}
                            disabled={adminGroupMode === 'edit' || adminReadOnly}
                          />
                        </div>
                        <div className="field">
                          <label htmlFor="admin-group-name">Name</label>
                          <input
                            id="admin-group-name"
                            value={adminGroupDraft.name}
                            onChange={(e) => handleAdminGroupDraftChange('name', e.target.value)}
                            onInput={(e) => handleAdminGroupDraftChange('name', e.target.value)}
                            disabled={adminReadOnly}
                          />
                        </div>
                        <div className="field">
                          <label htmlFor="admin-group-description">Description</label>
                          <input
                            id="admin-group-description"
                            value={adminGroupDraft.description}
                            onChange={(e) => handleAdminGroupDraftChange('description', e.target.value)}
                            onInput={(e) => handleAdminGroupDraftChange('description', e.target.value)}
                            disabled={adminReadOnly}
                          />
                        </div>
                        <div className="field">
                          <label htmlFor="admin-group-owner">Owner</label>
                          <input
                            id="admin-group-owner"
                            value={adminGroupDraft.owner}
                            onChange={(e) => handleAdminGroupDraftChange('owner', e.target.value)}
                            onInput={(e) => handleAdminGroupDraftChange('owner', e.target.value)}
                            disabled={adminReadOnly}
                          />
                        </div>
                        <div className="helper">Admin-only configuration. Affects Delivery Owners and Observers.</div>
                        <div className="helper" style={{ marginTop: '12px' }}>Allowed environments</div>
                        <div className="checklist">
                          {['sandbox'].map((env) => (
                            <label key={env} className="check-item">
                              <input
                                type="checkbox"
                                checked={adminGroupDraft.allowed_environments.includes(env)}
                                onChange={() => {
                                  const set = new Set(adminGroupDraft.allowed_environments)
                                  if (set.has(env)) {
                                    set.delete(env)
                                  } else {
                                    set.add(env)
                                  }
                                  handleAdminGroupDraftChange('allowed_environments', Array.from(set))
                                }}
                                disabled={adminReadOnly}
                              />
                              <span>{env}</span>
                            </label>
                          ))}
                        </div>
                        <div className="helper" style={{ marginTop: '12px' }}>Services</div>
                        <div className="checklist">
                          {sortedServiceNames.length === 0 && <div className="helper">No allowlisted services found.</div>}
                          {sortedServiceNames.map((svc) => (
                            <label key={svc} className="check-item">
                              <input
                                type="checkbox"
                                checked={adminGroupDraft.services.includes(svc)}
                                onChange={() => toggleAdminGroupService(svc)}
                                disabled={adminReadOnly}
                              />
                              <span>{svc}</span>
                            </label>
                          ))}
                        </div>
                        <div className="helper" style={{ marginTop: '12px' }}>Allowed recipes</div>
                        <div className="checklist">
                          {sortedRecipes.length === 0 && <div className="helper">No recipes found.</div>}
                          {sortedRecipes.map((recipe) => (
                            <label key={recipe.id} className="check-item">
                              <input
                                type="checkbox"
                                checked={adminGroupDraft.allowed_recipes.includes(recipe.id)}
                                onChange={() => toggleAdminGroupRecipe(recipe.id)}
                                disabled={adminReadOnly}
                              />
                              <span>{recipe.name || recipe.id}</span>
                              <span className="helper">{recipe.id}</span>
                            </label>
                          ))}
                        </div>
                        <div className="helper" style={{ marginTop: '12px' }}>Guardrails</div>
                        <div className="row">
                          <div className="field">
                            <label htmlFor="admin-group-max-concurrent">Max concurrent deployments</label>
                            <input
                              id="admin-group-max-concurrent"
                              type="number"
                              min="1"
                              value={adminGroupDraft.guardrails.max_concurrent_deployments}
                              onChange={(e) => handleAdminGuardrailChange('max_concurrent_deployments', e.target.value)}
                              onInput={(e) => handleAdminGuardrailChange('max_concurrent_deployments', e.target.value)}
                              disabled={adminReadOnly}
                            />
                            <div className="helper">Minimum 1. Default 1.</div>
                          </div>
                          <div className="field">
                            <label htmlFor="admin-group-daily-deploy">Daily deploy quota</label>
                            <input
                              id="admin-group-daily-deploy"
                              type="number"
                              min="1"
                              value={adminGroupDraft.guardrails.daily_deploy_quota}
                              onChange={(e) => handleAdminGuardrailChange('daily_deploy_quota', e.target.value)}
                              onInput={(e) => handleAdminGuardrailChange('daily_deploy_quota', e.target.value)}
                              disabled={adminReadOnly}
                            />
                            <div className="helper">Minimum 1. Default {adminSettings?.daily_deploy_quota ?? 'system'}.</div>
                          </div>
                          <div className="field">
                            <label htmlFor="admin-group-daily-rollback">Daily rollback quota</label>
                            <input
                              id="admin-group-daily-rollback"
                              type="number"
                              min="1"
                              value={adminGroupDraft.guardrails.daily_rollback_quota}
                              onChange={(e) => handleAdminGuardrailChange('daily_rollback_quota', e.target.value)}
                              onInput={(e) => handleAdminGuardrailChange('daily_rollback_quota', e.target.value)}
                              disabled={adminReadOnly}
                            />
                            <div className="helper">Minimum 1. Default {adminSettings?.daily_rollback_quota ?? 'system'}.</div>
                          </div>
                        </div>
                        <div className="helper" style={{ marginTop: '12px' }}>Impact preview</div>
                        <div className="list">
                          <div className="list-item admin-detail">
                            <div>Services</div>
                            <div>{adminGroupDraft.services.length}</div>
                            <div>
                              {adminServiceDiff
                                ? `+${adminServiceDiff.added.length} / -${adminServiceDiff.removed.length}`
                                : 'New group'}
                            </div>
                          </div>
                          <div className="list-item admin-detail">
                            <div>Recipes</div>
                            <div>{adminGroupDraft.allowed_recipes.length}</div>
                            <div>
                              {adminRecipeDiff
                                ? `+${adminRecipeDiff.added.length} / -${adminRecipeDiff.removed.length}`
                                : 'New group'}
                            </div>
                          </div>
                        </div>
                        {adminServiceConflicts.length > 0 && (
                          <div className="helper" style={{ marginTop: '8px' }}>
                            Service {adminServiceConflicts[0].service} already belongs to {adminServiceConflicts[0].groupName}.
                          </div>
                        )}
                        {adminGroupError && <div className="helper" style={{ marginTop: '8px' }}>{adminGroupError}</div>}
                        {adminGroupNote && <div className="helper" style={{ marginTop: '8px' }}>{adminGroupNote}</div>}
                        <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                          <button
                            className="button"
                            onClick={saveAdminGroup}
                            disabled={adminGroupSaving || adminReadOnly || adminGroupValidation?.validation_status === 'ERROR'}
                          >
                            {adminGroupSaving ? 'Saving...' : 'Save group'}
                          </button>
                          <button
                            className="button secondary"
                            onClick={() => {
                              setAdminGroupMode('view')
                              setAdminGroupError('')
                              setAdminGroupNote('')
                              if (activeAdminGroup) {
                                setAdminGroupDraft(buildGroupDraft(activeAdminGroup, adminGuardrailDefaults))
                              } else {
                                setAdminGroupDraft(buildGroupDraft(null, adminGuardrailDefaults))
                              }
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                      </>
                    )}
                    {adminGroupMode === 'view' && !activeAdminGroup && (
                      <div className="helper">Select a delivery group to view details.</div>
                    )}
                  </div>
                </>
              )}
              {adminTab === 'recipes' && (
                <>
                  <div className="card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <h2>Recipes</h2>
                      <button className="button secondary" onClick={startAdminRecipeCreate} disabled={adminReadOnly}>
                        Create recipe
                      </button>
                    </div>
                    {recipes.length === 0 && <div className="helper">No recipes available.</div>}
                    {recipes.length > 0 && (
                      <div className="list" style={{ marginTop: '12px' }}>
                        {sortedRecipes.map((recipe) => {
                          const usage = recipeUsageCounts[recipe.id] || 0
                          const status = recipe.status || 'active'
                          return (
                            <div className="list-item admin-group" key={recipe.id}>
                              <div>
                                <strong>{recipe.name || recipe.id}</strong>
                                <div className="helper">{recipe.id}</div>
                              </div>
                              <div>
                                <span className={`status ${String(status).toUpperCase()}`}>{recipeStatusLabel(status)}</span>
                              </div>
                              <div>{usage} groups</div>
                              <div>
                                {recipe.spinnaker_application ? recipe.spinnaker_application : 'No engine mapping'}
                              </div>
                              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                                <button
                                  className="button secondary"
                                  onClick={() => {
                                    setAdminRecipeMode('view')
                                    setAdminRecipeId(recipe.id)
                                    setAdminRecipeError('')
                                    setAdminRecipeNote('')
                                  }}
                                >
                                  View
                                </button>
                                <button className="button secondary" onClick={() => startAdminRecipeEdit(recipe)} disabled={adminReadOnly}>
                                  Edit
                                </button>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                  <div className="card">
                    {adminRecipeMode === 'view' && activeAdminRecipe && (
                      <>
                        <h2>Recipe detail</h2>
                        <div className="helper">Recipe metadata and engine mapping.</div>
                        <div className="list" style={{ marginTop: '12px' }}>
                          <div className="list-item admin-detail">
                            <div>Name</div>
                            <div>{activeAdminRecipe.name}</div>
                          </div>
                          <div className="list-item admin-detail">
                            <div>Status</div>
                            <div>{recipeStatusLabel(activeAdminRecipe.status)}</div>
                          </div>
                          <div className="list-item admin-detail">
                            <div>Description</div>
                            <div>{activeAdminRecipe.description || 'No description'}</div>
                          </div>
                          <div className="list-item admin-detail">
                            <div>Used by</div>
                            <div>{activeAdminRecipeUsage} delivery groups</div>
                          </div>
                        </div>
                        <div className="helper" style={{ marginTop: '12px' }}>Audit</div>
                        <div className="list">
                          <div className="list-item admin-detail">
                            <div>Created</div>
                            <div>{formatAuditValue(activeAdminRecipe.created_by, activeAdminRecipe.created_at)}</div>
                          </div>
                          <div className="list-item admin-detail">
                            <div>Last updated</div>
                            <div>{formatAuditValue(activeAdminRecipe.updated_by, activeAdminRecipe.updated_at)}</div>
                          </div>
                          <div className="list-item admin-detail">
                            <div>Last change reason</div>
                            <div>{activeAdminRecipe.last_change_reason || 'None'}</div>
                          </div>
                        </div>
                        <div className="helper" style={{ marginTop: '12px' }}>Engine mapping</div>
                        <div className="list">
                          <div className="list-item admin-detail">
                            <div>Application</div>
                            <div>{activeAdminRecipe.spinnaker_application || 'Not set'}</div>
                          </div>
                          <div className="list-item admin-detail">
                            <div>Deploy pipeline</div>
                            <div>{activeAdminRecipe.deploy_pipeline || 'Not set'}</div>
                          </div>
                          <div className="list-item admin-detail">
                            <div>Rollback pipeline</div>
                            <div>{activeAdminRecipe.rollback_pipeline || 'Not set'}</div>
                          </div>
                        </div>
                        <div className="helper" style={{ marginTop: '12px' }}>Allowed parameters</div>
                        <div className="list">
                          {(activeAdminRecipe.allowed_parameters || []).length === 0 && (
                            <div className="helper">No allowed parameters.</div>
                          )}
                          {(activeAdminRecipe.allowed_parameters || []).map((param) => (
                            <div className="list-item admin-detail" key={param}>
                              <div>{param}</div>
                            </div>
                          ))}
                        </div>
                        <button
                          className="button secondary"
                          style={{ marginTop: '12px' }}
                          onClick={() => startAdminRecipeEdit(activeAdminRecipe)}
                          disabled={adminReadOnly}
                        >
                          Edit recipe
                        </button>
                      </>
                    )}
                    {(adminRecipeMode === 'create' || adminRecipeMode === 'edit') && (
                      <>
                        <h2>{adminRecipeMode === 'create' ? 'Create recipe' : 'Edit recipe'}</h2>
                        {adminRecipeMode === 'edit' && activeAdminRecipe && (
                          <>
                            <div className="helper" style={{ marginTop: '4px' }}>Audit</div>
                            <div className="list" style={{ marginTop: '12px' }}>
                              <div className="list-item admin-detail">
                                <div>Created</div>
                                <div>{formatAuditValue(activeAdminRecipe.created_by, activeAdminRecipe.created_at)}</div>
                              </div>
                              <div className="list-item admin-detail">
                                <div>Last updated</div>
                                <div>{formatAuditValue(activeAdminRecipe.updated_by, activeAdminRecipe.updated_at)}</div>
                              </div>
                              <div className="list-item admin-detail">
                                <div>Last change reason</div>
                                <div>{activeAdminRecipe.last_change_reason || 'None'}</div>
                              </div>
                            </div>
                          </>
                        )}
                        {adminRecipeMode === 'edit' && (
                          <div className="field">
                            <label htmlFor="admin-recipe-change-reason">Change reason (optional)</label>
                            <input
                              id="admin-recipe-change-reason"
                              value={adminRecipeDraft.change_reason}
                              onChange={(e) => handleAdminRecipeDraftChange('change_reason', e.target.value)}
                              onInput={(e) => handleAdminRecipeDraftChange('change_reason', e.target.value)}
                              disabled={adminReadOnly}
                            />
                          </div>
                        )}
                        <button
                          className="button secondary"
                          style={{ marginTop: '12px' }}
                          onClick={validateAdminRecipeDraft}
                          disabled={adminRecipeSaving || adminReadOnly}
                        >
                          Preview changes
                        </button>
                        {adminRecipeValidation && (
                          <div className="helper" style={{ marginTop: '8px' }}>
                            Validation: {adminRecipeValidation.validation_status}
                          </div>
                        )}
                        {adminRecipeValidation?.messages?.length > 0 && (
                          <div className="list" style={{ marginTop: '8px' }}>
                            {adminRecipeValidation.messages.map((item, idx) => (
                              <div className="list-item admin-detail" key={`recipe-validate-${idx}`}>
                                <div>{item.type}</div>
                                <div>{item.field || 'general'}</div>
                                <div>{item.message}</div>
                              </div>
                            ))}
                          </div>
                        )}
                        {adminRecipeValidation?.validation_status === 'WARNING' && (
                          <label className="check-item" style={{ marginTop: '8px' }}>
                            <input
                              type="checkbox"
                              checked={adminRecipeConfirmWarning}
                              onChange={(e) => setAdminRecipeConfirmWarning(e.target.checked)}
                              disabled={adminReadOnly}
                            />
                            <span>Confirm warnings and proceed to save.</span>
                          </label>
                        )}
                        <div className="helper" style={{ marginTop: '12px' }}>
                          Admin-only configuration. Affects Delivery Owners and Observers.
                        </div>
                        <div className="field">
                          <label htmlFor="admin-recipe-id">Recipe id</label>
                          <input
                            id="admin-recipe-id"
                            value={adminRecipeDraft.id}
                            onChange={(e) => handleAdminRecipeDraftChange('id', e.target.value)}
                            onInput={(e) => handleAdminRecipeDraftChange('id', e.target.value)}
                            disabled={adminRecipeMode === 'edit' || adminReadOnly}
                          />
                        </div>
                        <div className="field">
                          <label htmlFor="admin-recipe-name">Name</label>
                          <input
                            id="admin-recipe-name"
                            value={adminRecipeDraft.name}
                            onChange={(e) => handleAdminRecipeDraftChange('name', e.target.value)}
                            onInput={(e) => handleAdminRecipeDraftChange('name', e.target.value)}
                            disabled={adminReadOnly}
                          />
                        </div>
                        <div className="field">
                          <label htmlFor="admin-recipe-description">Description</label>
                          <input
                            id="admin-recipe-description"
                            value={adminRecipeDraft.description}
                            onChange={(e) => handleAdminRecipeDraftChange('description', e.target.value)}
                            onInput={(e) => handleAdminRecipeDraftChange('description', e.target.value)}
                            disabled={adminReadOnly}
                          />
                        </div>
                        <div className="field">
                          <label htmlFor="admin-recipe-params">Allowed parameters (comma-separated)</label>
                          <input
                            id="admin-recipe-params"
                            value={adminRecipeDraft.allowed_parameters}
                            onChange={(e) => handleAdminRecipeDraftChange('allowed_parameters', e.target.value)}
                            onInput={(e) => handleAdminRecipeDraftChange('allowed_parameters', e.target.value)}
                            disabled={adminReadOnly}
                          />
                        </div>
                        <div className="helper" style={{ marginTop: '12px' }}>Engine mapping</div>
                        {adminRecipeMode === 'edit' && activeAdminRecipeUsage > 0 && (
                          <div className="helper">Engine mapping is locked while recipe is in use.</div>
                        )}
                        <div className="field">
                          <label htmlFor="admin-recipe-app">Spinnaker application</label>
                          <input
                            id="admin-recipe-app"
                            value={adminRecipeDraft.spinnaker_application}
                            onChange={(e) => handleAdminRecipeDraftChange('spinnaker_application', e.target.value)}
                            onInput={(e) => handleAdminRecipeDraftChange('spinnaker_application', e.target.value)}
                            disabled={adminReadOnly || (adminRecipeMode === 'edit' && activeAdminRecipeUsage > 0)}
                          />
                        </div>
                        <div className="field">
                          <label htmlFor="admin-recipe-deploy">Deploy pipeline</label>
                          <input
                            id="admin-recipe-deploy"
                            value={adminRecipeDraft.deploy_pipeline}
                            onChange={(e) => handleAdminRecipeDraftChange('deploy_pipeline', e.target.value)}
                            onInput={(e) => handleAdminRecipeDraftChange('deploy_pipeline', e.target.value)}
                            disabled={adminReadOnly || (adminRecipeMode === 'edit' && activeAdminRecipeUsage > 0)}
                          />
                        </div>
                        <div className="field">
                          <label htmlFor="admin-recipe-rollback">Rollback pipeline</label>
                          <input
                            id="admin-recipe-rollback"
                            value={adminRecipeDraft.rollback_pipeline}
                            onChange={(e) => handleAdminRecipeDraftChange('rollback_pipeline', e.target.value)}
                            onInput={(e) => handleAdminRecipeDraftChange('rollback_pipeline', e.target.value)}
                            disabled={adminReadOnly || (adminRecipeMode === 'edit' && activeAdminRecipeUsage > 0)}
                          />
                        </div>
                        <div className="field">
                          <label htmlFor="admin-recipe-status">Deprecated</label>
                          <input
                            id="admin-recipe-status"
                            type="checkbox"
                            checked={adminRecipeDraft.status === 'deprecated'}
                            onChange={(e) =>
                              handleAdminRecipeDraftChange('status', e.target.checked ? 'deprecated' : 'active')
                            }
                            disabled={adminReadOnly}
                          />
                          {adminRecipeDraft.status === 'deprecated' && (
                            <div className="helper">Deprecated recipes cannot be used for new deployments.</div>
                          )}
                        </div>
                        {adminRecipeError && <div className="helper" style={{ marginTop: '8px' }}>{adminRecipeError}</div>}
                        {adminRecipeNote && <div className="helper" style={{ marginTop: '8px' }}>{adminRecipeNote}</div>}
                        <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                          <button
                            className="button"
                            onClick={saveAdminRecipe}
                            disabled={adminRecipeSaving || adminReadOnly || adminRecipeValidation?.validation_status === 'ERROR'}
                          >
                            {adminRecipeSaving ? 'Saving...' : 'Save recipe'}
                          </button>
                          <button
                            className="button secondary"
                            onClick={() => {
                              setAdminRecipeMode('view')
                              setAdminRecipeError('')
                              setAdminRecipeNote('')
                              if (activeAdminRecipe) {
                                setAdminRecipeDraft(buildRecipeDraft(activeAdminRecipe))
                              } else {
                                setAdminRecipeDraft(buildRecipeDraft(null))
                              }
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                      </>
                    )}
                    {adminRecipeMode === 'view' && !activeAdminRecipe && (
                      <div className="helper">Select a recipe to view details.</div>
                    )}
                  </div>
                </>
              )}
              {adminTab === 'audit' && isPlatformAdmin && (
                <div className="card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h2>Audit events</h2>
                    <button className="button secondary" onClick={loadAuditEvents} disabled={auditLoading}>
                      {auditLoading ? 'Loading...' : 'Refresh'}
                    </button>
                  </div>
                  {auditError && <div className="helper" style={{ marginTop: '8px' }}>{auditError}</div>}
                  {!auditError && auditEvents.length === 0 && (
                    <div className="helper" style={{ marginTop: '8px' }}>No audit events found.</div>
                  )}
                  {auditEvents.length > 0 && (
                    <div className="list" style={{ marginTop: '12px' }}>
                      {auditEvents.map((event) => (
                        <div className="list-item admin-group" key={event.event_id}>
                          <div>
                            <strong>{event.event_type}</strong>
                            <div className="helper">{event.timestamp}</div>
                          </div>
                          <div>{event.actor_id}</div>
                          <div>{event.outcome}</div>
                          <div>{event.target_type}: {event.target_id}</div>
                          <div>{event.summary}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
          )}
        </div>
      )}

      <footer className="footer">
        DXCP UI. Guardrails enforced by the API: allowlist, sandbox only, per-group lock, rate limits, idempotency.
      </footer>
    </div>
  )
}
