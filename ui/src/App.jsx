import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createAuth0Client } from '@auth0/auth0-spa-js'
import { Navigate, Route, Routes, matchPath, useLocation, useNavigate } from 'react-router-dom'
import { createApiClient } from './apiClient.js'
import { clampRefreshIntervalSeconds, getUserSettingsKey, loadUserSettings, saveUserSettings } from './settings.js'
import AppShell from './components/AppShell.jsx'
import AlertRail from './components/AlertRail.jsx'
import PageHeader from './components/PageHeader.jsx'
import SectionCard from './components/SectionCard.jsx'
import HeaderStatus from './components/HeaderStatus.jsx'
import ServicesPage from './pages/ServicesPage.jsx'
import DeployPage from './pages/DeployPage.jsx'
import DeploymentsPage from './pages/DeploymentsPage.jsx'
import DeploymentDetailPage from './pages/DeploymentDetailPage.jsx'
import SettingsPage from './pages/SettingsPage.jsx'
import AdminPage from './pages/AdminPage.jsx'

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
const CACHE_TTL_MS = 30 * 1000

// Deterministic, in-memory cache for navigation refresh rules.
const cacheStore = {
  services: { ts: 0 },
  servicesView: { ts: 0 },
  policy: { ts: 0 },
  versions: new Map(),
  deployments: { ts: 0 },
  deploymentDetail: new Map()
}

function getCacheEntry(map, key) {
  if (!map.has(key)) {
    map.set(key, { ts: 0 })
  }
  return map.get(key)
}

function isCacheFresh(entry) {
  return Boolean(entry?.ts && Date.now() - entry.ts <= CACHE_TTL_MS)
}

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

const OUTCOME_LABELS = {
  SUCCEEDED: 'Succeeded',
  FAILED: 'Failed',
  CANCELED: 'Canceled',
  ROLLED_BACK: 'Rolled back',
  SUPERSEDED: 'Superseded'
}

const OUTCOME_TONES = {
  SUCCEEDED: 'info',
  FAILED: 'danger',
  CANCELED: 'warn',
  ROLLED_BACK: 'neutral',
  SUPERSEDED: 'warn'
}

function resolveOutcome(outcome, state) {
  if (outcome) return outcome
  if (!state || state === 'PENDING' || state === 'ACTIVE' || state === 'IN_PROGRESS') return null
  if (OUTCOME_LABELS[state]) return state
  return null
}

function outcomeLabel(outcome, state) {
  const resolved = resolveOutcome(outcome, state)
  if (!resolved) return 'In progress'
  return OUTCOME_LABELS[resolved] || resolved
}

function outcomeTone(outcome, state) {
  const resolved = resolveOutcome(outcome, state)
  if (!resolved) return 'neutral'
  return OUTCOME_TONES[resolved] || 'neutral'
}

function outcomeDisplayLabel(outcome, state, kind, rollbackOf) {
  const resolved = resolveOutcome(outcome, state)
  const operation = resolveDeploymentKind(kind, rollbackOf)
  if (operation === 'ROLLBACK') {
    if (!resolved) return 'Rollback in progress'
    if (resolved === 'SUCCEEDED') return 'Rollback succeeded'
    if (resolved === 'FAILED') return 'Rollback failed'
    if (resolved === 'CANCELED') return 'Rollback canceled'
    if (resolved === 'ROLLED_BACK') return 'Rollback completed'
    if (resolved === 'SUPERSEDED') return 'Rollback superseded'
  }
  if (operation === 'PROMOTE') {
    if (!resolved) return 'Promotion in progress'
    if (resolved === 'SUCCEEDED') return 'Promotion succeeded'
    if (resolved === 'FAILED') return 'Promotion failed'
    if (resolved === 'CANCELED') return 'Promotion canceled'
    if (resolved === 'ROLLED_BACK') return 'Promotion rolled back'
    if (resolved === 'SUPERSEDED') return 'Promotion superseded'
  }
  return outcomeLabel(outcome, state)
}

function failureCauseHeadline(cause) {
  const normalized = String(cause || '').toUpperCase()
  if (normalized === 'POLICY_CHANGE') return 'Blocked by policy change'
  if (normalized === 'USER_ERROR') return 'Fix selection'
  return 'Blocked by validation'
}

function resolveDeploymentKind(kind, rollbackOf) {
  if (kind) return kind
  return rollbackOf ? 'ROLLBACK' : 'ROLL_FORWARD'
}

function deploymentKindLabel(kind, rollbackOf) {
  const resolved = resolveDeploymentKind(kind, rollbackOf)
  if (resolved === 'ROLLBACK') return 'Rollback'
  if (resolved === 'PROMOTE') return 'Promote'
  return 'Roll-forward'
}

function findTimelineStep(steps, keys) {
  if (!Array.isArray(steps)) return null
  const keySet = new Set(Array.isArray(keys) ? keys : [keys])
  return steps.find((step) => keySet.has(step.key)) || null
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

function normalizeStrategyKey(recipe) {
  if (!recipe) return ''
  const id = String(recipe.id || '').toLowerCase()
  const name = String(recipe.name || '').toLowerCase()
  const value = `${id} ${name}`
  if (value.includes('canary')) return 'CANARY'
  if (value.includes('bluegreen') || value.includes('blue-green') || value.includes('blue green')) return 'BLUE_GREEN'
  if (value.includes('standard')) return 'STANDARD'
  return ''
}

function strategyNarrative(recipe) {
  const key = normalizeStrategyKey(recipe)
  if (key === 'CANARY') {
    return {
      success: 'Canary verification completes and the new version becomes current.',
      rollback:
        'Failed verification triggers rollback; the original deployment is recorded as Rolled back after rollback succeeds.'
    }
  }
  if (key === 'BLUE_GREEN') {
    return {
      success: 'Cutover completes and the new version becomes current.',
      rollback:
        'Failed validation or cutover triggers rollback; the original deployment is recorded as Rolled back after rollback succeeds.'
    }
  }
  if (key === 'STANDARD') {
    return {
      success: 'Deployment completes and the new version becomes current.',
      rollback: 'If rollback is triggered, a rollback deployment restores the previous version.'
    }
  }
  return {
    success: 'Deployment completes and the new version becomes current.',
    rollback: 'If rollback is triggered, a rollback deployment restores the previous version.'
  }
}

const SAFE_ENV_NAME_RE = /(sandbox|dev|test|staging|stage|qa|nonprod|non-prod)/i

function sortEnvironments(list) {
  return list
    .slice()
    .sort((a, b) => {
      const aOrder = Number.isInteger(a?.promotion_order) && a?.promotion_order > 0 ? a.promotion_order : Number.MAX_SAFE_INTEGER
      const bOrder = Number.isInteger(b?.promotion_order) && b?.promotion_order > 0 ? b.promotion_order : Number.MAX_SAFE_INTEGER
      if (aOrder !== bOrder) return aOrder - bOrder
      const aType = String(a?.type || '').toLowerCase()
      const bType = String(b?.type || '').toLowerCase()
      const aTypeOrder = aType === 'prod' ? 1 : 0
      const bTypeOrder = bType === 'prod' ? 1 : 0
      if (aTypeOrder !== bTypeOrder) return aTypeOrder - bTypeOrder
      return String(a?.name || '').localeCompare(String(b?.name || ''))
    })
}

function environmentLabel(env) {
  if (!env) return ''
  return env.display_name || env.name || ''
}

function pickDefaultEnvironment(list) {
  if (!Array.isArray(list) || list.length === 0) return ''
  const safeByName = list.find((env) => SAFE_ENV_NAME_RE.test(env?.name || ''))
  if (safeByName?.name) return safeByName.name
  const safeByType = list.find((env) => String(env?.type || '').toLowerCase() === 'non_prod')
  if (safeByType?.name) return safeByType.name
  return list[0]?.name || ''
}

function shortId(value) {
  if (!value) return ''
  const text = String(value)
  if (text.length <= 12) return text
  return `${text.slice(0, 8)}…${text.slice(-4)}`
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
    spinnaker_application: recipe?.spinnaker_application || '',
    deploy_pipeline: recipe?.deploy_pipeline || '',
    rollback_pipeline: recipe?.rollback_pipeline || '',
    recipe_revision: recipe?.recipe_revision ?? 1,
    effective_behavior_summary: recipe?.effective_behavior_summary || '',
    status: recipe?.status || 'active',
    change_reason: ''
  }
}

function formatAuditValue(by, at) {
  const who = by || 'Unknown'
  const when = at || 'Unknown'
  return `${who} at ${when}`
}

function resolveViewFromPath(pathname) {
  if (matchPath('/deployments/:deploymentId', pathname)) return 'detail'
  if (matchPath('/services/:serviceName', pathname)) return 'service'
  if (pathname.startsWith('/deployments')) return 'deployments'
  if (pathname.startsWith('/deploy')) return 'deploy'
  if (pathname.startsWith('/insights')) return 'insights'
  if (pathname.startsWith('/settings')) return 'settings'
  if (pathname.startsWith('/admin')) return 'admin'
  if (pathname.startsWith('/services')) return 'services'
  return 'services'
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

function parseSystemRateLimitValue(value, label) {
  const raw = String(value ?? '').trim()
  if (!raw) return { error: `${label} is required.` }
  if (!/^\d+$/.test(raw)) return { error: `${label} must be an integer.` }
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 5000) {
    return { error: `${label} must be between 1 and 5000.` }
  }
  return { value: parsed }
}

function parseCiPublishersValue(value) {
  const raw = String(value ?? '')
  const parsed = raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  const unique = []
  parsed.forEach((item) => {
    if (!unique.includes(item)) unique.push(item)
  })
  if (unique.length === 0) {
    return { error: 'At least one CI publisher is required.' }
  }
  return { value: unique }
}

function formatApiError(result, fallbackMessage) {
  if (result && result.code) {
    const requestSuffix = result.request_id ? ` (request_id: ${result.request_id})` : ''
    return `${result.code}: ${result.message}${requestSuffix}`
  }
  return fallbackMessage
}

function versionNotFoundActionMessage(result) {
  const requestPart = result?.request_id ? ` Request ID: ${result.request_id}.` : ''
  return `Action required: build not registered by CI. Confirm CI build ran and registered this version. If you deployed directly via Spinnaker, that can cause drift; redeploy via DXCP after CI registers.${requestPart}`
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
  const [services, setServices] = useState([])
  const [service, setService] = useState('')
  const [version, setVersion] = useState('')
  const [versionMode, setVersionMode] = useState('auto')
  const [versionSelection, setVersionSelection] = useState('none')
  const [changeSummary, setChangeSummary] = useState('')
  const [deployResult, setDeployResult] = useState(null)
  const [deployments, setDeployments] = useState([])
  const [selected, setSelected] = useState(null)
  const [failures, setFailures] = useState([])
  const [statusMessage, setStatusMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [errorHeadline, setErrorHeadline] = useState('')
  const [recipes, setRecipes] = useState([])
  const [recipeId, setRecipeId] = useState('')
  const [recipeAutoApplied, setRecipeAutoApplied] = useState(false)
  const [versionAutoApplied, setVersionAutoApplied] = useState(false)
  const [versions, setVersions] = useState([])
  const [versionsLoading, setVersionsLoading] = useState(false)
  const [versionsRefreshing, setVersionsRefreshing] = useState(false)
  const [versionsError, setVersionsError] = useState('')
  const [deployQueryParams, setDeployQueryParams] = useState(null)
  const [deployUrlSyncEnabled, setDeployUrlSyncEnabled] = useState(false)
  const [deploymentsQueryService, setDeploymentsQueryService] = useState('')
  const [deploymentsFilterService, setDeploymentsFilterService] = useState('')
  const [deploymentsUrlSyncEnabled, setDeploymentsUrlSyncEnabled] = useState(false)
  const [deploymentsLoading, setDeploymentsLoading] = useState(false)
  const [deploymentsRefreshedAt, setDeploymentsRefreshedAt] = useState('')
  const [environments, setEnvironments] = useState([])
  const [environmentsLoading, setEnvironmentsLoading] = useState(false)
  const [environmentsError, setEnvironmentsError] = useState('')
  const [selectedEnvironment, setSelectedEnvironment] = useState('')
  const [environmentAutoApplied, setEnvironmentAutoApplied] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [timeline, setTimeline] = useState([])
  const [insights, setInsights] = useState(null)
  const [insightsLoading, setInsightsLoading] = useState(false)
  const [insightsError, setInsightsError] = useState('')
  const [deploymentDetailLoading, setDeploymentDetailLoading] = useState(false)
  const [deploymentDetailRefreshedAt, setDeploymentDetailRefreshedAt] = useState('')
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
  const [servicesRefreshedAt, setServicesRefreshedAt] = useState('')
  const [debugDeployGatesEnabled, setDebugDeployGatesEnabled] = useState(ENV.VITE_DEBUG_DEPLOY_GATES === 'true')
  const [serviceDetailName, setServiceDetailName] = useState('')
  const [serviceDetailTab, setServiceDetailTab] = useState('overview')
  const [serviceDetailStatus, setServiceDetailStatus] = useState(null)
  const [serviceDetailHistory, setServiceDetailHistory] = useState([])
  const [serviceDetailFailures, setServiceDetailFailures] = useState([])
  const [serviceDetailLoading, setServiceDetailLoading] = useState(false)
  const [serviceDetailRefreshedAt, setServiceDetailRefreshedAt] = useState('')
  const [promotionChangeSummary, setPromotionChangeSummary] = useState('')
  const [promotionStep, setPromotionStep] = useState('form')
  const [promotionValidation, setPromotionValidation] = useState(null)
  const [promotionSubmitting, setPromotionSubmitting] = useState(false)
  const [promotionInlineError, setPromotionInlineError] = useState('')
  const [deployInlineMessage, setDeployInlineMessage] = useState('')
  const [deployInlineHeadline, setDeployInlineHeadline] = useState('')
  const [deployStep, setDeployStep] = useState('form')
  const [deployEntryReady, setDeployEntryReady] = useState(true)
  const [preflightStatus, setPreflightStatus] = useState('idle')
  const [preflightResult, setPreflightResult] = useState(null)
  const [preflightError, setPreflightError] = useState('')
  const [preflightErrorHeadline, setPreflightErrorHeadline] = useState('')
  const [policySummary, setPolicySummary] = useState(null)
  const [policySummaryStatus, setPolicySummaryStatus] = useState('idle')
  const [policySummaryError, setPolicySummaryError] = useState('')
  const [policyDeployments, setPolicyDeployments] = useState([])
  const [policyDeploymentsLoading, setPolicyDeploymentsLoading] = useState(false)
  const [policyDeploymentsError, setPolicyDeploymentsError] = useState('')
  const [policyRefreshedAt, setPolicyRefreshedAt] = useState('')
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
  const [systemRateLimitDraft, setSystemRateLimitDraft] = useState({ read_rpm: '', mutate_rpm: '' })
  const [systemRateLimitBaseline, setSystemRateLimitBaseline] = useState({ read_rpm: '', mutate_rpm: '' })
  const [systemRateLimitLoading, setSystemRateLimitLoading] = useState(false)
  const [systemRateLimitSaving, setSystemRateLimitSaving] = useState(false)
  const [systemRateLimitError, setSystemRateLimitError] = useState('')
  const [systemRateLimitNote, setSystemRateLimitNote] = useState('')
  const [systemCiPublishersDraft, setSystemCiPublishersDraft] = useState('')
  const [systemCiPublishersBaseline, setSystemCiPublishersBaseline] = useState('')
  const [systemCiPublishersLoading, setSystemCiPublishersLoading] = useState(false)
  const [systemCiPublishersSaving, setSystemCiPublishersSaving] = useState(false)
  const [systemCiPublishersError, setSystemCiPublishersError] = useState('')
  const [systemCiPublishersNote, setSystemCiPublishersNote] = useState('')
  const [auditEvents, setAuditEvents] = useState([])
  const [auditLoading, setAuditLoading] = useState(false)
  const [auditError, setAuditError] = useState('')
  const location = useLocation()
  const navigate = useNavigate()
  const currentPath = location.pathname || '/'
  const lastViewRef = useRef('')
  const lastRouteKeyRef = useRef('')
  const deploymentsScrollRef = useRef(0)
  const invalidationRef = useRef({ recipe: '', version: '' })
  const queryAlertRef = useRef({ deployService: '', deployRecipe: '', deployVersion: '', deploymentsService: '' })
  const urlSyncRef = useRef({ deploy: '', deployments: '' })
  const deployQueryAppliedRef = useRef(false)
  const previousServiceRef = useRef('')
  const view = useMemo(() => resolveViewFromPath(currentPath), [currentPath])
  const deploymentMatch = useMemo(() => matchPath('/deployments/:deploymentId', currentPath), [currentPath])
  const deploymentId = deploymentMatch?.params?.deploymentId || ''
  const serviceMatch = useMemo(() => matchPath('/services/:serviceName', currentPath), [currentPath])
  const routeServiceName = serviceMatch?.params?.serviceName || ''

  const validVersion = useMemo(() => VERSION_RE.test(version), [version])
  const versionInList = useMemo(
    () => versions.some((item) => item.version === version),
    [versions, version]
  )
  const versionVerified = versionMode === 'auto' ? Boolean(version) : versionInList
  const versionUnverifiable = versionMode === 'custom' && !versionInList
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
  const serviceDetailRunning = serviceDetailStatus?.currentRunning || null
  const servicePromotionCandidate = serviceDetailStatus?.promotionCandidate || null
  const enabledEnvironments = useMemo(
    () => environments.filter((env) => env && env.is_enabled !== false),
    [environments]
  )
  const sortedEnvironments = useMemo(() => sortEnvironments(enabledEnvironments), [enabledEnvironments])
  const environmentScopeGroup = useMemo(() => {
    if (view === 'service') return serviceDetailGroup
    if (view === 'deploy') return currentDeliveryGroup
    return null
  }, [view, serviceDetailGroup, currentDeliveryGroup])
  const environmentScopeGroupId = environmentScopeGroup?.id || ''
  const environmentOptions = useMemo(() => {
    if (!environmentScopeGroupId) return sortedEnvironments
    return sortedEnvironments.filter((env) => env.delivery_group_id === environmentScopeGroupId)
  }, [sortedEnvironments, environmentScopeGroupId])
  const environmentBlockedCount = useMemo(() => {
    if (!environmentScopeGroupId) return 0
    return sortedEnvironments.filter((env) => env.delivery_group_id !== environmentScopeGroupId).length
  }, [sortedEnvironments, environmentScopeGroupId])
  const hasEnvironmentsConfigured = sortedEnvironments.length > 0
  const environmentReady = Boolean(selectedEnvironment)
  const environmentScopeNote = useMemo(() => {
    if (!environmentScopeGroupId) return ''
    if (environmentOptions.length === 0) {
      return 'No environments are enabled for this delivery group.'
    }
    if (environmentBlockedCount > 0) {
      return 'Some environments are unavailable for this service based on delivery group policy.'
    }
    return ''
  }, [environmentScopeGroupId, environmentOptions.length, environmentBlockedCount])
  // UI-only role display; API permissions are authoritative.
  const derivedRole = Array.isArray(derivedRoles)
    ? derivedRoles.includes('dxcp-platform-admins')
      ? 'PLATFORM_ADMIN'
      : derivedRoles.includes('dxcp-observers')
        ? 'OBSERVER'
        : 'UNKNOWN'
    : 'UNKNOWN'
  const canDeploy = actionInfo.actions?.deploy === true && (deployEntryReady || debugDeployGatesEnabled)
  const canRollback = actionInfo.actions?.rollback === true
  const canPromote = canDeploy
  const isPlatformAdmin = derivedRole === 'PLATFORM_ADMIN'
  const deployDisabledReason = !environmentReady
    ? 'Select an environment.'
    : !deployEntryReady
      ? 'Refreshing policy and versions.'
      : actionInfo.loading
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
  const trimmedChangeSummary = useMemo(() => changeSummary.trim(), [changeSummary])
  const selectedRecipeNarrative = useMemo(() => strategyNarrative(selectedRecipe), [selectedRecipe])
  const preflightKey = useMemo(
    () =>
      service && recipeId && version && selectedEnvironment
        ? JSON.stringify({ service, recipeId, version, environment: selectedEnvironment })
        : '',
    [service, recipeId, version, selectedEnvironment]
  )
  const policySummaryKey = useMemo(
    () =>
      service && selectedEnvironment
        ? JSON.stringify({ service, recipeId: recipeId || '', environment: selectedEnvironment })
        : '',
    [service, recipeId, selectedEnvironment]
  )
  const [validatedIntentKey, setValidatedIntentKey] = useState('')
  const lastAutoPreflightKeyRef = useRef('')
  const lastAutoPreflightFailedKeyRef = useRef('')
  const lastChangeSummaryFilledRef = useRef(false)
  const lastPolicySummaryKeyRef = useRef('')
  const lastPreflightKeyRef = useRef('')
  const lastDeployBootstrapKeyRef = useRef('')
  const selectedRecipeDeprecated = selectedRecipe?.status === 'deprecated'
  const canRunPreflight = Boolean(
    (deployEntryReady || debugDeployGatesEnabled) &&
      canDeploy &&
      environmentReady &&
      recipeId &&
      trimmedChangeSummary &&
      validVersion &&
      !selectedRecipeDeprecated &&
      versionVerified
  )
  const canReviewDeploy = Boolean(canRunPreflight && preflightStatus !== 'checking')
  const policyQuotaStats = useMemo(
    () => computeQuotaStats(policyDeployments, currentDeliveryGroup?.id || ''),
    [policyDeployments, currentDeliveryGroup]
  )
  const latestPolicyDeployment = useMemo(() => {
    if (!Array.isArray(policyDeployments) || policyDeployments.length === 0) return null
    const list = service ? policyDeployments.filter((item) => item?.service === service) : policyDeployments
    if (list.length === 0) return null
    return list
      .slice()
      .sort((a, b) => {
        const aTime = Date.parse(a?.createdAt || a?.updatedAt || '')
        const bTime = Date.parse(b?.createdAt || b?.updatedAt || '')
        if (Number.isNaN(aTime) && Number.isNaN(bTime)) return 0
        if (Number.isNaN(aTime)) return 1
        if (Number.isNaN(bTime)) return -1
        return bTime - aTime
      })[0]
  }, [policyDeployments, service])
  const visibleDeployments = useMemo(() => {
    if (!deploymentsFilterService) return deployments
    return deployments.filter((item) => item.service === deploymentsFilterService)
  }, [deployments, deploymentsFilterService])
  const rollbackLookup = useMemo(() => {
    const map = new Map()
    serviceDetailHistory.forEach((item) => {
      if (item?.rollbackOf && item.id) map.set(item.rollbackOf, item.id)
    })
    return map
  }, [serviceDetailHistory])
  const recentRollbackLookup = useMemo(() => {
    const map = new Map()
    deployments.forEach((item) => {
      if (item?.rollbackOf && item.id) map.set(item.rollbackOf, item.id)
    })
    return map
  }, [deployments])
  const getRollbackIdFor = useCallback(
    (deploymentId) => rollbackLookup.get(deploymentId) || recentRollbackLookup.get(deploymentId) || '',
    [rollbackLookup, recentRollbackLookup]
  )
  const selectedRollbackId = useMemo(
    () => (selected?.id ? getRollbackIdFor(selected.id) : ''),
    [selected, getRollbackIdFor]
  )
  const timelineSteps = useMemo(() => normalizeTimelineSteps(timeline), [timeline])
  const selectedValidatedAt = useMemo(
    () => findTimelineStep(timelineSteps, ['validated'])?.occurredAt || '',
    [timelineSteps]
  )
  const selectedExecutionAt = useMemo(
    () => findTimelineStep(timelineSteps, ['in_progress', 'active'])?.occurredAt || '',
    [timelineSteps]
  )
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
  const getRecipeDisplay = useCallback(
    (recipeIdValue, recipeRevisionValue) => {
      if (!recipeIdValue) return '-'
      const found = recipes.find((recipe) => recipe.id === recipeIdValue)
      const name = found?.name || recipeIdValue
      const revision = recipeRevisionValue ?? found?.recipe_revision
      return revision ? `${name} (v${revision})` : name
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

  useEffect(() => {
    let cancelled = false
    const loadDebugFlags = async () => {
      const config = await loadUiConfig()
      if (!config || cancelled) return
      const flag =
        config.debugDeployGates ??
        config.ui?.debugDeployGates ??
        config.flags?.debugDeployGates ??
        false
      if (cancelled) return
      setDebugDeployGatesEnabled(Boolean(flag))
    }
    loadDebugFlags()
    return () => {
      cancelled = true
    }
  }, [getRuntimeConfig])

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
    const safeSet = (fn) => {
      if (!active || typeof window === 'undefined') return
      fn()
    }
    async function initAuth() {
      if (typeof window === 'undefined') return
      const runtimeConfig = await getRuntimeConfig()
      if (!active || typeof window === 'undefined') return
      if (!runtimeConfig.domain || !runtimeConfig.clientId || !runtimeConfig.audience) {
        safeSet(() => {
          setAuthError('Auth0 configuration is missing.')
          setAuthReady(true)
        })
        return
      }
      if (runtimeConfig.apiBase) {
        safeSet(() => setApiBase(normalizeApiBase(runtimeConfig.apiBase)))
      }
      safeSet(() => {
        setAuthAudience(runtimeConfig.audience)
        setRolesClaim(runtimeConfig.rolesClaim || ROLES_CLAIM)
      })
      try {
        const factory =
          typeof window !== 'undefined' && window.__DXCP_AUTH0_FACTORY__
            ? window.__DXCP_AUTH0_FACTORY__
            : createAuth0Client
        const result = await initAuthOnce(runtimeConfig, factory)
        safeSet(() => {
          setAuthClient(result.client)
          setAccessToken(result.token || '')
          setUser(result.user || null)
          setIsAuthenticated(Boolean(result.isAuthenticated))
          setAuthReady(true)
        })
      } catch (err) {
        safeSet(() => {
          const message = err?.error_description || err?.error || err?.message || 'Failed to initialize Auth0.'
          setAuthError(message)
          setAuthReady(true)
        })
      }
    }
    initAuth()
    return () => {
      active = false
    }
  }, [getRuntimeConfig])

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

  const refreshDeployments = useCallback(async (options = {}) => {
    setErrorMessage('')
    setErrorHeadline('')
    if (!selectedEnvironment) {
      setDeployments([])
      setDeploymentsRefreshedAt('')
      setDeploymentsLoading(false)
      return
    }
    setDeploymentsLoading(true)
    try {
      const data = await api.get(`/deployments?environment=${encodeURIComponent(selectedEnvironment)}`, options)
      setDeployments(Array.isArray(data) ? data : [])
      const now = Date.now()
      cacheStore.deployments.ts = now
      setDeploymentsRefreshedAt(now)
    } catch (err) {
      if (isLoginRequiredError(err)) return
      setErrorHeadline('')
      setErrorMessage('Failed to load deployments')
    } finally {
      setDeploymentsLoading(false)
    }
  }, [api, selectedEnvironment])

  const loadAllowedActions = useCallback(async (serviceName) => {
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
  }, [api])

  const loadServices = useCallback(async (options = {}) => {
    setErrorMessage('')
    setErrorHeadline('')
    try {
      const data = await api.get('/services', options)
      if (Array.isArray(data)) {
        setServices(data)
        cacheStore.services.ts = Date.now()
        if (!service && data.length === 1) {
          const nextService = data[0].service_name
          setService(nextService)
          loadAllowedActions(nextService)
        }
      }
    } catch (err) {
      if (isLoginRequiredError(err)) return
      setErrorHeadline('')
      setErrorMessage('Failed to load services')
    }
  }, [api, service, loadAllowedActions])

  const loadRecipes = useCallback(async (options = {}) => {
    setErrorMessage('')
    setErrorHeadline('')
    try {
      const data = await api.get('/recipes', options)
      const list = Array.isArray(data) ? data : []
      setRecipes(list)
      return true
    } catch (err) {
      if (isLoginRequiredError(err)) return
      setErrorHeadline('')
      setErrorMessage('Failed to load recipes')
    }
    return false
  }, [api])

  const loadDeliveryGroups = useCallback(async (options = {}) => {
    try {
      const data = await api.get('/delivery-groups', options)
      const list = Array.isArray(data) ? data : []
      const normalizeGuardrailValue = (value) => {
        if (value === null || value === undefined || value === '') return null
        const parsed = Number(value)
        return Number.isFinite(parsed) ? parsed : null
      }
      const normalized = list.map((group) => {
        const base = group || {}
        const guardrails = base.guardrails || {}
        return {
          ...base,
          guardrails: {
            max_concurrent_deployments:
              guardrails.max_concurrent_deployments ??
              normalizeGuardrailValue(base.max_concurrent_deployments),
            daily_deploy_quota:
              guardrails.daily_deploy_quota ??
              normalizeGuardrailValue(base.daily_deploy_quota),
            daily_rollback_quota:
              guardrails.daily_rollback_quota ??
              normalizeGuardrailValue(base.daily_rollback_quota)
          }
        }
      })
      setDeliveryGroups(normalized)
      return normalized
    } catch (err) {
      if (isLoginRequiredError(err)) return
      setDeliveryGroups([])
    }
    return null
  }, [api])

  const loadEnvironments = useCallback(async (options = {}) => {
    setEnvironmentsError('')
    setEnvironmentsLoading(true)
    try {
      const data = await api.get('/environments', options)
      const list = Array.isArray(data) ? data : []
      setEnvironments(list)
      return list
    } catch (err) {
      if (isLoginRequiredError(err)) return null
      setEnvironments([])
      setEnvironmentsError('Failed to load environments')
    } finally {
      setEnvironmentsLoading(false)
    }
    return null
  }, [api])

  const loadAuditEvents = useCallback(async () => {
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
  }, [api])

  const loadServicesList = useCallback(async (options = {}) => {
    setServicesViewLoading(true)
    setErrorMessage('')
    setErrorHeadline('')
    try {
      const data = await api.get('/services', options)
      const list = Array.isArray(data) ? data : []
      const groups =
        deliveryGroups.length > 0 ? deliveryGroups : (await loadDeliveryGroups(options)) || []
      const statusResults = selectedEnvironment
        ? await Promise.allSettled(
            list.map((svc) =>
              api.get(
                `/services/${encodeURIComponent(svc.service_name)}/delivery-status?environment=${encodeURIComponent(selectedEnvironment)}`
              )
            )
          )
        : []
      const rows = list.map((svc, idx) => {
        const status = selectedEnvironment && statusResults[idx]?.status === 'fulfilled'
          ? statusResults[idx].value
          : null
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
      const now = Date.now()
      cacheStore.servicesView.ts = now
      setServicesRefreshedAt(now)
    } catch (err) {
      if (isLoginRequiredError(err)) return
      setServicesView([])
      setErrorHeadline('Services')
      setErrorMessage('Failed to load services')
    } finally {
      setServicesViewLoading(false)
    }
  }, [api, deliveryGroups, loadDeliveryGroups, selectedEnvironment])

  const loadServiceDetail = useCallback(async (serviceName) => {
    if (!serviceName) return
    setServiceDetailLoading(true)
    setErrorMessage('')
    setErrorHeadline('')
    if (!selectedEnvironment) {
      setServiceDetailStatus(null)
      setServiceDetailHistory([])
      setServiceDetailFailures([])
      setServiceDetailRefreshedAt('')
      setServiceDetailLoading(false)
      return
    }
    try {
      const [status, deployments] = await Promise.all([
        api.get(
          `/services/${encodeURIComponent(serviceName)}/delivery-status?environment=${encodeURIComponent(selectedEnvironment)}`
        ),
        api.get(
          `/deployments?service=${encodeURIComponent(serviceName)}&environment=${encodeURIComponent(selectedEnvironment)}`
        )
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
      setServiceDetailRefreshedAt(Date.now())
    } catch (err) {
      if (isLoginRequiredError(err)) return
      setServiceDetailStatus(null)
      setServiceDetailHistory([])
      setServiceDetailFailures([])
      setErrorHeadline('Service detail')
      setErrorMessage('Failed to load service detail')
    } finally {
      setServiceDetailLoading(false)
    }
  }, [api, selectedEnvironment])

  const loadPublicSettings = useCallback(async () => {
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
  }, [api])

  const loadAdminSettings = useCallback(async () => {
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
  }, [api])

  const loadSystemRateLimits = useCallback(
    async (options = {}) => {
      if (!isPlatformAdmin) return
      setSystemRateLimitError('')
      setSystemRateLimitNote('')
      setSystemRateLimitLoading(true)
      try {
        const force = Boolean(options?.force)
        const data = await api.get('/admin/system/rate-limits', { bypassCache: true, cacheTtlMs: force ? 0 : 2000 })
        if (data && data.code) {
          setSystemRateLimitError(formatApiError(data, 'Failed to load system rate limits.'))
          return
        }
        setSystemRateLimitDraft({
          read_rpm: String(data?.read_rpm ?? ''),
          mutate_rpm: String(data?.mutate_rpm ?? '')
        })
        setSystemRateLimitBaseline({
          read_rpm: String(data?.read_rpm ?? ''),
          mutate_rpm: String(data?.mutate_rpm ?? '')
        })
      } catch (err) {
        if (isLoginRequiredError(err)) return
        setSystemRateLimitError('Failed to load system rate limits.')
      } finally {
        setSystemRateLimitLoading(false)
      }
    },
    [api, isPlatformAdmin]
  )

  function handleSystemRateLimitDraftChange(field, value) {
    setSystemRateLimitDraft((prev) => ({ ...prev, [field]: value }))
    setSystemRateLimitError('')
    setSystemRateLimitNote('')
  }

  const saveSystemRateLimits = useCallback(async () => {
    if (!isPlatformAdmin) {
      setSystemRateLimitError('Only Platform Admins can modify this.')
      return
    }
    setSystemRateLimitError('')
    setSystemRateLimitNote('')
    const readParsed = parseSystemRateLimitValue(systemRateLimitDraft.read_rpm, 'Read RPM')
    if (readParsed.error) {
      setSystemRateLimitError(readParsed.error)
      return
    }
    const mutateParsed = parseSystemRateLimitValue(systemRateLimitDraft.mutate_rpm, 'Mutate RPM')
    if (mutateParsed.error) {
      setSystemRateLimitError(mutateParsed.error)
      return
    }
    setSystemRateLimitSaving(true)
    try {
      const payload = { read_rpm: readParsed.value, mutate_rpm: mutateParsed.value }
      const result = await api.put('/admin/system/rate-limits', payload)
      if (result && result.code) {
        setSystemRateLimitError(formatApiError(result, 'Failed to save system rate limits.'))
        return
      }
      setSystemRateLimitDraft({
        read_rpm: String(result?.read_rpm ?? payload.read_rpm),
        mutate_rpm: String(result?.mutate_rpm ?? payload.mutate_rpm)
      })
      setSystemRateLimitBaseline({
        read_rpm: String(result?.read_rpm ?? payload.read_rpm),
        mutate_rpm: String(result?.mutate_rpm ?? payload.mutate_rpm)
      })
      setSystemRateLimitNote('System rate limits saved.')
    } catch (err) {
      if (isLoginRequiredError(err)) return
      setSystemRateLimitError('Failed to save system rate limits.')
    } finally {
      setSystemRateLimitSaving(false)
    }
  }, [api, isPlatformAdmin, systemRateLimitDraft.read_rpm, systemRateLimitDraft.mutate_rpm])

  const loadSystemCiPublishers = useCallback(
    async (options = {}) => {
      if (!isPlatformAdmin) return
      setSystemCiPublishersError('')
      setSystemCiPublishersNote('')
      setSystemCiPublishersLoading(true)
      try {
        const force = Boolean(options?.force)
        const data = await api.get('/admin/system/ci-publishers', { bypassCache: true, cacheTtlMs: force ? 0 : 2000 })
        if (data && data.code) {
          setSystemCiPublishersError(formatApiError(data, 'Failed to load CI publisher allowlist.'))
          return
        }
        const next = Array.isArray(data?.ci_publishers) ? data.ci_publishers.join(', ') : ''
        setSystemCiPublishersDraft(next)
        setSystemCiPublishersBaseline(next)
      } catch (err) {
        if (isLoginRequiredError(err)) return
        setSystemCiPublishersError('Failed to load CI publisher allowlist.')
      } finally {
        setSystemCiPublishersLoading(false)
      }
    },
    [api, isPlatformAdmin]
  )

  function handleSystemCiPublishersDraftChange(value) {
    setSystemCiPublishersDraft(value)
    setSystemCiPublishersError('')
    setSystemCiPublishersNote('')
  }

  const saveSystemCiPublishers = useCallback(async () => {
    if (!isPlatformAdmin) {
      setSystemCiPublishersError('Only Platform Admins can modify this.')
      return
    }
    setSystemCiPublishersError('')
    setSystemCiPublishersNote('')
    const parsed = parseCiPublishersValue(systemCiPublishersDraft)
    if (parsed.error) {
      setSystemCiPublishersError(parsed.error)
      return
    }
    setSystemCiPublishersSaving(true)
    try {
      const payload = { ci_publishers: parsed.value }
      const result = await api.put('/admin/system/ci-publishers', payload)
      if (result && result.code) {
        setSystemCiPublishersError(formatApiError(result, 'Failed to save CI publisher allowlist.'))
        return
      }
      const next = Array.isArray(result?.ci_publishers) ? result.ci_publishers.join(', ') : payload.ci_publishers.join(', ')
      setSystemCiPublishersDraft(next)
      setSystemCiPublishersBaseline(next)
      setSystemCiPublishersNote('CI publisher allowlist saved.')
    } catch (err) {
      if (isLoginRequiredError(err)) return
      setSystemCiPublishersError('Failed to save CI publisher allowlist.')
    } finally {
      setSystemCiPublishersSaving(false)
    }
  }, [api, isPlatformAdmin, systemCiPublishersDraft])

  const loadPolicyDeployments = useCallback(async (options = {}) => {
    setPolicyDeploymentsError('')
    setPolicyDeploymentsLoading(true)
    try {
      if (!selectedEnvironment) {
        setPolicyDeployments([])
        return false
      }
      const data = await api.get(`/deployments?environment=${encodeURIComponent(selectedEnvironment)}`, options)
      setPolicyDeployments(Array.isArray(data) ? data : [])
      cacheStore.policy.ts = Date.now()
      return true
    } catch (err) {
      if (isLoginRequiredError(err)) return
      setPolicyDeployments([])
      setPolicyDeploymentsError('Failed to load policy context')
    } finally {
      setPolicyDeploymentsLoading(false)
    }
    return false
  }, [api, selectedEnvironment])

  const loadPolicySummary = useCallback(async () => {
    if (!service || !selectedEnvironment) return false
    setPolicySummaryStatus('checking')
    setPolicySummaryError('')
    try {
      const payload = { service, environment: selectedEnvironment }
      if (recipeId) {
        payload.recipeId = recipeId
      }
      const result = await api.post('/policy/summary', payload)
      if (result && result.code) {
        setPolicySummary(null)
        setPolicySummaryStatus('error')
        setPolicySummaryError(`${result.code}: ${result.message}`)
        return false
      }
      setPolicySummary(result)
      setPolicySummaryStatus('ok')
      return true
    } catch (err) {
      if (isLoginRequiredError(err)) return false
      setPolicySummary(null)
      setPolicySummaryStatus('error')
      setPolicySummaryError('Failed to load policy summary.')
    }
    return false
  }, [api, recipeId, service, selectedEnvironment])

  const refreshPolicyContext = useCallback(async (options = {}) => {
    const results = await Promise.allSettled([
      loadRecipes(options),
      loadDeliveryGroups(options),
      loadPolicyDeployments(options)
    ])
    const recipesOk = results[0].status === 'fulfilled' && results[0].value === true
    const groupsOk = results[1].status === 'fulfilled' && results[1].value !== null
    const policyOk = results[2].status === 'fulfilled' && results[2].value === true
    if (recipesOk && groupsOk && policyOk) {
      const now = Date.now()
      cacheStore.policy.ts = now
      setPolicyRefreshedAt(now)
      return true
    }
    return false
  }, [loadRecipes, loadDeliveryGroups, loadPolicyDeployments])

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
    const behaviorSummary = adminRecipeDraft.effective_behavior_summary.trim()
    const payload = {
      id: adminRecipeDraft.id.trim(),
      name: adminRecipeDraft.name.trim(),
      description: adminRecipeDraft.description.trim() || null,
      spinnaker_application: spinnakerApplication,
      deploy_pipeline: deployPipeline,
      rollback_pipeline: rollbackPipeline,
      effective_behavior_summary: behaviorSummary,
      status: adminRecipeDraft.status === 'deprecated' ? 'deprecated' : 'active'
    }
    const changeReason = adminRecipeDraft.change_reason.trim()
    if (changeReason) {
      payload.change_reason = changeReason
    }
    if (!payload.id) return { error: 'Recipe id is required.' }
    if (!payload.name) return { error: 'Recipe name is required.' }
    if (!payload.effective_behavior_summary) return { error: 'Effective behavior summary is required.' }
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

  function renderFailures(list, engineUrl) {
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
        {isPlatformAdmin && engineUrl && (
          <div className="links" style={{ marginTop: '12px' }}>
            <a className="link secondary" href={engineUrl} target="_blank" rel="noreferrer">
              Open execution detail
            </a>
          </div>
        )}
      </>
    )
  }

  const loadVersions = useCallback(async (refresh = false, options = {}) => {
    if (!service) {
      setVersionsLoading(false)
      setVersionsRefreshing(false)
      return false
    }
    if (refresh) {
      setVersionsRefreshing(true)
    } else {
      setVersionsLoading(true)
    }
    setVersionsError('')
    try {
      const suffix = refresh ? '?refresh=1' : ''
      const data = await api.get(`/services/${encodeURIComponent(service)}/versions${suffix}`, options)
      const list = Array.isArray(data?.versions) ? data.versions : []
      setVersions(list)
      const entry = getCacheEntry(cacheStore.versions, service)
      entry.ts = Date.now()
      return true
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
    return false
  }, [api, service])

  async function refreshData() {
    setRefreshing(true)
    const tasks = [
      refreshPolicyContext({ bypassCache: true }),
      loadVersions(true, { bypassCache: true })
    ]
    const results = await Promise.allSettled(tasks)
    const policyOk = results[0].status === 'fulfilled' && results[0].value === true
    const versionsOk = results[1].status === 'fulfilled' && results[1].value === true
    const ready = policyOk && versionsOk
    setDeployEntryReady(ready)
    if (!ready) {
      setErrorHeadline('Refresh required')
      setErrorMessage('Policy or versions could not be refreshed. Please retry.')
    }
    setRefreshing(false)
  }

  const loadInsights = useCallback(async (options = {}) => {
    setErrorMessage('')
    setErrorHeadline('')
    setInsightsError('')
    setInsightsLoading(true)
    try {
      const params = new URLSearchParams()
      params.set('windowDays', String(insightsWindowDays))
      if (insightsGroupId) params.set('groupId', insightsGroupId)
      if (insightsService) params.set('service', insightsService)
      const data = await api.get(`/insights/failures?${params.toString()}`, options)
      if (data && data.code) {
        setInsightsError(`${data.code}: ${data.message}`)
        setErrorHeadline('Insights')
        setErrorMessage(`${data.code}: ${data.message}`)
        setInsights(null)
        return
      }
      setInsights(data)
    } catch (err) {
      if (isLoginRequiredError(err)) return
      setInsightsError('Failed to load insights')
      setErrorHeadline('Insights')
      setErrorMessage('Failed to load insights')
      setInsights(null)
    } finally {
      setInsightsLoading(false)
    }
  }, [api, insightsWindowDays, insightsGroupId, insightsService])

  async function handleDeploy() {
    setErrorMessage('')
    setErrorHeadline('')
    setStatusMessage('')
    setDeployResult(null)
      setDeployInlineMessage('')
      setDeployInlineHeadline('')
    if (!validVersion) {
      setErrorMessage('Version format is invalid')
      return
    }
    if (!versionVerified) {
      setErrorMessage('Version must match a registered build.')
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
    if (!selectedEnvironment) {
      setErrorMessage('Select an environment before deploying.')
      return
    }
    const key = `deploy-${Date.now()}`
    const payload = {
      service,
      environment: selectedEnvironment,
      version,
      changeSummary,
      recipeId
    }
    const result = await api.post('/deployments', payload, key)
    if (result && result.code) {
      if (result.code === 'VERSION_NOT_FOUND') {
        setDeployInlineHeadline('Action required: build not registered by CI')
        setDeployInlineMessage(`VERSION_NOT_FOUND: ${versionNotFoundActionMessage(result)}`)
        return
      }
      const headline = failureCauseHeadline(result.failure_cause)
      const inlineMessages = {
        CONCURRENCY_LIMIT_REACHED: 'Deployment lock active for this delivery group.',
        QUOTA_EXCEEDED: 'Daily deploy quota exceeded for this delivery group.',
        INVALID_VERSION: 'Version format is invalid.',
        DEPLOYMENT_LOCKED: 'Deployment lock active for this delivery group.',
        RATE_LIMITED: 'Rate limit exceeded. Try again shortly or contact a platform admin.',
        RECIPE_NOT_ALLOWED: 'Selected recipe is not allowed for this delivery group.',
        RECIPE_INCOMPATIBLE: 'Selected recipe is not compatible with this service.',
        RECIPE_DEPRECATED: 'Selected recipe is deprecated and cannot be used for new deployments.',
        SERVICE_NOT_IN_DELIVERY_GROUP: 'Service is not assigned to a delivery group.',
        SERVICE_NOT_ALLOWLISTED: 'Service is not allowlisted.'
      }
      const inline = inlineMessages[result.code]
      if (inline) {
        setDeployInlineHeadline(headline)
        setDeployInlineMessage(`${result.code}: ${inline}`)
      } else {
        setErrorHeadline(headline)
        setErrorMessage(`${result.code}: ${result.message}`)
      }
      return
    }
    setDeployResult(result)
    setStatusMessage(`Deployment created with id ${result.id}`)
    setDeployStep('form')
    await refreshDeployments()
    await openDeployment(result)
  }

  const loadDeploymentDetail = useCallback(
    async (deploymentId) => {
      if (!deploymentId) return
      setDeploymentDetailLoading(true)
      setSelected(null)
      setFailures([])
      setTimeline([])
      setErrorMessage('')
      setErrorHeadline('')
      setStatusMessage('')
      try {
        const detail = await api.get(`/deployments/${deploymentId}`)
        if (detail && detail.code) {
          setErrorHeadline('')
          setErrorMessage(`${detail.code}: ${detail.message}`)
          return
        }
        setSelected(detail)
        const failureData = await api.get(`/deployments/${deploymentId}/failures`)
        setFailures(Array.isArray(failureData) ? failureData : [])
        const timelineData = await api.get(`/deployments/${deploymentId}/timeline`)
        setTimeline(Array.isArray(timelineData) ? timelineData : [])
        const entry = getCacheEntry(cacheStore.deploymentDetail, deploymentId)
        const now = Date.now()
        entry.ts = now
        setDeploymentDetailRefreshedAt(now)
      } catch (err) {
        if (isLoginRequiredError(err)) return
        setErrorHeadline('')
        setErrorMessage('Failed to load deployment detail')
      } finally {
        setDeploymentDetailLoading(false)
      }
    },
    [api]
  )

  const openDeployment = useCallback(
    (deployment) => {
      if (!deployment?.id) return
      if (view === 'deployments' && typeof window !== 'undefined') {
        deploymentsScrollRef.current = window.scrollY
      }
      setDeploymentDetailLoading(true)
      setSelected(null)
      setFailures([])
      setTimeline([])
      navigate(`/deployments/${encodeURIComponent(deployment.id)}`)
    },
    [navigate, view]
  )

  async function handleRollback() {
    if (!selected) return
    setErrorMessage('')
    setErrorHeadline('')
    setStatusMessage('')
    const ok = window.confirm('Confirm rollback?')
    if (!ok) return
    const key = `rollback-${Date.now()}`
    const result = await api.post(`/deployments/${selected.id}/rollback`, {}, key)
    if (result && result.code) {
      setErrorHeadline('')
      setErrorMessage(`${result.code}: ${result.message}`)
      return
    }
    setSelected(result)
    setFailures([])
    setStatusMessage(`Rollback started with id ${result.id}`)
    await refreshDeployments()
  }

  async function handleReviewPromotion() {
    const candidate = servicePromotionCandidate
    if (!candidate || !candidate.eligible) {
      setPromotionInlineError('Promotion is not eligible from this environment.')
      return
    }
    if (!promotionChangeSummary.trim()) {
      setPromotionInlineError('Change summary is required.')
      return
    }
    setPromotionInlineError('')
    setPromotionSubmitting(true)
    try {
      const payload = {
        service: serviceDetailName,
        source_environment: candidate.source_environment,
        target_environment: candidate.target_environment,
        version: candidate.version,
        recipeId: candidate.recipeId,
        changeSummary: promotionChangeSummary.trim()
      }
      const result = await api.post('/promotions/validate', payload)
      if (result && result.code) {
        setPromotionValidation(null)
        setPromotionInlineError(`${result.code}: ${result.message}`)
        setPromotionStep('form')
        return
      }
      setPromotionValidation(result)
      setPromotionStep('confirm')
    } finally {
      setPromotionSubmitting(false)
    }
  }

  async function handleConfirmPromotion() {
    if (!promotionValidation) return
    setPromotionInlineError('')
    setPromotionSubmitting(true)
    setErrorHeadline('')
    setErrorMessage('')
    setStatusMessage('')
    try {
      const payload = {
        service: promotionValidation.service,
        source_environment: promotionValidation.source_environment,
        target_environment: promotionValidation.target_environment,
        version: promotionValidation.version,
        recipeId: promotionValidation.recipeId,
        changeSummary: promotionChangeSummary.trim()
      }
      const key = `promote-${Date.now()}`
      const result = await api.post('/promotions', payload, key)
      if (result && result.code) {
        setPromotionInlineError(`${result.code}: ${result.message}`)
        return
      }
      setPromotionStep('form')
      setPromotionValidation(null)
      setPromotionChangeSummary('')
      setStatusMessage(`Promotion started with id ${result.id}`)
      await refreshDeployments()
      if (serviceDetailName) {
        await loadServiceDetail(serviceDetailName)
      }
      await openDeployment(result)
    } finally {
      setPromotionSubmitting(false)
    }
  }

  function handleBackToPromotionEdit() {
    setPromotionStep('form')
    setPromotionInlineError('')
  }

  const runPreflight = useCallback(
    async ({ advanceToConfirm }) => {
      if (!canRunPreflight || preflightStatus === 'checking') return false
      if (!service || !recipeId || !version) return false
      setPreflightStatus('checking')
      setPreflightError('')
      setPreflightErrorHeadline('')
      try {
        const payload = {
          service,
          environment: selectedEnvironment,
          version,
          changeSummary: trimmedChangeSummary,
          recipeId
        }
        const result = await api.post('/deployments/validate', payload)
        if (result && result.code) {
          if (result.code === 'VERSION_NOT_FOUND') {
            // Suppress repeated automatic preflight retries for the same unresolved version key.
            lastAutoPreflightFailedKeyRef.current = preflightKey
            setPreflightStatus('error')
            setPreflightErrorHeadline('Action required: build not registered by CI')
            setPreflightError(`VERSION_NOT_FOUND: ${versionNotFoundActionMessage(result)}`)
            return false
          }
          const messages = {
            CONCURRENCY_LIMIT_REACHED: 'Deployment lock active for this delivery group.',
            QUOTA_EXCEEDED: 'Daily deploy quota exceeded for this delivery group.',
            INVALID_VERSION: 'Version format is invalid.',
            RECIPE_NOT_ALLOWED: 'Selected recipe is not allowed for this delivery group.',
            RECIPE_INCOMPATIBLE: 'Selected recipe is not compatible with this service.',
            SERVICE_NOT_IN_DELIVERY_GROUP: 'Service is not assigned to a delivery group.',
            SERVICE_NOT_ALLOWLISTED: 'Service is not allowlisted.',
            ENVIRONMENT_NOT_ALLOWED: 'Environment is not allowed for this delivery group.',
            RECIPE_DEPRECATED: 'Selected recipe is deprecated and cannot be used for new deployments.',
            MUTATIONS_DISABLED: 'Deployments are currently disabled by the platform.',
            RATE_LIMITED: 'Rate limit exceeded. Try again shortly or contact a platform admin.'
          }
          const inline = messages[result.code]
          setPreflightStatus('error')
          setPreflightErrorHeadline('Fix these issues to continue')
          setPreflightError(`${result.code}: ${inline || result.message}`)
          return false
        }
        setPreflightResult(result)
        setPreflightStatus('ok')
      setValidatedIntentKey(preflightKey)
        if (advanceToConfirm) {
          setDeployStep('confirm')
        }
        return true
      } catch (err) {
        setPreflightStatus('error')
        setPreflightErrorHeadline('Fix these issues to continue')
        setPreflightError('Failed to check policy and guardrails.')
        return false
      }
    },
    [
      api,
      canRunPreflight,
      preflightStatus,
      service,
      recipeId,
      version,
      trimmedChangeSummary,
      preflightKey,
      selectedEnvironment
    ]
  )

  async function handleReviewDeploy() {
    if (!canRunPreflight || preflightStatus === 'checking') return
    // Manual review should always be allowed after user intent to retry.
    lastAutoPreflightFailedKeyRef.current = ''
    await runPreflight({ advanceToConfirm: true })
  }

  useEffect(() => {
    if (!authReady || !isAuthenticated) return
    loadServices()
    loadRecipes()
    loadDeliveryGroups()
    loadEnvironments()
  }, [authReady, isAuthenticated, loadServices, loadRecipes, loadDeliveryGroups, loadEnvironments])

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
  }, [authReady, isAuthenticated, isPlatformAdmin, view, adminTab, loadAuditEvents])

  useEffect(() => {
    if (!authReady || !isAuthenticated || !isPlatformAdmin) return
    if (view === 'admin' && adminTab === 'system-settings') {
      loadSystemRateLimits()
      loadSystemCiPublishers()
    }
  }, [authReady, isAuthenticated, isPlatformAdmin, view, adminTab, loadSystemRateLimits, loadSystemCiPublishers])

  useEffect(() => {
    if (!authReady || !isAuthenticated) return
    loadPublicSettings()
    if (isPlatformAdmin) {
      loadAdminSettings()
    } else {
      setAdminSettings(null)
    }
  }, [authReady, isAuthenticated, isPlatformAdmin, loadPublicSettings, loadAdminSettings])

  useEffect(() => {
    if (isPlatformAdmin) return
    if (adminTab === 'audit' || adminTab === 'system-settings') {
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
      setPolicySummary(null)
      setPolicySummaryStatus('idle')
      setPolicySummaryError('')
      setPolicyDeployments([])
      setPolicyDeploymentsError('')
      setPolicyDeploymentsLoading(false)
      setDeployInlineMessage('')
      setSelected(null)
      setFailures([])
      setTimeline([])
      setDeploymentDetailLoading(false)
      setInsights(null)
      setServicesView([])
      setServiceDetailName('')
      setServiceDetailStatus(null)
      setServiceDetailHistory([])
      setServiceDetailFailures([])
      setPromotionChangeSummary('')
      setPromotionStep('form')
      setPromotionValidation(null)
      setPromotionSubmitting(false)
      setPromotionInlineError('')
      setEnvironments([])
      setEnvironmentsLoading(false)
      setEnvironmentsError('')
      setSelectedEnvironment('')
      setEnvironmentAutoApplied(false)
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
      deployQueryAppliedRef.current = false
      lastPolicySummaryKeyRef.current = ''
    }
  }, [isAuthenticated])

  useEffect(() => {
    previousServiceRef.current = service
  }, [service])

  useEffect(() => {
    if (environmentsLoading) return
    if (environmentOptions.length === 0) {
      if (selectedEnvironment) {
        setSelectedEnvironment('')
        setEnvironmentAutoApplied(false)
      }
      return
    }
    const exists = environmentOptions.some((env) => env.name === selectedEnvironment)
    if (exists) return
    const next = pickDefaultEnvironment(environmentOptions)
    if (next) {
      setSelectedEnvironment(next)
      setEnvironmentAutoApplied(true)
    }
  }, [environmentOptions, selectedEnvironment, environmentsLoading])

  useEffect(() => {
    setPromotionChangeSummary('')
    setPromotionStep('form')
    setPromotionValidation(null)
    setPromotionSubmitting(false)
    setPromotionInlineError('')
  }, [serviceDetailName, selectedEnvironment])

  useEffect(() => {
    if (!authReady || !isAuthenticated) return
    if (!accessToken) return
    cacheStore.deployments.ts = 0
    cacheStore.servicesView.ts = 0
    cacheStore.policy.ts = 0
    setPolicySummary(null)
    setPolicySummaryStatus('idle')
    setPolicySummaryError('')
    setDeployInlineMessage('')
    setDeployInlineHeadline('')
    if (!selectedEnvironment) {
      setDeployments([])
      setServicesView([])
      setServiceDetailStatus(null)
      setServiceDetailHistory([])
      setServiceDetailFailures([])
      setPromotionValidation(null)
      setPromotionStep('form')
      setPromotionSubmitting(false)
      setPromotionInlineError('')
      setPolicyDeployments([])
      setPolicyDeploymentsError('')
      setPolicyDeploymentsLoading(false)
      setDeployEntryReady(false)
      return
    }
    if (view === 'services') {
      loadServicesList({ bypassCache: true })
    }
    if (view === 'deployments') {
      refreshDeployments({ bypassCache: true })
    }
    if (view === 'service' && serviceDetailName) {
      loadServiceDetail(serviceDetailName)
    }
  }, [
    selectedEnvironment,
    authReady,
    isAuthenticated,
    accessToken,
    view,
    serviceDetailName,
    service,
    loadServicesList,
    refreshDeployments,
    loadServiceDetail,
    refreshPolicyContext,
    loadVersions
  ])

  useEffect(() => {
    if (!isAuthenticated) return
    if (!currentDeliveryGroup || filteredRecipes.length === 0) {
      if (recipeId && previousServiceRef.current === service) {
        const alertKey = `recipe:${service}:${recipeId}`
        if (invalidationRef.current.recipe !== alertKey) {
          invalidationRef.current.recipe = alertKey
          setErrorHeadline('Selection needs review')
          setErrorMessage('Policy updated and cleared the selected recipe. Please re-select a recipe.')
        }
      }
      setRecipeId('')
      setRecipeAutoApplied(false)
      if (deployStep === 'confirm') {
        setDeployStep('form')
      }
      return
    }
    const allowedIds = filteredRecipes.map((recipe) => recipe.id)
    if (!allowedIds.includes(recipeId)) {
      if (recipeId && previousServiceRef.current === service) {
        const alertKey = `recipe:${service}:${recipeId}`
        if (invalidationRef.current.recipe !== alertKey) {
          invalidationRef.current.recipe = alertKey
          setErrorHeadline('Selection needs review')
          setErrorMessage('Policy updated and cleared the selected recipe. Please re-select a recipe.')
        }
      }
      if (allowedIds.length === 1) {
        setRecipeId(allowedIds[0])
        setRecipeAutoApplied(true)
        if (deployStep === 'confirm') {
          setDeployStep('form')
        }
      } else {
        setRecipeId('')
        setRecipeAutoApplied(false)
        if (deployStep === 'confirm') {
          setDeployStep('form')
        }
      }
    }
  }, [isAuthenticated, currentDeliveryGroup, filteredRecipes, recipeId, deployStep, service])

  useEffect(() => {
    if (!isAuthenticated) return
    setVersions([])
    setVersion('')
    setVersionMode('auto')
    setVersionSelection('none')
    setVersionAutoApplied(false)
    setDeployStep('form')
    if (service) {
      loadVersions()
      loadAllowedActions(service)
    }
  }, [service, isAuthenticated, accessToken, loadVersions, loadAllowedActions])

  useEffect(() => {
    if (!authReady || !isAuthenticated || view !== 'deploy') return
    if (!accessToken) return
    if (!service || !selectedEnvironment) return
    const bootstrapKey = `${service}|${selectedEnvironment}|${view}`
    if (lastDeployBootstrapKeyRef.current === bootstrapKey) return
    lastDeployBootstrapKeyRef.current = bootstrapKey
    setDeployEntryReady(false)
    const policyPromise = refreshPolicyContext({ bypassCache: true })
    const versionsPromise = loadVersions(true, { bypassCache: true })
    Promise.allSettled([policyPromise, versionsPromise]).then((results) => {
      const policyOk = results[0].status === 'fulfilled' && results[0].value === true
      const versionsOk = results[1].status === 'fulfilled' && results[1].value === true
      setDeployEntryReady(policyOk && versionsOk)
    })
  }, [authReady, isAuthenticated, accessToken, view, service, selectedEnvironment, refreshPolicyContext, loadVersions])

  useEffect(() => {
    if (view !== 'deploy') {
      lastDeployBootstrapKeyRef.current = ''
    }
  }, [view])

  useEffect(() => {
    if (!isAuthenticated) return
    if (service || services.length === 0) return
    const nextService = services[0]?.service_name
    if (!nextService) return
    setService(nextService)
  }, [isAuthenticated, service, services])

  useEffect(() => {
    if (!canRunPreflight) {
      setPreflightStatus('idle')
      setPreflightResult(null)
      setPreflightError('')
      setPreflightErrorHeadline('')
      setValidatedIntentKey('')
      lastAutoPreflightKeyRef.current = ''
      lastChangeSummaryFilledRef.current = false
      lastPreflightKeyRef.current = ''
      return
    }
    if (!service || !recipeId || !version) return
    const hasPrevKey = Boolean(lastPreflightKeyRef.current)
    const keyChanged = hasPrevKey && lastPreflightKeyRef.current !== preflightKey
    if (deployStep === 'confirm') {
      if (!keyChanged && validatedIntentKey && validatedIntentKey === preflightKey) {
        return
      }
      if (!keyChanged) {
        return
      }
      setDeployStep('form')
      setPreflightStatus('idle')
      setPreflightResult(null)
      setPreflightError('')
      setPreflightErrorHeadline('')
      setValidatedIntentKey('')
      lastAutoPreflightKeyRef.current = ''
      lastAutoPreflightFailedKeyRef.current = ''
      lastChangeSummaryFilledRef.current = false
      lastPreflightKeyRef.current = preflightKey
      return
    }
    if (!keyChanged && hasPrevKey) {
      return
    }
    setPreflightStatus('idle')
    setPreflightResult(null)
    setPreflightError('')
    setPreflightErrorHeadline('')
    lastAutoPreflightFailedKeyRef.current = ''
    lastPreflightKeyRef.current = preflightKey
  }, [
    canRunPreflight,
    service,
    recipeId,
    version,
    deployStep,
    preflightKey,
    validatedIntentKey
  ])

  useEffect(() => {
    if (!canRunPreflight || deployStep === 'confirm') return
    if (!preflightKey || preflightStatus === 'checking') return
    if (validatedIntentKey && validatedIntentKey === preflightKey && preflightStatus === 'ok') return
    const changeSummaryFilled = Boolean(trimmedChangeSummary)
    if (!changeSummaryFilled) {
      lastChangeSummaryFilledRef.current = false
      return
    }
    // Prevent an automatic retry loop for the same invalid intent key.
    if (lastAutoPreflightFailedKeyRef.current === preflightKey) return
    if (lastAutoPreflightKeyRef.current === preflightKey && lastChangeSummaryFilledRef.current) return
    lastAutoPreflightKeyRef.current = preflightKey
    lastChangeSummaryFilledRef.current = true
    runPreflight({ advanceToConfirm: false }).then((ok) => {
      if (!ok) {
        lastAutoPreflightFailedKeyRef.current = preflightKey
      }
    })
  }, [
    canRunPreflight,
    deployStep,
    preflightKey,
    preflightStatus,
    validatedIntentKey,
    runPreflight,
    trimmedChangeSummary
  ])

  useEffect(() => {
    if (!isAuthenticated || view !== 'deploy') return
    if (!policySummaryKey) {
      setPolicySummary(null)
      setPolicySummaryStatus('idle')
      setPolicySummaryError('')
      lastPolicySummaryKeyRef.current = ''
      return
    }
    if (lastPolicySummaryKeyRef.current === policySummaryKey) return
    lastPolicySummaryKeyRef.current = policySummaryKey
    setPolicySummary(null)
    setPolicySummaryStatus('idle')
    setPolicySummaryError('')
    loadPolicySummary()
  }, [isAuthenticated, view, policySummaryKey, loadPolicySummary])

  useEffect(() => {
    if (!isAuthenticated || !service || !accessToken) return
    if (actionInfo.loading) {
      loadAllowedActions(service)
    }
  }, [accessToken, actionInfo.loading, isAuthenticated, service, loadAllowedActions])

  useEffect(() => {
    if (!isPlatformAdmin) return
    if (adminGroupMode === 'create') return
    if (activeAdminGroup) {
      setAdminGroupDraft(buildGroupDraft(activeAdminGroup, adminGuardrailDefaults))
    } else if (!adminGroupId) {
      setAdminGroupDraft(buildGroupDraft(null, adminGuardrailDefaults))
    }
  }, [isPlatformAdmin, activeAdminGroup, adminGroupId, adminGroupMode, adminGuardrailDefaults])

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
    if (versionMode !== 'auto') return
    if (versions.length === 1 && versionSelection === 'none') {
      setVersion(versions[0].version)
      setVersionSelection('auto')
      setVersionAutoApplied(true)
      return
    }
    if (versions.length > 1 && versionSelection === 'none') {
      setVersion('')
      setVersionAutoApplied(false)
    }
    if (version && versions.length > 0 && !versions.find((item) => item.version === version)) {
      if (previousServiceRef.current === service) {
        const alertKey = `version:${service}:${version}`
        if (invalidationRef.current.version !== alertKey) {
          invalidationRef.current.version = alertKey
          setErrorHeadline('Selection needs review')
          setErrorMessage('Available versions changed and cleared the selected version. Please re-select a version.')
        }
      }
      setVersion('')
      setVersionAutoApplied(false)
      setVersionSelection('none')
    }
  }, [versions, versionMode, versionSelection, version, service])

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
  }, [view, service, isAuthenticated, refreshIntervalSeconds, loadVersions])

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
          const entry = getCacheEntry(cacheStore.deploymentDetail, selected.id)
          entry.ts = Date.now()
          const failureData = await api.get(`/deployments/${selected.id}/failures`)
          setFailures(Array.isArray(failureData) ? failureData : [])
          const timelineData = await api.get(`/deployments/${selected.id}/timeline`)
          setTimeline(Array.isArray(timelineData) ? timelineData : [])
        }
      } catch (err) {
        if (isLoginRequiredError(err)) return
        if (!cancelled) {
          setErrorHeadline('')
          setErrorMessage('Failed to refresh deployment status')
        }
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
  }, [view, selected?.id, isAuthenticated, refreshIntervalSeconds, api])

  useEffect(() => {
    if (!authReady || !isAuthenticated) return
    if (!deploymentId) {
      setDeploymentDetailLoading(false)
      return
    }
    const detailEntry = getCacheEntry(cacheStore.deploymentDetail, deploymentId)
    if (!isCacheFresh(detailEntry) || selected?.id !== deploymentId) {
      loadDeploymentDetail(deploymentId)
    }
  }, [authReady, isAuthenticated, deploymentId, selected?.id, loadDeploymentDetail])

  useEffect(() => {
    if (view !== 'service') return
    if (!routeServiceName) return
    const decodedName = decodeURIComponent(routeServiceName)
    if (decodedName !== serviceDetailName) {
      setServiceDetailName(decodedName)
      setServiceDetailTab('overview')
    }
  }, [view, routeServiceName, serviceDetailName])

  useEffect(() => {
    if (view === 'service') return
    if (serviceDetailName) {
      setServiceDetailName('')
    }
  }, [view, serviceDetailName])

  useEffect(() => {
    if (!authReady || !isAuthenticated) return
    if (view !== 'service' || !serviceDetailName) return
    // Service detail should refresh on entry even if route state arrives before name is set.
    loadServiceDetail(serviceDetailName)
  }, [authReady, isAuthenticated, view, serviceDetailName, loadServiceDetail])

  useEffect(() => {
    if (!isAuthenticated || view !== 'insights') return
    if (!isPlatformAdmin && !insightsDefaultsApplied) return
    loadInsights()
  }, [view, isAuthenticated, insightsDefaultsApplied, isPlatformAdmin, loadInsights])

  useEffect(() => {
    if (!isAuthenticated || view !== 'deploy' || !deployQueryParams) return
    const queryService = deployQueryParams.service
    const queryRecipe = deployQueryParams.recipe
    const queryVersion = deployQueryParams.version

    if (queryService) {
      if (services.length === 0) return
      const exists = services.some((svc) => svc.service_name === queryService)
      if (!exists) {
        const alertKey = `deploy:service:${queryService}`
        if (queryAlertRef.current.deployService !== alertKey) {
          queryAlertRef.current.deployService = alertKey
          setErrorHeadline('Invalid URL parameter')
          setErrorMessage(`Service "${queryService}" is not available for deployment. Clearing selection.`)
        }
        setService('')
        setDeployQueryParams((prev) => (prev ? { ...prev, service: '' } : prev))
        deployQueryAppliedRef.current = true
        setDeployUrlSyncEnabled(true)
        return
      }
      if (service !== queryService) {
        if (!deployQueryAppliedRef.current) {
          setService(queryService)
          deployQueryAppliedRef.current = true
          return
        }
        setDeployUrlSyncEnabled(true)
        return
      }
      if (!deployQueryAppliedRef.current) {
        deployQueryAppliedRef.current = true
      }
    }

    if (queryRecipe) {
      if (!service) return
      if (queryService && service !== queryService) return
      if (!deployEntryReady && (recipes.length === 0 || deliveryGroups.length === 0)) return
      const match = filteredRecipes.find((recipe) => recipe.id === queryRecipe)
      const invalidRecipe = !match || match.status === 'deprecated'
      if (invalidRecipe) {
        const alertKey = `deploy:recipe:${queryRecipe}`
        if (queryAlertRef.current.deployRecipe !== alertKey) {
          queryAlertRef.current.deployRecipe = alertKey
          setErrorHeadline('Invalid URL parameter')
          setErrorMessage(`Recipe "${queryRecipe}" is not available for this service. Clearing selection.`)
        }
        setRecipeId('')
        setRecipeAutoApplied(false)
        setDeployQueryParams((prev) => (prev ? { ...prev, recipe: '' } : prev))
        return
      }
      if (recipeId !== queryRecipe) {
        setRecipeId(queryRecipe)
        setRecipeAutoApplied(false)
        return
      }
    }

    if (queryVersion) {
      if (!service) return
      if (queryService && service !== queryService) return
      if (versionsLoading || versionsRefreshing) return
      const match = versions.find((item) => item.version === queryVersion)
      if (!match) {
        const alertKey = `deploy:version:${queryVersion}`
        if (queryAlertRef.current.deployVersion !== alertKey) {
          queryAlertRef.current.deployVersion = alertKey
          setErrorHeadline('Invalid URL parameter')
          setErrorMessage(`Version "${queryVersion}" is not available for this service. Clearing selection.`)
        }
        setVersion('')
        setVersionMode('auto')
        setVersionSelection('none')
        setVersionAutoApplied(false)
        setDeployQueryParams((prev) => (prev ? { ...prev, version: '' } : prev))
        return
      }
      if (version !== queryVersion || versionMode !== 'auto') {
        setVersionMode('auto')
        setVersion(queryVersion)
        setVersionSelection('user')
        setVersionAutoApplied(false)
        return
      }
    }

    setDeployUrlSyncEnabled(true)
  }, [
    isAuthenticated,
    view,
    deployQueryParams,
    deployEntryReady,
    services,
    service,
    recipes,
    deliveryGroups,
    filteredRecipes,
    recipeId,
    versions,
    versionsLoading,
    versionsRefreshing,
    version,
    versionMode
  ])

  useEffect(() => {
    if (!isAuthenticated || view !== 'deployments') return
    if (!deploymentsQueryService) {
      if (deploymentsFilterService) {
        setDeploymentsFilterService('')
      }
      setDeploymentsUrlSyncEnabled(true)
      return
    }
    if (services.length === 0) return
    const exists = services.some((svc) => svc.service_name === deploymentsQueryService)
    if (!exists) {
      const alertKey = `deployments:service:${deploymentsQueryService}`
      if (queryAlertRef.current.deploymentsService !== alertKey) {
        queryAlertRef.current.deploymentsService = alertKey
        setErrorHeadline('Invalid URL parameter')
        setErrorMessage(`Service "${deploymentsQueryService}" is not available. Showing all deployments.`)
      }
      setDeploymentsFilterService('')
      setDeploymentsUrlSyncEnabled(true)
      return
    }
    if (deploymentsFilterService !== deploymentsQueryService) {
      setDeploymentsFilterService(deploymentsQueryService)
    }
    setDeploymentsUrlSyncEnabled(true)
  }, [isAuthenticated, view, deploymentsQueryService, deploymentsFilterService, services])

  useEffect(() => {
    if (!authReady || !isAuthenticated) return
    const routeKey = location.key || currentPath
    if (lastRouteKeyRef.current === routeKey) return
    lastRouteKeyRef.current = routeKey
    if (view === 'deploy') {
      const currentSearch = location.search || ''
      const syncKey = `${currentPath}${currentSearch}`
      if (urlSyncRef.current.deploy === syncKey) {
        urlSyncRef.current.deploy = ''
      } else {
        const params = new URLSearchParams(currentSearch)
        const query = {
          service: (params.get('service') || '').trim(),
          recipe: (params.get('recipe') || '').trim(),
          version: (params.get('version') || '').trim()
        }
        const hasQuery = Boolean(query.service || query.recipe || query.version)
        setDeployQueryParams(hasQuery ? query : null)
        setDeployUrlSyncEnabled(!hasQuery)
      }
    } else if (view === 'deployments') {
      const currentSearch = location.search || ''
      const syncKey = `${currentPath}${currentSearch}`
      if (urlSyncRef.current.deployments === syncKey) {
        urlSyncRef.current.deployments = ''
      } else {
        const params = new URLSearchParams(currentSearch)
        const queryService = (params.get('service') || '').trim()
        setDeploymentsQueryService(queryService)
        setDeploymentsUrlSyncEnabled(false)
      }
    } else {
      setDeployQueryParams(null)
      setDeployUrlSyncEnabled(false)
      setDeploymentsQueryService('')
      setDeploymentsUrlSyncEnabled(false)
    }

    // Deterministic refresh rules on route entry (TTL-based, in-memory cache only).
    if (view === 'services') {
      if (!isCacheFresh(cacheStore.servicesView) || servicesView.length === 0) {
        loadServicesList()
      }
    }

    if (view === 'deploy') {
      setDeployEntryReady(false)
      const versionsEntry = service ? getCacheEntry(cacheStore.versions, service) : null
      const versionsFresh = service && isCacheFresh(versionsEntry)
      const policyPromise = refreshPolicyContext()
      const versionsPromise = service ? loadVersions(!versionsFresh) : Promise.resolve(true)
      const actionsPromise = service ? loadAllowedActions(service) : Promise.resolve(true)
      Promise.allSettled([policyPromise, versionsPromise, actionsPromise]).then((results) => {
        if (lastRouteKeyRef.current !== routeKey) return
        const policyOk = results[0].status === 'fulfilled' && results[0].value === true
        const versionsOk = results[1].status === 'fulfilled' && results[1].value === true
        const ready = policyOk && versionsOk
        setDeployEntryReady(ready)
        if (!ready) {
          setErrorHeadline('Refresh required')
          setErrorMessage('Policy or versions could not be refreshed. Please retry.')
        }
      })
    } else {
      setDeployEntryReady(true)
    }

    if (view === 'deployments') {
      if (!isCacheFresh(cacheStore.deployments) || deployments.length === 0) {
        refreshDeployments()
      }
    }

    if (view === 'detail' && deploymentId) {
      const detailEntry = getCacheEntry(cacheStore.deploymentDetail, deploymentId)
      if (!isCacheFresh(detailEntry) || selected?.id !== deploymentId) {
        loadDeploymentDetail(deploymentId)
      }
    }

    if (view === 'service' && serviceDetailName) {
      loadServiceDetail(serviceDetailName)
    }

    if (
      view === 'deployments' &&
      lastViewRef.current === 'detail' &&
      typeof window !== 'undefined'
    ) {
      window.requestAnimationFrame(() => window.scrollTo(0, deploymentsScrollRef.current || 0))
    }
    lastViewRef.current = view
  }, [
    authReady,
    isAuthenticated,
    location.key,
    location.search,
    currentPath,
    view,
    deploymentId,
    serviceDetailName,
    service,
    servicesView.length,
    deployments.length,
    selected?.id,
    loadServicesList,
    refreshPolicyContext,
    loadVersions,
    loadAllowedActions,
    refreshDeployments,
    loadDeploymentDetail,
    loadServiceDetail
  ])

  useEffect(() => {
    if (!deployUrlSyncEnabled || view !== 'deploy') return
    const params = new URLSearchParams()
    if (service) params.set('service', service)
    if (recipeId) params.set('recipe', recipeId)
    if (version) params.set('version', version)
    const nextSearch = params.toString()
    const currentSearch = (location.search || '').replace(/^\?/, '')
    if (nextSearch === currentSearch) return
    const nextPath = nextSearch ? `${location.pathname}?${nextSearch}` : location.pathname
    urlSyncRef.current.deploy = nextPath
    navigate(nextPath)
  }, [deployUrlSyncEnabled, view, service, recipeId, version, location.pathname, location.search, navigate])

  useEffect(() => {
    if (!deploymentsUrlSyncEnabled || view !== 'deployments') return
    const params = new URLSearchParams()
    if (deploymentsFilterService) params.set('service', deploymentsFilterService)
    const nextSearch = params.toString()
    const currentSearch = (location.search || '').replace(/^\?/, '')
    if (nextSearch === currentSearch) return
    const nextPath = nextSearch ? `${location.pathname}?${nextSearch}` : location.pathname
    urlSyncRef.current.deployments = nextPath
    navigate(nextPath)
  }, [deploymentsUrlSyncEnabled, view, deploymentsFilterService, location.pathname, location.search, navigate])

  const selectedService = services.find((s) => s.service_name === selected?.service)
  let serviceUrl = ''
  if (selectedService?.stable_service_url_template) {
    serviceUrl = selectedService.stable_service_url_template
      .replace('{service}', selected?.service || '')
      .replace('{version}', selected?.version || '')
  } else if (SERVICE_URL_BASE && selected) {
    serviceUrl = `${SERVICE_URL_BASE}/${selected.service}`
  }

  const navigateToServices = useCallback(() => {
    navigate('/services')
  }, [navigate])

  const handleEnvironmentChange = useCallback((value) => {
    setSelectedEnvironment(value)
    setEnvironmentAutoApplied(false)
  }, [])

  const navigateToService = useCallback(
    (serviceName) => {
      if (!serviceName) return
      navigate(`/services/${encodeURIComponent(serviceName)}`)
    },
    [navigate]
  )

  const navigateToDeploy = useCallback(() => {
    navigate('/deploy')
  }, [navigate])

  const servicesListStatusItems = servicesViewLoading
    ? [{ label: 'Data', value: 'loading' }]
    : servicesRefreshedAt
      ? [{ label: 'Data refreshed', value: formatTime(servicesRefreshedAt) }]
      : [{ label: 'Data', value: 'ready' }]

  const serviceDetailStatusItems = serviceDetailLoading
    ? [{ label: 'Data', value: 'loading' }]
    : serviceDetailRefreshedAt
      ? [{ label: 'Data refreshed', value: formatTime(serviceDetailRefreshedAt) }]
      : [{ label: 'Data', value: 'ready' }]

  const environmentHeaderMessage = environmentsLoading
    ? 'Loading environments...'
    : environmentsError
      ? environmentsError
      : !hasEnvironmentsConfigured
        ? 'No environments configured.'
        : ''
  const environmentHeaderNote = environmentHeaderMessage || environmentScopeNote
  const selectedEnvironmentEntry = environmentOptions.find((env) => env.name === selectedEnvironment)
  const environmentDisplayName = selectedEnvironment
    ? environmentLabel(selectedEnvironmentEntry) || selectedEnvironment
    : (hasEnvironmentsConfigured ? 'Not selected' : 'None configured')
  const environmentEmptyState = !hasEnvironmentsConfigured ? 'No environments configured. Ask a platform admin.' : ''
  const servicesEnvironmentNotice =
    environmentEmptyState || (selectedEnvironment ? '' : 'Select an environment to view running state.')
  const deploymentsEnvironmentNotice =
    environmentEmptyState || (selectedEnvironment ? '' : 'Select an environment to view deployments.')
  const deployEnvironmentNotice =
    environmentEmptyState || (selectedEnvironment ? '' : 'Select an environment to deploy.')

  const policyStatusItems = [
    {
      label: 'Policy',
      value:
        policySummaryStatus === 'checking' || policyDeploymentsLoading || refreshing ? 'loading' : 'loaded'
    }
  ]
  if (policyRefreshedAt) {
    policyStatusItems.push({ label: 'Data refreshed', value: formatTime(policyRefreshedAt) })
  }

  const deploymentsStatusItems = deploymentsLoading
    ? [{ label: 'Data', value: 'loading' }]
    : deploymentsRefreshedAt
      ? [{ label: 'Data refreshed', value: formatTime(deploymentsRefreshedAt) }]
      : [{ label: 'Data', value: 'ready' }]

  const deploymentDetailStatusItems = deploymentDetailLoading
    ? [{ label: 'Data', value: 'loading' }]
    : deploymentDetailRefreshedAt
      ? [{ label: 'Data refreshed', value: formatTime(deploymentDetailRefreshedAt) }]
      : [{ label: 'Data', value: 'ready' }]

  const servicesPageProps = {
    servicesView,
    servicesViewLoading,
    loadServicesList,
    setServiceDetailTab,
    navigateToService,
    navigateToServices,
    navigateToDeploy,
    statusClass,
    formatTime,
    serviceDetailName,
    serviceDetailTab,
    serviceDetailLoading,
    serviceDetailRunning,
    serviceDetailLatest,
    serviceDetailGroup,
    serviceDetailFailures,
    serviceDetailHistory,
    serviceDetailStatus,
    backstageEntityRef,
    backstageEntityUrl,
    isPlatformAdmin,
    openDeployment,
    deploymentKindLabel,
    shortId,
    outcomeTone,
    outcomeLabel,
    outcomeDisplayLabel,
    resolveDeploymentKind,
    resolveOutcome,
    getRecipeDisplay,
    getRollbackIdFor,
    renderFailures,
    setService,
    environmentLabel: environmentDisplayName,
    environmentReady,
    environmentNotice: servicesEnvironmentNotice,
    servicePromotionCandidate,
    promotionChangeSummary,
    setPromotionChangeSummary,
    promotionStep,
    promotionValidation,
    promotionSubmitting,
    promotionInlineError,
    handleReviewPromotion,
    handleConfirmPromotion,
    handleBackToPromotionEdit,
    listHeaderMeta: <HeaderStatus items={servicesListStatusItems} />,
    detailHeaderMeta: <HeaderStatus items={serviceDetailStatusItems} />
  }

  const deployPageProps = {
    refreshData,
    refreshing,
    deployStep,
    service,
    services,
    loadServices,
    setService,
    setDeployStep,
    currentDeliveryGroup,
    filteredRecipes,
    recipeId,
    setRecipeId,
    setRecipeAutoApplied,
    selectedRecipe,
    recipeAutoApplied,
    selectedRecipeDeprecated,
    versionMode,
    version,
    setVersion,
    setVersionMode,
    setVersionSelection,
    setVersionAutoApplied,
    versions,
    versionsLoading,
    versionsRefreshing,
    versionsError,
    validVersion,
    versionAutoApplied,
    versionUnverifiable,
    changeSummary,
    setChangeSummary,
    preflightResult,
    preflightStatus,
    preflightError,
    preflightErrorHeadline,
    policySummary,
    policySummaryStatus,
    policySummaryError,
    debugDeployGatesEnabled,
    canDeploy,
    canRunPreflight,
    deployDisabledReason,
    canReviewDeploy,
    handleReviewDeploy,
    deployInlineMessage,
    deployInlineHeadline,
    selectedRecipeNarrative,
    policyQuotaStats,
    handleDeploy,
    policyDeploymentsLoading,
    policyDeploymentsError,
    deployResult,
    latestPolicyDeployment,
    statusClass,
    isPlatformAdmin,
    openDeployment,
    versionVerified,
    trimmedChangeSummary,
    environmentLabel: environmentDisplayName,
    environmentNotice: deployEnvironmentNotice,
    environmentScopeNote,
    environmentAutoApplied,
    headerMeta: <HeaderStatus items={policyStatusItems} />
  }

  const deploymentsPageProps = {
    deployments: visibleDeployments,
    refreshDeployments,
    openDeployment,
    statusClass,
    formatTime,
    environmentLabel: environmentDisplayName,
    environmentNotice: deploymentsEnvironmentNotice,
    headerMeta: <HeaderStatus items={deploymentsStatusItems} />
  }

  const deploymentDetailPageProps = {
    selected,
    statusClass,
    selectedValidatedAt,
    selectedExecutionAt,
    outcomeTone,
    outcomeDisplayLabel,
    resolveDeploymentKind,
    resolveOutcome,
    selectedRollbackId,
    shortId,
    openDeployment,
    deploymentKindLabel,
    getRecipeDisplay,
    formatTime,
    serviceUrl,
    isPlatformAdmin,
    handleRollback,
    canRollback,
    rollbackDisabledReason,
    timelineSteps,
    failures,
    renderFailures,
    deploymentLoading: deploymentDetailLoading,
    headerMeta: <HeaderStatus items={deploymentDetailStatusItems} />
  }

  const settingsPageProps = {
    minRefreshSeconds,
    maxRefreshSeconds,
    refreshMinutesInput,
    handleRefreshMinutesChange,
    userSettingsKey,
    defaultRefreshSeconds,
    refreshInputError,
    refreshClampNote,
    refreshIntervalMinutes,
    isPlatformAdmin,
    adminSettings
  }

  const adminPageProps = {
    adminReadOnly,
    adminTab,
    setAdminTab,
    isPlatformAdmin,
    startAdminGroupCreate,
    deliveryGroups,
    summarizeGuardrails,
    setAdminGroupMode,
    setAdminGroupId,
    setAdminGroupError,
    setAdminGroupNote,
    startAdminGroupEdit,
    adminGroupMode,
    activeAdminGroup,
    formatAuditValue,
    getRecipeLabel,
    adminGroupDraft,
    handleAdminGroupDraftChange,
    adminGroupSaving,
    validateAdminGroupDraft,
    adminGroupValidation,
    adminGroupConfirmWarning,
    setAdminGroupConfirmWarning,
    sortedServiceNames,
    toggleAdminGroupService,
    sortedRecipes,
    toggleAdminGroupRecipe,
    handleAdminGuardrailChange,
    adminSettings,
    adminServiceDiff,
    adminRecipeDiff,
    adminServiceConflicts,
    adminGroupError,
    adminGroupNote,
    saveAdminGroup,
    buildGroupDraft,
    adminGuardrailDefaults,
    startAdminRecipeCreate,
    recipes,
    recipeUsageCounts,
    recipeStatusLabel,
    setAdminRecipeMode,
    setAdminRecipeId,
    setAdminRecipeError,
    setAdminRecipeNote,
    startAdminRecipeEdit,
    adminRecipeMode,
    activeAdminRecipe,
    activeAdminRecipeUsage,
    adminRecipeDraft,
    handleAdminRecipeDraftChange,
    adminRecipeSaving,
    validateAdminRecipeDraft,
    adminRecipeValidation,
    adminRecipeConfirmWarning,
    setAdminRecipeConfirmWarning,
    adminRecipeError,
    adminRecipeNote,
    saveAdminRecipe,
    buildRecipeDraft,
    loadAuditEvents,
    auditLoading,
    auditError,
    auditEvents,
    systemRateLimitDraft,
    handleSystemRateLimitDraftChange,
    saveSystemRateLimits,
    loadSystemRateLimits,
    systemRateLimitLoading,
    systemRateLimitSaving,
    systemRateLimitDirty:
      String(systemRateLimitDraft.read_rpm).trim() !== String(systemRateLimitBaseline.read_rpm).trim() ||
      String(systemRateLimitDraft.mutate_rpm).trim() !== String(systemRateLimitBaseline.mutate_rpm).trim(),
    systemRateLimitError,
    systemRateLimitNote,
    systemCiPublishersDraft,
    handleSystemCiPublishersDraftChange,
    saveSystemCiPublishers,
    loadSystemCiPublishers,
    systemCiPublishersLoading,
    systemCiPublishersSaving,
    systemCiPublishersDirty: String(systemCiPublishersDraft).trim() !== String(systemCiPublishersBaseline).trim(),
    systemCiPublishersError,
    systemCiPublishersNote
  }

  const infoItems = []
  if (!authReady) {
    infoItems.push({ headline: 'Session', message: 'Loading session...' })
  }
  if (authReady && !isAuthenticated && !authError) {
    infoItems.push({
      headline: 'Login required',
      message: 'Use the Login button in the top navigation to sign in.'
    })
  }
  if (statusMessage) {
    infoItems.push({ headline: 'Status', message: statusMessage })
  }

  return (
    <AppShell
      refreshDeployments={refreshDeployments}
      loadInsights={loadInsights}
      user={user}
      isAuthenticated={isAuthenticated}
      authReady={authReady}
      handleLogin={handleLogin}
      handleLogout={handleLogout}
      derivedRole={derivedRole}
      currentDeliveryGroup={currentDeliveryGroup}
      environmentOptions={environmentOptions}
      selectedEnvironment={selectedEnvironment}
      onEnvironmentChange={handleEnvironmentChange}
      environmentLoading={environmentsLoading}
      environmentNote={environmentHeaderNote}
      environmentAutoApplied={environmentAutoApplied}
      alertRail={
        <AlertRail
          errorMessage={errorMessage}
          errorHeadline={errorHeadline}
          authError={authError}
          infoItems={infoItems}
        />
      }
    >
      {authReady && isAuthenticated && (
        <Routes>
          <Route path="/" element={<Navigate to="/services" replace />} />
          <Route path="/services" element={<ServicesPage mode="list" {...servicesPageProps} />} />
          <Route path="/services/:serviceName" element={<ServicesPage mode="detail" {...servicesPageProps} />} />
          <Route path="/deploy" element={<DeployPage {...deployPageProps} />} />
          <Route path="/deployments" element={<DeploymentsPage {...deploymentsPageProps} />} />
          <Route path="/deployments/:deploymentId" element={<DeploymentDetailPage {...deploymentDetailPageProps} />} />
          <Route
            path="/insights"
            element={
              <div className="shell">
                <div className="page-header-zone">
                  <PageHeader
                    title="Insights"
                    actions={
                      <button
                        className="button secondary"
                        onClick={() => loadInsights({ bypassCache: true })}
                        disabled={insightsLoading}
                      >
                        {insightsLoading ? 'Refreshing...' : 'Refresh'}
                      </button>
                    }
                  />
                </div>
                <SectionCard style={{ gridColumn: '1 / -1' }}>
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
                </SectionCard>
              </div>
            }
          />
          <Route path="/settings" element={<SettingsPage {...settingsPageProps} />} />
          <Route path="/admin" element={<AdminPage {...adminPageProps} />} />
          <Route path="*" element={<Navigate to="/services" replace />} />
        </Routes>
      )}

      <footer className="footer">
        DXCP UI. Guardrails enforced by the API: allowlist, environment policy, per-group lock, rate limits, idempotency.
      </footer>
    </AppShell>
  )
}
