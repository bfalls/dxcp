import { render, cleanup, fireEvent, waitFor } from '@testing-library/react'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { MemoryRouter } from 'react-router-dom'
import App from '../App.jsx'
import { createApiClient } from '../apiClient.js'
import { appendFileSync, readFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'

const ok = (data) =>
  Promise.resolve({
    json: () => Promise.resolve(data)
  })

const withStatus = (status, data = null) => {
  const textBody = data === null || typeof data === 'undefined' ? '' : JSON.stringify(data)
  return Promise.resolve({
    status,
    ok: status >= 200 && status < 300,
    text: () => Promise.resolve(textBody),
    json: () => Promise.resolve(data)
  })
}

const renderApp = (initialPath = '/services') =>
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <App />
    </MemoryRouter>
  )

const buildFetchMock = ({
  role,
  deployAllowed,
  rollbackAllowed,
  deployResponse,
  timeline,
  failures,
  deliveryGroups,
  recipes,
  servicesList,
  guardrailValidation,
  preflightResponse,
  promotionValidateResponse,
  promotionResponse,
  policySummaryResponse,
  versionsByService,
  environments,
  adminEnvironments,
  deleteRecipeResponses,
  uiExposureArtifactRefDisplay,
  uiExposureExternalLinksDisplay,
  buildCommitUrl,
  buildRunUrl
}) => {
  let groups = deliveryGroups || [
    {
      id: 'default',
      name: 'Default Delivery Group',
      services: ['demo-service'],
      allowed_recipes: ['default'],
      guardrails: { daily_deploy_quota: 5, daily_rollback_quota: 3, max_concurrent_deployments: 1 }
    }
  ]
  let recipeList =
    recipes || [
      {
        id: 'default',
        name: 'Default Deploy',
        status: 'active',
        recipe_revision: 1,
        effective_behavior_summary: 'Standard roll-forward deploy with rollback support.'
      }
    ]
  const serviceList = servicesList || [{ service_name: 'demo-service' }]
  const resolveEnvironments = () =>
    environments ||
    groups.map((group, idx) => ({
      id: `env-${group.id || idx}`,
      name: idx === 0 ? 'sandbox' : `${group.id || `group-${idx}`}-env`,
      type: 'non_prod',
      delivery_group_id: group.id || 'default',
      is_enabled: true
    }))
  let uiExposurePolicy = {
    artifactRef: { display: uiExposureArtifactRefDisplay === true },
    externalLinks: { display: uiExposureExternalLinksDisplay === true }
  }
  let adminEnvList =
    adminEnvironments || [
      { environment_id: 'sandbox', display_name: 'Sandbox', type: 'non_prod', is_enabled: true }
    ]
  const dgBindingsByGroup = new Map()
  const routesByService = new Map()
  return async (url, options = {}) => {
    const parsed = new URL(url)
    const { pathname } = parsed
    if (pathname === '/v1/delivery-groups' && options.method === 'POST') {
      const body = JSON.parse(options.body || '{}')
      const serviceConflict = body.services?.find((svc) =>
        groups.some((group) => group.id !== body.id && group.services?.includes(svc))
      )
      if (serviceConflict) {
        return ok({ code: 'SERVICE_ALREADY_ASSIGNED', message: 'Service already assigned' })
      }
      groups = [...groups, body]
      return ok(body)
    }
    if (pathname.startsWith('/v1/delivery-groups/') && options.method === 'PUT') {
      const body = JSON.parse(options.body || '{}')
      const groupId = pathname.split('/').pop()
      const serviceConflict = body.services?.find((svc) =>
        groups.some((group) => group.id !== groupId && group.services?.includes(svc))
      )
      if (serviceConflict) {
        return ok({ code: 'SERVICE_ALREADY_ASSIGNED', message: 'Service already assigned' })
      }
      groups = groups.map((group) => (group.id === groupId ? body : group))
      return ok(body)
    }
    if (pathname === '/v1/deployments' && options.method === 'POST') {
      return ok(deployResponse || { id: 'dep-1', service: 'demo-service', version: '2.1.0', state: 'IN_PROGRESS' })
    }
    if (pathname === '/v1/deployments/validate' && options.method === 'POST') {
      if (preflightResponse) {
        return ok(preflightResponse)
      }
      const body = JSON.parse(options.body || '{}')
      return ok({
        service: body.service,
        environment: body.environment,
        version: body.version,
        recipeId: body.recipeId,
        deliveryGroupId: 'default',
        versionRegistered: true,
        policy: {
          max_concurrent_deployments: 1,
          current_concurrent_deployments: 0,
          daily_deploy_quota: 5,
          deployments_used: 0,
          deployments_remaining: 5
        },
        validatedAt: '2025-01-01T00:00:00Z'
      })
    }
    if (pathname === '/v1/promotions/validate' && options.method === 'POST') {
      if (promotionValidateResponse) {
        return ok(promotionValidateResponse)
      }
      const body = JSON.parse(options.body || '{}')
      return ok({
        service: body.service,
        source_environment: body.source_environment,
        target_environment: body.target_environment,
        version: body.version,
        recipeId: 'default',
        deliveryGroupId: 'default',
        versionEligible: true,
        policy: {
          max_concurrent_deployments: 1,
          current_concurrent_deployments: 0,
          daily_deploy_quota: 5,
          deployments_used: 0,
          deployments_remaining: 5
        },
        validatedAt: '2025-01-01T00:00:00Z'
      })
    }
    if (pathname === '/v1/promotions' && options.method === 'POST') {
      if (promotionResponse) {
        return ok(promotionResponse)
      }
      const body = JSON.parse(options.body || '{}')
      return ok({
        id: 'dep-1',
        service: body.service,
        environment: body.target_environment,
        sourceEnvironment: body.source_environment,
        version: body.version,
        recipeId: 'default',
        state: 'IN_PROGRESS',
        deploymentKind: 'PROMOTE'
      })
    }
    if (pathname === '/v1/policy/summary' && options.method === 'POST') {
      if (policySummaryResponse) {
        return ok(policySummaryResponse)
      }
      const body = JSON.parse(options.body || '{}')
      return ok({
        service: body.service,
        environment: body.environment,
        recipeId: body.recipeId || null,
        deliveryGroupId: 'default',
        policy: {
          max_concurrent_deployments: 1,
          current_concurrent_deployments: 0,
          daily_deploy_quota: 5,
          deployments_used: 0,
          deployments_remaining: 5
        },
        generatedAt: '2025-01-01T00:00:00Z'
      })
    }
    if (pathname === '/v1/settings/public') {
      return ok({
        default_refresh_interval_seconds: 300,
        min_refresh_interval_seconds: 60,
        max_refresh_interval_seconds: 3600,
        mutations_disabled: false
      })
    }
    if (pathname === '/v1/admin/system/mutations-disabled' && (!options.method || options.method === 'GET')) {
      return ok({
        mutations_disabled: false,
        source: 'ssm'
      })
    }
    if (pathname === '/v1/admin/system/mutations-disabled' && options.method === 'PUT') {
      const body = JSON.parse(options.body || '{}')
      return ok({
        mutations_disabled: body.mutations_disabled === true,
        source: 'ssm'
      })
    }
    if (pathname === '/v1/ui/policy/ui-exposure') {
      return ok({
        policy: uiExposurePolicy,
        source: 'ssm'
      })
    }
    if (pathname === '/v1/admin/system/ui-exposure-policy' && (!options.method || options.method === 'GET')) {
      return ok({
        policy: uiExposurePolicy,
        source: 'ssm'
      })
    }
    if (pathname === '/v1/admin/system/ui-exposure-policy' && options.method === 'PUT') {
      const body = JSON.parse(options.body || '{}')
      uiExposurePolicy = {
        artifactRef: { display: body?.artifactRef?.display === true },
        externalLinks: { display: body?.externalLinks?.display === true }
      }
      return ok({
        policy: uiExposurePolicy,
        source: 'ssm'
      })
    }
    if (pathname === '/v1/settings/admin') {
      return ok({
        default_refresh_interval_seconds: 300,
        min_refresh_interval_seconds: 60,
        max_refresh_interval_seconds: 3600
      })
    }
    if (pathname === '/v1/admin/environments' && (!options.method || options.method === 'GET')) {
      return ok(adminEnvList)
    }
    if (pathname === '/v1/admin/environments' && options.method === 'POST') {
      const body = JSON.parse(options.body || '{}')
      if (adminEnvList.some((item) => item.environment_id === body.environment_id)) {
        return ok({ code: 'ENVIRONMENT_EXISTS', message: 'Environment already exists' })
      }
      const created = {
        environment_id: body.environment_id,
        display_name: body.display_name,
        type: body.type,
        is_enabled: body.is_enabled === true
      }
      adminEnvList = [...adminEnvList, created]
      return ok(created)
    }
    if (pathname.startsWith('/v1/admin/environments/') && options.method === 'PATCH') {
      const environmentId = pathname.split('/').pop()
      const body = JSON.parse(options.body || '{}')
      adminEnvList = adminEnvList.map((item) =>
        item.environment_id === environmentId
          ? {
              ...item,
              display_name: body.display_name ?? item.display_name,
              type: body.type ?? item.type,
              is_enabled: body.is_enabled ?? item.is_enabled
            }
          : item
      )
      return ok(adminEnvList.find((item) => item.environment_id === environmentId) || {})
    }
    if (pathname.startsWith('/v1/admin/delivery-groups/') && pathname.endsWith('/environments') && (!options.method || options.method === 'GET')) {
      const parts = pathname.split('/')
      const groupId = parts[4]
      return ok(dgBindingsByGroup.get(groupId) || [])
    }
    if (pathname.startsWith('/v1/admin/delivery-groups/') && pathname.includes('/environments/') && (options.method === 'PUT' || options.method === 'PATCH')) {
      const parts = pathname.split('/')
      const groupId = parts[4]
      const environmentId = parts[6]
      const body = JSON.parse(options.body || '{}')
      const current = (dgBindingsByGroup.get(groupId) || []).filter((row) => row.environment_id !== environmentId)
      const existing = (dgBindingsByGroup.get(groupId) || []).find((row) => row.environment_id === environmentId)
      const row = {
        delivery_group_id: groupId,
        environment_id: environmentId,
        is_enabled: body.is_enabled ?? existing?.is_enabled ?? true,
        order_index: body.order_index ?? existing?.order_index ?? current.length,
        display_name: adminEnvList.find((item) => item.environment_id === environmentId)?.display_name || environmentId,
        type: adminEnvList.find((item) => item.environment_id === environmentId)?.type || 'non_prod'
      }
      const next = [...current, row].sort((a, b) => (a.order_index || 0) - (b.order_index || 0))
      dgBindingsByGroup.set(groupId, next)
      return ok(row)
    }
    if (pathname.startsWith('/v1/admin/services/') && pathname.endsWith('/environments') && (!options.method || options.method === 'GET')) {
      const parts = pathname.split('/')
      const serviceId = parts[4]
      const routes = routesByService.get(serviceId) || {}
      const rows = adminEnvList.map((env) => ({
        service_id: serviceId,
        environment_id: env.environment_id,
        display_name: env.display_name,
        type: env.type,
        recipe_id: routes[env.environment_id] || null
      }))
      return ok(rows)
    }
    if (pathname.startsWith('/v1/admin/services/') && pathname.includes('/environments/') && (options.method === 'PUT' || options.method === 'PATCH')) {
      const parts = pathname.split('/')
      const serviceId = parts[4]
      const environmentId = parts[6]
      const body = JSON.parse(options.body || '{}')
      const routes = { ...(routesByService.get(serviceId) || {}) }
      routes[environmentId] = body.recipe_id
      routesByService.set(serviceId, routes)
      return ok({ service_id: serviceId, environment_id: environmentId, recipe_id: body.recipe_id })
    }
    if (pathname === '/v1/environments') {
      return ok(resolveEnvironments())
    }
    if (pathname === '/v1/admin/guardrails/validate') {
      return ok(
        guardrailValidation || {
          validation_status: 'OK',
          messages: []
        }
      )
    }
    if (pathname === '/v1/admin/system/rate-limits' && (!options.method || options.method === 'GET')) {
      return ok({ read_rpm: 60, mutate_rpm: 10, daily_quota_build_register: 50, source: 'ssm' })
    }
    if (pathname === '/v1/admin/system/rate-limits' && options.method === 'PUT') {
      const body = JSON.parse(options.body || '{}')
      return ok({
        read_rpm: body.read_rpm ?? 60,
        mutate_rpm: body.mutate_rpm ?? 10,
        daily_quota_build_register: body.daily_quota_build_register ?? 50,
        source: 'ssm'
      })
    }
    if (pathname === '/v1/insights/failures') {
      const service = parsed.searchParams.get('service') || ''
      const groupId = parsed.searchParams.get('groupId') || ''
      const windowDays = parsed.searchParams.get('windowDays') || '7'
      if (service === 'payments-service' || groupId === 'payments' || windowDays === '30') {
        return ok({
          rollbackRate: 0.25,
          totalDeployments: 4,
          totalRollbacks: 1,
          failuresByCategory: [{ key: 'INFRASTRUCTURE', count: 2 }],
          deploymentsByRecipe: [{ key: 'canary', count: 4 }],
          deploymentsByGroup: [{ key: 'payments', count: 4 }]
        })
      }
      return ok({
        rollbackRate: 0.1,
        totalDeployments: 10,
        totalRollbacks: 1,
        failuresByCategory: [{ key: 'CONFIG', count: 1 }],
        deploymentsByRecipe: [{ key: 'default', count: 10 }],
        deploymentsByGroup: [{ key: 'default', count: 10 }]
      })
    }
    if (pathname === '/v1/recipes' && options.method === 'POST') {
      const body = JSON.parse(options.body || '{}')
      if (recipeList.some((recipe) => recipe.id === body.id)) {
        return ok({ code: 'RECIPE_EXISTS', message: 'Recipe already exists' })
      }
      recipeList = [...recipeList, body]
      return ok(body)
    }
    if (pathname.startsWith('/v1/recipes/') && options.method === 'PUT') {
      const body = JSON.parse(options.body || '{}')
      const recipeId = pathname.split('/').pop()
      recipeList = recipeList.map((recipe) => (recipe.id === recipeId ? body : recipe))
      return ok(body)
    }
    if (pathname.startsWith('/v1/admin/recipes/') && options.method === 'DELETE') {
      const recipeId = pathname.split('/').pop()
      const configured = deleteRecipeResponses?.[recipeId]
      if (configured) {
        return withStatus(configured.status, configured.body)
      }
      const exists = recipeList.some((recipe) => recipe.id === recipeId)
      if (!exists) {
        return withStatus(404, { code: 'NOT_FOUND', message: 'Recipe not found' })
      }
      recipeList = recipeList.filter((recipe) => recipe.id !== recipeId)
      return withStatus(204, null)
    }
    if (pathname === '/v1/services') {
      return ok(serviceList)
    }
    if (pathname.startsWith('/v1/services/') && pathname.endsWith('/delivery-status')) {
      const environment = parsed.searchParams.get('environment') || 'sandbox'
      const promotionCandidate =
        environment === 'sandbox'
          ? {
              eligible: true,
              source_environment: 'sandbox',
              target_environment: 'staging',
              version: '2.1.0',
              recipeId: 'default'
            }
          : { eligible: false, reason: 'PROMOTION_AT_HIGHEST_ENVIRONMENT' }
      return ok({
        service: 'demo-service',
        environment,
        hasDeployments: true,
        promotionCandidate,
        latest: {
          id: 'dep-1',
          state: 'SUCCEEDED',
          version: '2.1.0',
          createdAt: '2025-01-01T00:00:00Z',
          updatedAt: '2025-01-02T00:00:00Z'
        }
      })
    }
    if (pathname === '/v1/recipes') {
      return ok(recipeList)
    }
    if (pathname === '/v1/delivery-groups') {
      return ok(groups)
    }
    if (pathname === '/v1/deployments' && parsed.searchParams.get('service')) {
      const environment = parsed.searchParams.get('environment') || 'sandbox'
      return ok([
        {
          id: 'dep-1',
          state: 'SUCCEEDED',
          environment,
          version: '2.1.0',
          createdAt: '2025-01-01T00:00:00Z',
          deliveryGroupId: 'default'
        }
      ])
    }
    if (pathname === '/v1/deployments') {
      const environment = parsed.searchParams.get('environment') || 'sandbox'
      return ok([
        {
          id: 'dep-1',
          state: 'SUCCEEDED',
          environment,
          version: '2.1.0',
          createdAt: '2025-01-01T00:00:00Z',
          deliveryGroupId: 'default'
        }
      ])
    }
    if (pathname === '/v1/deployments/dep-1') {
      return ok({
        id: 'dep-1',
        state: 'IN_PROGRESS',
        service: 'demo-service',
        environment: 'sandbox',
        version: '2.1.0',
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
        engineExecutionUrl: 'https://spinnaker.example/executions/dep-1'
      })
    }
    if (pathname === '/v1/deployments/dep-1/failures') {
      return ok(failures || [])
    }
    if (pathname === '/v1/deployments/dep-1/timeline') {
      return ok(timeline || [])
    }
    if (pathname.endsWith('/versions')) {
      const parts = pathname.split('/')
      const serviceName = parts.length >= 4 ? parts[3] : ''
      const rawVersions = versionsByService?.[serviceName] || []
      const versions = rawVersions.map((item) => (typeof item === 'string' ? { version: item } : item))
      return ok({ versions })
    }
    if (pathname === '/v1/builds') {
      const serviceName = parsed.searchParams.get('service') || 'demo-service'
      const version = parsed.searchParams.get('version') || '2.1.0'
      const allowExternalLinks = uiExposurePolicy?.externalLinks?.display === true
      return ok({
        service: serviceName,
        version,
        artifactRef: `s3://dxcp-artifacts/${serviceName}/${version}.zip`,
        git_sha: '0123456789abcdef0123456789abcdef01234567',
        ci_publisher: 'ci-bot-1',
        ci_provider: 'github',
        ci_run_id: 'run-123',
        commit_url: allowExternalLinks ? (buildCommitUrl || 'https://scm.example.internal/commit/abc123') : null,
        run_url: allowExternalLinks ? (buildRunUrl || 'https://ci.example.internal/runs/123') : null,
        registeredAt: '2025-01-01T00:00:00Z'
      })
    }
    if (pathname.endsWith('/allowed-actions')) {
      return ok({
        service: 'demo-service',
        role,
        actions: { view: true, deploy: deployAllowed, rollback: rollbackAllowed }
      })
    }
    return ok({})
  }
}

function buildFakeJwt(roles) {
  const header = { alg: 'RS256', typ: 'JWT' }
  const payload = {
    iss: 'https://dxcp.example/',
    aud: 'https://dxcp-api',
    sub: 'user-1',
    'https://dxcp.example/claims/roles': roles
  }
  const encode = (obj) =>
    Buffer.from(JSON.stringify(obj)).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  return `${encode(header)}.${encode(payload)}.sig`
}

async function waitForCondition(check, attempts = 200) {
  const timeout = attempts * 10
  await waitFor(() => {
    if (!check()) {
      throw new Error('Condition not met in time')
    }
  }, { timeout, interval: 10 })
}

function dumpDom(view, label) {
  const snapshot = view?.container?.innerHTML || ''
  const target = resolvePath(process.cwd(), 'test-dom-dump.html')
  const entry = `\n<!-- ${label} -->\n${snapshot}\n<!-- /${label} -->\n`
  try {
    appendFileSync(target, entry, 'utf8')
  } catch (err) {
    // Ignore file write errors; the error message will include the snapshot.
  }
  return snapshot
}

async function waitForConditionWithDump(check, view, label, attempts = 200) {
  try {
    await waitForCondition(check, attempts)
  } catch (err) {
    const snapshot = dumpDom(view, label)
    const max = 6000
    const trimmed = snapshot.length > max ? `${snapshot.slice(0, max)}\n...<truncated>` : snapshot
    throw new Error(`${label}\n${trimmed}`)
  }
}

async function ensureEnvironmentSelected(view, name = 'sandbox') {
  await waitForConditionWithDump(() => {
    const current = view.queryByTestId('environment-selector')
    if (!current) return false
    const values = Array.from(current.options || []).map((opt) => opt.value)
    return values.includes(name)
  }, view, `Env options include ${name}`)
  const selector = await view.findByTestId('environment-selector')
  if (selector.value !== name) {
    fireEvent.change(selector, { target: { value: name } })
  }
  await waitForConditionWithDump(() => {
    const current = view.queryByTestId('environment-selector')
    return current && current.value === name
  }, view, `Env selected ${name}`)
}

async function ensureServiceSelected(view, name = 'demo-service') {
  const selector = await view.findByTestId('deploy-service-select')
  if (selector.value !== name) {
    fireEvent.change(selector, { target: { value: name } })
    await waitForCondition(() => {
      const current = view.queryByTestId('deploy-service-select')
      return current && current.value === name
    })
  }
}

async function refreshDeployData(view) {
  const refreshButton = view.getByRole('button', { name: 'Refresh data' })
  fireEvent.click(refreshButton)
  await waitForCondition(() => view.queryByRole('button', { name: 'Refreshing...' }) === null)
}

async function waitForReviewEnabled(view, attempts = 200) {
  await waitForCondition(() => {
    const current = view.queryByTestId('deploy-review-button')
    return current && !current.disabled
  }, attempts)
}

async function ensureReviewReady(view) {
  for (let i = 0; i < 3; i += 1) {
    if (i > 0) {
      await refreshDeployData(view)
    }
    try {
      await waitForReviewEnabled(view, 200)
      return
    } catch {
      // retry
    }
  }
  const gate = view.queryByText(/Deploy gates:/)?.textContent || 'Deploy gates: <missing>'
  const reviewButton = view.queryByTestId('deploy-review-button')
  const title = reviewButton?.getAttribute('title') || '<none>'
  const disabled = reviewButton ? String(reviewButton.disabled) : '<missing>'
  throw new Error(`Review button never enabled after refresh. ${gate} title=${title} disabled=${disabled}`)
}

async function waitForPreflightError(view, attempts = 400) {
  await waitForConditionWithDump(
    () => view.queryByText(/Fix these issues to continue/) !== null,
    view,
    'Preflight error visible',
    attempts
  )
}

async function waitForConfirmDeploy(view, attempts = 400) {
  await waitForConditionWithDump(
    () => view.queryByRole('button', { name: 'Confirm deploy' }) !== null,
    view,
    'Confirm deploy visible',
    attempts
  )
}

async function clickReviewUntil(view, { label, expectConfirm, getValidateCalls }) {
  const reviewButton = view.getByTestId('deploy-review-button')
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const before = getValidateCalls()
    fireEvent.click(reviewButton)
    await waitForConditionWithDump(
      () => getValidateCalls() > before,
      view,
      `${label} validateCalls`
    )
    if (expectConfirm) {
      if (view.queryByRole('button', { name: 'Confirm deploy' })) return
    } else {
      if (view.queryByText(/Fix these issues to continue/)) return
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`${label} did not reach expected state`)
}

async function withDom(fn) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' })
  const storage = (() => {
    const store = new Map()
    return {
      getItem(key) {
        return store.has(key) ? store.get(key) : null
      },
      setItem(key, value) {
        store.set(String(key), String(value))
      },
      removeItem(key) {
        store.delete(key)
      },
      clear() {
        store.clear()
      },
      key(index) {
        return Array.from(store.keys())[index] || null
      },
      get length() {
        return store.size
      }
    }
  })()
  Object.defineProperty(globalThis, 'window', { value: dom.window, configurable: true })
  Object.defineProperty(globalThis, 'document', { value: dom.window.document, configurable: true })
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
  Object.defineProperty(globalThis, 'HTMLElement', { value: dom.window.HTMLElement, configurable: true })
  Object.defineProperty(globalThis, 'getComputedStyle', { value: dom.window.getComputedStyle, configurable: true })
  Object.defineProperty(dom.window, 'localStorage', { value: storage, configurable: true })
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true })
  Object.defineProperty(globalThis, 'requestAnimationFrame', {
    value: (cb) => setTimeout(cb, 0),
    configurable: true
  })
  try {
    window.__DXCP_AUTH0_CONFIG__ = {
      domain: 'example.us.auth0.com',
      clientId: 'client-id',
      audience: 'https://dxcp-api',
      rolesClaim: 'https://dxcp.example/claims/roles',
      debugDeployGates: true
    }
    window.__DXCP_AUTH0_RESET__ = true
    await fn()
  } finally {
    if (globalThis.window?.localStorage) {
      globalThis.window.localStorage.clear()
    }
    cleanup()
    dom.window.close()
    Object.defineProperty(globalThis, 'window', { value: { event: undefined }, configurable: true })
    delete globalThis.window.__DXCP_AUTH0_FACTORY__
    delete globalThis.window.__DXCP_AUTH0_CONFIG__
    delete globalThis.document
    delete globalThis.navigator
    delete globalThis.HTMLElement
    delete globalThis.getComputedStyle
    delete globalThis.localStorage
    delete globalThis.requestAnimationFrame
    delete globalThis.fetch
  }
}

async function runTest(name, fn) {
  try {
    await withDom(fn)
    console.log(`ok - ${name}`)
  } catch (err) {
    console.error(`not ok - ${name}`)
    console.error(err)
    process.exitCode = 1
  }
}

export async function runAllTests() {
  await runTest('OBSERVER sees Admin nav but read-only', async () => {
    window.__DXCP_AUTH0_FACTORY__ = async () => ({
      isAuthenticated: async () => true,
      getUser: async () => ({ email: 'observer@example.com' }),
      getTokenSilently: async () => buildFakeJwt(['dxcp-observers']),
      loginWithRedirect: async () => {},
      logout: async () => {},
      handleRedirectCallback: async () => {}
    })
    globalThis.fetch = buildFetchMock({ role: 'OBSERVER', deployAllowed: false, rollbackAllowed: false })
    const view = renderApp()

    await view.findByText('OBSERVER')
    const adminButton = view.getByRole('link', { name: 'Admin' })
    fireEvent.click(adminButton)
    await view.findByText('Only Platform Admins can modify this.')
    const createButton = view.getByRole('button', { name: 'Create group' })
    assert.equal(createButton.disabled, true)
  })

  await runTest('OBSERVER cannot deploy', async () => {
    window.__DXCP_AUTH0_FACTORY__ = async () => ({
      isAuthenticated: async () => true,
      getUser: async () => ({ email: 'observer@example.com' }),
      getTokenSilently: async () => buildFakeJwt(['dxcp-observers']),
      loginWithRedirect: async () => {},
      logout: async () => {},
      handleRedirectCallback: async () => {}
    })
    globalThis.fetch = buildFetchMock({ role: 'OBSERVER', deployAllowed: false, rollbackAllowed: false })
    const view = renderApp()

    await view.findByText('OBSERVER')
    fireEvent.click(view.getByRole('link', { name: 'Deploy' }))
    const reviewButton = view.getByTestId('deploy-review-button')
    assert.equal(reviewButton.disabled, true)
  })

  await runTest('New experience application route reads as an object page with blocked deploy and local explanation', async () => {
    window.__DXCP_AUTH0_FACTORY__ = async () => ({
      isAuthenticated: async () => true,
      getUser: async () => ({ email: 'owner@example.com' }),
      getTokenSilently: async () => buildFakeJwt(['dxcp-delivery-owners']),
      loginWithRedirect: async () => {},
      logout: async () => {},
      handleRedirectCallback: async () => {}
    })
    globalThis.fetch = buildFetchMock({
      role: 'DELIVERY_OWNER',
      deployAllowed: true,
      rollbackAllowed: false
    })
    const view = renderApp('/new/applications/payments-api')

    await view.findByText('Application')
    await view.findByText('payments-api')
    await view.findByText('Current running summary')
    await view.findByText('Recent state summary')
    await view.findByText('Application owner')
    await view.findByText('Payments Platform')
    await view.findAllByText('Current version')
    await view.findAllByText('v1.32.1')
    await view.findByText('Deploy blocked')
    await view.findByText(
      'Another deployment is already active for sandbox. Open that deployment or use the current deploy workflow when the active work completes.'
    )
    assert.ok(view.getByRole('link', { name: 'Open deploy workflow' }))
    assert.ok(view.getByRole('link', { name: 'Open current deployment detail' }))
    assert.ok(view.getByRole('link', { name: 'Open active deployment' }))
    await view.findByText('Supporting reads are degraded')
    await view.findByText(
      'Recent state is current enough to orient the next action, but supporting evidence may lag. Open the deployment detail route for the authoritative record.'
    )
    await view.findByText('Mutation disabled')
    await view.findByText('Permission-limited detail')
    await view.findByText('Supporting context')
  })

  await runTest('New experience shows read-only application posture for observers', async () => {
    window.__DXCP_AUTH0_FACTORY__ = async () => ({
      isAuthenticated: async () => true,
      getUser: async () => ({ email: 'observer@example.com' }),
      getTokenSilently: async () => buildFakeJwt(['dxcp-observers']),
      loginWithRedirect: async () => {},
      logout: async () => {},
      handleRedirectCallback: async () => {}
    })
    globalThis.fetch = buildFetchMock({
      role: 'OBSERVER',
      deployAllowed: false,
      rollbackAllowed: false
    })
    const view = renderApp('/new/applications/payments-api')

    await view.findByText('Read-only access')
    await view.findByText(
      'You can inspect current state and deployment history here, but only delivery owners can deploy from this workflow.'
    )
    await view.findByText('Read-only')
    await view.findByText('Open deploy workflow')
    await view.findByText('Recent state summary')
    assert.equal(view.queryByRole('link', { name: 'Admin' }), null)
  })

  await runTest('New experience deploy route shows enabled deploy intent with readiness review', async () => {
    window.__DXCP_AUTH0_FACTORY__ = async () => ({
      isAuthenticated: async () => true,
      getUser: async () => ({ email: 'owner@example.com' }),
      getTokenSilently: async () => buildFakeJwt(['dxcp-delivery-owners']),
      loginWithRedirect: async () => {},
      logout: async () => {},
      handleRedirectCallback: async () => {}
    })
    globalThis.fetch = buildFetchMock({
      role: 'DELIVERY_OWNER',
      deployAllowed: true,
      rollbackAllowed: false
    })
    const view = renderApp('/new/applications/payments-api/deploy')

    await view.findByText('Deploy Application')
    await view.findByText('Intent entry')
    await view.findByText('Readiness review')
    await view.findByText('Ready to deploy')
    await view.findByText('No active deployment is already running for sandbox.')
    await view.findAllByText('Ready')
    assert.ok(view.getByRole('link', { name: 'Open Application' }))
    assert.ok(view.getByRole('link', { name: 'Open Legacy Deploy' }))
    await view.findByText('Policy and guardrails')
  })

  await runTest('New experience deploy route shows blocked deploy explanation locally', async () => {
    window.__DXCP_AUTH0_FACTORY__ = async () => ({
      isAuthenticated: async () => true,
      getUser: async () => ({ email: 'owner@example.com' }),
      getTokenSilently: async () => buildFakeJwt(['dxcp-delivery-owners']),
      loginWithRedirect: async () => {},
      logout: async () => {},
      handleRedirectCallback: async () => {}
    })
    globalThis.fetch = buildFetchMock({
      role: 'DELIVERY_OWNER',
      deployAllowed: true,
      rollbackAllowed: false
    })
    const view = renderApp('/new/applications/payments-api/deploy/blocked')

    await view.findByText('Deploy blocked')
    await view.findByText('Deploy blocked by policy')
    await view.findByText(
      'Sandbox already has an active deployment for Payments Core. Wait for that deployment to complete, or open it to inspect progress before starting another deploy.'
    )
    await view.findByText('No active deployment is already running for sandbox.')
    await view.findAllByText('Blocked')
    assert.ok(view.getByRole('link', { name: 'Open Active Deployment' }))
  })

  await runTest('New experience deploy route shows permission-limited deploy behavior', async () => {
    window.__DXCP_AUTH0_FACTORY__ = async () => ({
      isAuthenticated: async () => true,
      getUser: async () => ({ email: 'owner@example.com' }),
      getTokenSilently: async () => buildFakeJwt(['dxcp-delivery-owners']),
      loginWithRedirect: async () => {},
      logout: async () => {},
      handleRedirectCallback: async () => {}
    })
    globalThis.fetch = buildFetchMock({
      role: 'DELIVERY_OWNER',
      deployAllowed: true,
      rollbackAllowed: false
    })
    const permissionView = renderApp('/new/applications/payments-api/deploy/permission-limited')

    await permissionView.findByText('Permission-limited deploy')
    await permissionView.findByText(
      'This intent is visible so you can review the deploy plan, but production deploys from this workflow are limited to platform admins. Return to the application or hand off to an authorized operator.'
    )
    await permissionView.findByText('Your role is allowed to deploy to production.')
    await permissionView.findAllByText('Blocked')
  })

  await runTest('New experience deploy route shows read-only deploy behavior for observers', async () => {
    window.__DXCP_AUTH0_FACTORY__ = async () => ({
      isAuthenticated: async () => true,
      getUser: async () => ({ email: 'observer@example.com' }),
      getTokenSilently: async () => buildFakeJwt(['dxcp-observers']),
      loginWithRedirect: async () => {},
      logout: async () => {},
      handleRedirectCallback: async () => {}
    })
    globalThis.fetch = buildFetchMock({
      role: 'OBSERVER',
      deployAllowed: false,
      rollbackAllowed: false
    })
    const readOnlyView = renderApp('/new/applications/payments-api/deploy')

    await readOnlyView.findByText('Read-only access')
    await readOnlyView.findByText('Read-only workflow')
    await readOnlyView.findByText(
      'This workflow remains visible so you can understand deploy requirements, current policy, and the next handoff without being invited into a blocked mutation path.'
    )
    await readOnlyView.findAllByText('Read-only')
  })

  await runTest('New experience deployment route shows deployment object page with current outcome before timeline', async () => {
    window.__DXCP_AUTH0_FACTORY__ = async () => ({
      isAuthenticated: async () => true,
      getUser: async () => ({ email: 'owner@example.com' }),
      getTokenSilently: async () => buildFakeJwt(['dxcp-delivery-owners']),
      loginWithRedirect: async () => {},
      logout: async () => {},
      handleRedirectCallback: async () => {}
    })
    globalThis.fetch = buildFetchMock({
      role: 'DELIVERY_OWNER',
      deployAllowed: true,
      rollbackAllowed: false
    })
    const view = renderApp('/new/deployments/9831')

    await view.findByRole('heading', { name: 'Deployment' })
    await view.findAllByText('Deployment 9831')
    await view.findByText('Deployment summary')
    await view.findByText('Deployment timeline')
    await view.findByText('Current running context')
    assert.ok(view.getAllByText('Succeeded').length >= 1)
    assert.ok(view.getByRole('link', { name: 'Open Application' }))
    assert.ok(view.getByRole('link', { name: 'Open Deployments' }))
  })

  await runTest('New experience deployment detail preserves deployments browse continuity when opened from the collection', async () => {
    window.__DXCP_AUTH0_FACTORY__ = async () => ({
      isAuthenticated: async () => true,
      getUser: async () => ({ email: 'owner@example.com' }),
      getTokenSilently: async () => buildFakeJwt(['dxcp-delivery-owners']),
      loginWithRedirect: async () => {},
      logout: async () => {},
      handleRedirectCallback: async () => {}
    })
    globalThis.fetch = buildFetchMock({
      role: 'DELIVERY_OWNER',
      deployAllowed: true,
      rollbackAllowed: false
    })
    const view = renderApp('/new/deployments')

    await view.findByText('payments-api · v1.33.0')
    fireEvent.click(view.getAllByRole('link', { name: 'Open' })[0])
    await view.findByText('Opened from Deployments')
    assert.ok(view.getAllByRole('link', { name: 'Back to Deployments' }).length >= 1)
  })

  await runTest('New experience deployments route shows restrained collection with obvious detail handoff', async () => {
    window.__DXCP_AUTH0_FACTORY__ = async () => ({
      isAuthenticated: async () => true,
      getUser: async () => ({ email: 'owner@example.com' }),
      getTokenSilently: async () => buildFakeJwt(['dxcp-delivery-owners']),
      loginWithRedirect: async () => {},
      logout: async () => {},
      handleRedirectCallback: async () => {}
    })
    globalThis.fetch = buildFetchMock({
      role: 'DELIVERY_OWNER',
      deployAllowed: true,
      rollbackAllowed: false
    })
    const view = renderApp('/new/deployments')

    await view.findByRole('heading', { name: 'Deployments' })
    await view.findByText('Recent deployment activity across applications')
    await view.findByText('Recent deployment activity')
    await view.findByText(
      '3 deployments in the last 7 days for sandbox. Recent activity stays bounded so this page supports detail handoff without becoming archive-first.'
    )
    await view.findByText('payments-api · v1.33.0')
    await view.findByText('payments-api · v1.31.9')
    await view.findAllByText('Failed')
    const openLinks = view.getAllByRole('link', { name: 'Open' })
    assert.ok(openLinks.length >= 3)
    assert.equal(openLinks[0].getAttribute('href'), '/new/deployments/9842')
    assert.ok(view.getByRole('button', { name: 'Load older deployments' }))
  })

  await runTest('New experience deployments route preserves structure for empty state', async () => {
    window.__DXCP_AUTH0_FACTORY__ = async () => ({
      isAuthenticated: async () => true,
      getUser: async () => ({ email: 'owner@example.com' }),
      getTokenSilently: async () => buildFakeJwt(['dxcp-delivery-owners']),
      loginWithRedirect: async () => {},
      logout: async () => {},
      handleRedirectCallback: async () => {}
    })
    globalThis.fetch = buildFetchMock({
      role: 'DELIVERY_OWNER',
      deployAllowed: true,
      rollbackAllowed: false
    })
    const view = renderApp('/new/deployments/empty')

    await view.findByRole('heading', { name: 'Deployments' })
    await view.findByText('Recent deployment activity')
    await view.findByText('No deployments recorded yet')
    await view.findByText(
      'The recent deployment window is valid, but there is no deployment activity to browse yet. Open an application to begin from object context instead of turning this page into a placeholder archive.'
    )
    assert.ok(view.getByRole('link', { name: 'Open Deploy Workflow' }))
  })

  await runTest('New experience deployments route distinguishes no-results state from empty history', async () => {
    window.__DXCP_AUTH0_FACTORY__ = async () => ({
      isAuthenticated: async () => true,
      getUser: async () => ({ email: 'owner@example.com' }),
      getTokenSilently: async () => buildFakeJwt(['dxcp-delivery-owners']),
      loginWithRedirect: async () => {},
      logout: async () => {},
      handleRedirectCallback: async () => {}
    })
    globalThis.fetch = buildFetchMock({
      role: 'DELIVERY_OWNER',
      deployAllowed: true,
      rollbackAllowed: false
    })
    const view = renderApp('/new/deployments/no-results')

    await view.findByText('No deployments match this scope')
    await view.findByText(
      'Try a broader outcome or time window to continue browsing. This is different from empty history because deployment records exist outside the current filters.'
    )
    assert.ok(view.getByRole('link', { name: 'Clear filters' }))
  })

  await runTest('New experience deployments route shows degraded-read notice without collapsing the collection', async () => {
    window.__DXCP_AUTH0_FACTORY__ = async () => ({
      isAuthenticated: async () => true,
      getUser: async () => ({ email: 'owner@example.com' }),
      getTokenSilently: async () => buildFakeJwt(['dxcp-delivery-owners']),
      loginWithRedirect: async () => {},
      logout: async () => {},
      handleRedirectCallback: async () => {}
    })
    globalThis.fetch = buildFetchMock({
      role: 'DELIVERY_OWNER',
      deployAllowed: true,
      rollbackAllowed: false
    })
    const view = renderApp('/new/deployments/degraded-read')

    await view.findByText('Supporting reads are degraded')
    await view.findByText(
      'Visible rows remain useful for scan and handoff, but freshness and supporting evidence may lag. Open deployment detail for the authoritative record before acting on a stale assumption.'
    )
    await view.findByText('payments-api · v1.33.0')
    await view.findByText('payments-api · v1.31.9')
  })

  await runTest('New experience insights route shows restrained aggregate reading and drill-down paths', async () => {
    window.__DXCP_AUTH0_FACTORY__ = async () => ({
      isAuthenticated: async () => true,
      getUser: async () => ({ email: 'owner@example.com' }),
      getTokenSilently: async () => buildFakeJwt(['dxcp-delivery-owners']),
      loginWithRedirect: async () => {},
      logout: async () => {},
      handleRedirectCallback: async () => {}
    })
    globalThis.fetch = buildFetchMock({
      role: 'DELIVERY_OWNER',
      deployAllowed: true,
      rollbackAllowed: false
    })
    const view = renderApp('/new/insights')

    await view.findByRole('heading', { name: 'Insights' })
    await view.findByText('Recent delivery health and attention across DXCP')
    await view.findByText('Summary strip')
    await view.findByText('Trend')
    await view.findByText('Breakdown')
    await view.findByText('Attention')
    await view.findByText('Recent notable activity')
    await view.findByText('Payments Core rollback activity increased')
    assert.ok(view.getAllByRole('link', { name: 'Inspect deployment' }).length >= 1)
  })

  await runTest('New experience insights route preserves empty state without inventing dashboard bulk', async () => {
    window.__DXCP_AUTH0_FACTORY__ = async () => ({
      isAuthenticated: async () => true,
      getUser: async () => ({ email: 'owner@example.com' }),
      getTokenSilently: async () => buildFakeJwt(['dxcp-delivery-owners']),
      loginWithRedirect: async () => {},
      logout: async () => {},
      handleRedirectCallback: async () => {}
    })
    globalThis.fetch = buildFetchMock({
      role: 'DELIVERY_OWNER',
      deployAllowed: true,
      rollbackAllowed: false
    })
    const view = renderApp('/new/insights/empty')

    await view.findByText('No deployments in this time range')
    await view.findByText(
      'Insights keeps the same page structure when the selected scope has no delivery activity. Try a broader time window or clear scope filters before switching into a different object route.'
    )
    assert.ok(view.getByRole('link', { name: 'Open Applications' }))
  })

  await runTest('New experience insights route keeps degraded and failed reads calm and predictable', async () => {
    window.__DXCP_AUTH0_FACTORY__ = async () => ({
      isAuthenticated: async () => true,
      getUser: async () => ({ email: 'owner@example.com' }),
      getTokenSilently: async () => buildFakeJwt(['dxcp-delivery-owners']),
      loginWithRedirect: async () => {},
      logout: async () => {},
      handleRedirectCallback: async () => {}
    })
    globalThis.fetch = buildFetchMock({
      role: 'DELIVERY_OWNER',
      deployAllowed: true,
      rollbackAllowed: false
    })
    const degradedView = renderApp('/new/insights/degraded-read')

    await degradedView.findByText('Supporting reads are degraded')
    await degradedView.findByText('Deployment Group breakdown is temporarily unavailable')
    await degradedView.findByText(
      'Trend and other breakdowns remain available, but this grouping did not refresh. Open Deployments for the authoritative scoped list while the supporting read catches up.'
    )

    cleanup()

    window.__DXCP_AUTH0_FACTORY__ = async () => ({
      isAuthenticated: async () => true,
      getUser: async () => ({ email: 'owner@example.com' }),
      getTokenSilently: async () => buildFakeJwt(['dxcp-delivery-owners']),
      loginWithRedirect: async () => {},
      logout: async () => {},
      handleRedirectCallback: async () => {}
    })
    globalThis.fetch = buildFetchMock({
      role: 'DELIVERY_OWNER',
      deployAllowed: true,
      rollbackAllowed: false
    })
    const failureView = renderApp('/new/insights/failure')

    await failureView.findByText('Insights could not be loaded')
    await failureView.findByText('Aggregate delivery reading is unavailable right now')
    await failureView.findByText(
      'The new Insights route keeps the same header, scope controls, and refresh action so you can retry without losing page context.'
    )
  })

  await runTest('New experience insights route exposes refresh behavior in the header without changing hierarchy', async () => {
    window.__DXCP_AUTH0_FACTORY__ = async () => ({
      isAuthenticated: async () => true,
      getUser: async () => ({ email: 'owner@example.com' }),
      getTokenSilently: async () => buildFakeJwt(['dxcp-delivery-owners']),
      loginWithRedirect: async () => {},
      logout: async () => {},
      handleRedirectCallback: async () => {}
    })
    globalThis.fetch = buildFetchMock({
      role: 'DELIVERY_OWNER',
      deployAllowed: true,
      rollbackAllowed: false
    })
    const view = renderApp('/new/insights')

    await view.findByRole('button', { name: 'Refresh' })
    fireEvent.click(view.getByRole('button', { name: 'Refresh' }))
    await view.findByRole('button', { name: 'Refreshing...' })
    await view.findByText('Refresh update')
    await view.findByText('Insights refreshed for the selected window without changing the page hierarchy.')
  })

  await runTest('New experience admin route proves review-before-save with a completed mutation slice', async () => {
    window.__DXCP_AUTH0_FACTORY__ = async () => ({
      isAuthenticated: async () => true,
      getUser: async () => ({ email: 'admin@example.com' }),
      getTokenSilently: async () => buildFakeJwt(['dxcp-platform-admins']),
      loginWithRedirect: async () => {},
      logout: async () => {},
      handleRedirectCallback: async () => {}
    })
    globalThis.fetch = buildFetchMock({
      role: 'PLATFORM_ADMIN',
      deployAllowed: true,
      rollbackAllowed: true
    })
    const view = renderApp('/new/admin')

    await view.findByRole('heading', { name: 'Admin' })
    await view.findByText('Deployment Group: Payments Core')
    await view.findByText('Governance object')
    fireEvent.click(view.getByRole('button', { name: 'Edit' }))
    await view.findByText('Edit draft')
    fireEvent.click(view.getByRole('checkbox', { name: 'Rolling' }))
    await waitFor(() => assert.equal(view.getByRole('button', { name: 'Review changes' }).disabled, false))
    fireEvent.click(view.getByRole('button', { name: 'Review changes' }))
    await view.findByRole('heading', { name: 'Review before save' })
    await view.findByText('Current: Blue-Green, Rolling')
    await view.findByText('Proposed: Blue-Green')
    await view.findByText('Impact preview')
    fireEvent.click(view.getByRole('button', { name: 'Save' }))
    await view.findByText('Save complete')
    await view.findByText('Deployment Group saved. Future deployments now use the reviewed quota and strategy access rules.')
  })

  await runTest('New experience admin route separates warnings from errors during review', async () => {
    window.__DXCP_AUTH0_FACTORY__ = async () => ({
      isAuthenticated: async () => true,
      getUser: async () => ({ email: 'admin@example.com' }),
      getTokenSilently: async () => buildFakeJwt(['dxcp-platform-admins']),
      loginWithRedirect: async () => {},
      logout: async () => {},
      handleRedirectCallback: async () => {}
    })
    globalThis.fetch = buildFetchMock({
      role: 'PLATFORM_ADMIN',
      deployAllowed: true,
      rollbackAllowed: true
    })
    const view = renderApp('/new/admin/warnings')

    await view.findAllByText('Warnings to review')
    await view.findByText('5 Applications would no longer be allowed to use Rolling.')
    assert.equal(view.queryByText('Errors blocking save'), null)
    const saveButton = view.getByRole('button', { name: 'Save' })
    assert.equal(saveButton.disabled, true)
    fireEvent.click(view.getByRole('checkbox', { name: /reviewed the warning impact/i }))
    assert.equal(view.getByRole('button', { name: 'Save' }).disabled, false)
  })

  await runTest('New experience admin route shows review errors and blocked-save explanation before mutation', async () => {
    window.__DXCP_AUTH0_FACTORY__ = async () => ({
      isAuthenticated: async () => true,
      getUser: async () => ({ email: 'admin@example.com' }),
      getTokenSilently: async () => buildFakeJwt(['dxcp-platform-admins']),
      loginWithRedirect: async () => {},
      logout: async () => {},
      handleRedirectCallback: async () => {}
    })
    globalThis.fetch = buildFetchMock({
      role: 'PLATFORM_ADMIN',
      deployAllowed: true,
      rollbackAllowed: true
    })
    const errorView = renderApp('/new/admin/errors')

    await errorView.findByText('Errors blocking save')
    await errorView.findByText(
      'At least one deployment strategy must remain allowed before DXCP can save this Deployment Group.'
    )
    await errorView.findByText('Daily deploy quota must stay greater than or equal to the daily rollback quota.')
    assert.ok(errorView.getByRole('button', { name: 'Save' }).disabled)

    cleanup()

    window.__DXCP_AUTH0_FACTORY__ = async () => ({
      isAuthenticated: async () => true,
      getUser: async () => ({ email: 'admin@example.com' }),
      getTokenSilently: async () => buildFakeJwt(['dxcp-platform-admins']),
      loginWithRedirect: async () => {},
      logout: async () => {},
      handleRedirectCallback: async () => {}
    })
    globalThis.fetch = buildFetchMock({
      role: 'PLATFORM_ADMIN',
      deployAllowed: true,
      rollbackAllowed: true
    })
    const blockedView = renderApp('/new/admin/blocked-save')

    await blockedView.findByText('Blocked save explanation')
    await blockedView.findByText(
      'DXCP is currently in read-only mode. Review stays available, but this change cannot be saved until platform mutations are re-enabled.'
    )
    await blockedView.findByText('Impact preview')
    assert.ok(blockedView.getByRole('button', { name: 'Save' }).disabled)
  })

  await runTest('New experience admin route blocks non-admin access without rendering a partial Admin shell', async () => {
    window.__DXCP_AUTH0_FACTORY__ = async () => ({
      isAuthenticated: async () => true,
      getUser: async () => ({ email: 'owner@example.com' }),
      getTokenSilently: async () => buildFakeJwt(['dxcp-delivery-owners']),
      loginWithRedirect: async () => {},
      logout: async () => {},
      handleRedirectCallback: async () => {}
    })
    globalThis.fetch = buildFetchMock({
      role: 'DELIVERY_OWNER',
      deployAllowed: true,
      rollbackAllowed: false
    })
    const view = renderApp('/new/admin')

    await view.findByRole('heading', { name: 'Admin access required' })
    await view.findAllByText(
      'This area is limited to platform administration. Use Applications, Deployments, or Insights for standard delivery work.'
    )
    await view.findByText('Blocked access')
    assert.equal(view.queryByText('Read-only governance posture'), null)
    assert.equal(view.queryByRole('link', { name: 'Admin' }), null)
  })

  await runTest('PLATFORM_ADMIN sees all sections', async () => {
    window.__DXCP_AUTH0_FACTORY__ = async () => ({
      isAuthenticated: async () => true,
      getUser: async () => ({ email: 'admin@example.com' }),
      getTokenSilently: async () => buildFakeJwt(['dxcp-platform-admins']),
      loginWithRedirect: async () => {},
      logout: async () => {},
      handleRedirectCallback: async () => {}
    })
    globalThis.fetch = buildFetchMock({ role: 'PLATFORM_ADMIN', deployAllowed: true, rollbackAllowed: true })
    const view = renderApp()

    await view.findByText('PLATFORM_ADMIN')
    assert.ok(view.getByRole('link', { name: 'Deploy' }))
    assert.ok(view.getByRole('link', { name: 'Deployments' }))
    assert.ok(view.getByRole('link', { name: 'Insights' }))
    assert.ok(view.getByRole('link', { name: 'Settings' }))
    assert.ok(view.getByRole('link', { name: 'Admin' }))
  })

  await runTest('DELIVERY_OWNER role is recognized in UI context', async () => {
    window.__DXCP_AUTH0_FACTORY__ = async () => ({
      isAuthenticated: async () => true,
      getUser: async () => ({ email: 'owner@example.com' }),
      getTokenSilently: async () => buildFakeJwt(['dxcp-delivery-owners']),
      loginWithRedirect: async () => {},
      logout: async () => {},
      handleRedirectCallback: async () => {}
    })
    globalThis.fetch = buildFetchMock({ role: 'DELIVERY_OWNER', deployAllowed: true, rollbackAllowed: true })
    const view = renderApp()

    await view.findByText('DELIVERY_OWNER')
    assert.ok(view.getByRole('link', { name: 'Deploy' }))
    assert.ok(view.queryByText('UNKNOWN') === null)
  })

  await runTest('Admin system settings saves external links exposure toggle', async () => {
    window.__DXCP_AUTH0_FACTORY__ = async () => ({
      isAuthenticated: async () => true,
      getUser: async () => ({ email: 'admin@example.com' }),
      getTokenSilently: async () => buildFakeJwt(['dxcp-platform-admins']),
      loginWithRedirect: async () => {},
      logout: async () => {},
      handleRedirectCallback: async () => {}
    })
    globalThis.fetch = buildFetchMock({
      role: 'PLATFORM_ADMIN',
      deployAllowed: true,
      rollbackAllowed: true,
      uiExposureArtifactRefDisplay: false,
      uiExposureExternalLinksDisplay: false
    })
    const view = renderApp()

    await view.findByText('PLATFORM_ADMIN')
    fireEvent.click(view.getByRole('link', { name: 'Admin' }))
    fireEvent.click(view.getByRole('button', { name: 'System Settings' }))
    await view.findByText('Build Provenance Exposure')

    const artifactToggle = view.getByLabelText('Show artifact references')
    const externalToggle = view.getByLabelText('Show external links (commit and CI run)')
    assert.equal(artifactToggle.checked, false)
    assert.equal(externalToggle.checked, false)

    fireEvent.click(externalToggle)
    fireEvent.click(view.getByRole('button', { name: 'Save exposure policy' }))
    await view.findByText('Build provenance exposure policy saved.')
    assert.equal(view.getByLabelText('Show external links (commit and CI run)').checked, true)
  })

  await runTest('Deploy version selection remains changed after URL-seeded initial version', async () => {
    window.__DXCP_AUTH0_FACTORY__ = async () => ({
      isAuthenticated: async () => true,
      getUser: async () => ({ email: 'admin@example.com' }),
      getTokenSilently: async () => buildFakeJwt(['dxcp-platform-admins']),
      loginWithRedirect: async () => {},
      logout: async () => {},
      handleRedirectCallback: async () => {}
    })
    globalThis.fetch = buildFetchMock({
      role: 'PLATFORM_ADMIN',
      deployAllowed: true,
      rollbackAllowed: true,
      versionsByService: {
        'demo-service': ['0.1.14', '0.1.13']
      }
    })
    const view = renderApp('/deploy?service=demo-service&recipe=default&version=0.1.13')

    await view.findByText('PLATFORM_ADMIN')
    await waitForCondition(() => {
      const current = view.queryByTestId('deploy-version-select')
      return current && current.value === '0.1.13'
    })

    const versionSelect = view.getByTestId('deploy-version-select')
    fireEvent.change(versionSelect, { target: { value: '0.1.14' } })

    await waitForCondition(() => {
      const current = view.queryByTestId('deploy-version-select')
      return current && current.value === '0.1.14'
    })
    await new Promise((resolve) => setTimeout(resolve, 100))
    assert.equal(view.getByTestId('deploy-version-select').value, '0.1.14')
  })

  await runTest('Settings page shows default refresh interval', async () => {
    window.__DXCP_AUTH0_FACTORY__ = async () => ({
      isAuthenticated: async () => true,
      getUser: async () => ({ email: 'owner@example.com' }),
      getTokenSilently: async () => buildFakeJwt(['dxcp-observers']),
      loginWithRedirect: async () => {},
      logout: async () => {},
      handleRedirectCallback: async () => {}
    })
    globalThis.fetch = buildFetchMock({ role: 'OBSERVER', deployAllowed: false, rollbackAllowed: false })
    const view = renderApp()

    await view.findByText('OBSERVER')
    fireEvent.click(view.getByRole('link', { name: 'Settings' }))
    const input = view.getByLabelText('Auto-refresh interval (minutes)')
    assert.equal(input.value, '5')
    await view.findByText('Resolved refresh interval: 5 minutes.')
    assert.equal(view.queryByText('Admin defaults'), null)
  })

  await runTest('Changing refresh minutes updates localStorage', async () => {
    window.__DXCP_AUTH0_FACTORY__ = async () => ({
      isAuthenticated: async () => true,
      getUser: async () => ({ email: 'owner@example.com' }),
      getTokenSilently: async () => buildFakeJwt(['dxcp-platform-admins']),
      loginWithRedirect: async () => {},
      logout: async () => {},
      handleRedirectCallback: async () => {}
    })
    globalThis.fetch = buildFetchMock({ role: 'PLATFORM_ADMIN', deployAllowed: true, rollbackAllowed: true })
    const view = renderApp()

    await view.findByText('PLATFORM_ADMIN')
    fireEvent.click(view.getByRole('link', { name: 'Settings' }))
    await view.findByText('Resolved refresh interval: 5 minutes.')
    const input = await view.findByLabelText('Auto-refresh interval (minutes)')
    await view.findByDisplayValue('5')
    await waitForCondition(() => !input.disabled)
    input.value = '2'
    input.dispatchEvent(new window.Event('input', { bubbles: true }))
    input.dispatchEvent(new window.Event('change', { bubbles: true }))
    await view.findByDisplayValue('2')
    await view.findByText('Resolved refresh interval: 2 minutes.')
    const keyBySub = 'dxcp.user_settings.v1.user-1'
    const keyByEmail = 'dxcp.user_settings.v1.owner@example.com'
    let stored = null
    await waitForCondition(() => {
      stored = window.localStorage.getItem(keyBySub) || window.localStorage.getItem(keyByEmail)
      return Boolean(stored)
    })
    assert.ok(stored)
    const parsed = JSON.parse(stored)
    assert.equal(parsed.refresh_interval_seconds, 120)
    assert.ok(view.getByText('Admin defaults'))
  })

  await runTest('Insights load correctly', async () => {
    window.__DXCP_AUTH0_FACTORY__ = async () => ({
      isAuthenticated: async () => true,
      getUser: async () => ({ email: 'owner@example.com' }),
      getTokenSilently: async () => buildFakeJwt(['dxcp-platform-admins']),
      loginWithRedirect: async () => {},
      logout: async () => {},
      handleRedirectCallback: async () => {}
    })
    globalThis.fetch = buildFetchMock({
      role: 'PLATFORM_ADMIN',
      deployAllowed: true,
      rollbackAllowed: true,
      servicesList: [{ service_name: 'demo-service' }, { service_name: 'payments-service' }],
      deliveryGroups: [
        {
          id: 'default',
          name: 'Default Delivery Group',
          services: ['demo-service'],
          allowed_recipes: ['default'],
          guardrails: { daily_deploy_quota: 5, daily_rollback_quota: 3, max_concurrent_deployments: 1 }
        },
        {
          id: 'payments',
          name: 'Payments Delivery Group',
          services: ['payments-service'],
          allowed_recipes: ['default'],
          guardrails: { daily_deploy_quota: 5, daily_rollback_quota: 3, max_concurrent_deployments: 1 }
        }
      ]
    })
    const view = renderApp()

    await view.findByText('PLATFORM_ADMIN')
    fireEvent.click(view.getByRole('link', { name: 'Insights' }))
    await view.findByText('Rollback rate')
    await view.findByText('Deployments: 10')
    await view.findByText('Rollbacks: 1')
    await view.findByText('CONFIG')
  })

  await runTest('Insights filters apply correctly', async () => {
    window.__DXCP_AUTH0_FACTORY__ = async () => ({
      isAuthenticated: async () => true,
      getUser: async () => ({ email: 'owner@example.com' }),
      getTokenSilently: async () => buildFakeJwt(['dxcp-platform-admins']),
      loginWithRedirect: async () => {},
      logout: async () => {},
      handleRedirectCallback: async () => {}
    })
    globalThis.fetch = buildFetchMock({
      role: 'PLATFORM_ADMIN',
      deployAllowed: true,
      rollbackAllowed: true,
      servicesList: [{ service_name: 'demo-service' }, { service_name: 'payments-service' }],
      deliveryGroups: [
        {
          id: 'default',
          name: 'Default Delivery Group',
          services: ['demo-service'],
          allowed_recipes: ['default'],
          guardrails: { daily_deploy_quota: 5, daily_rollback_quota: 3, max_concurrent_deployments: 1 }
        },
        {
          id: 'payments',
          name: 'Payments Delivery Group',
          services: ['payments-service'],
          allowed_recipes: ['default'],
          guardrails: { daily_deploy_quota: 5, daily_rollback_quota: 3, max_concurrent_deployments: 1 }
        }
      ]
    })
    const view = renderApp()

    await view.findByText('PLATFORM_ADMIN')
    fireEvent.click(view.getByRole('link', { name: 'Insights' }))
    await view.findByText('Rollback rate')
    fireEvent.change(view.getByLabelText('Service'), { target: { value: 'payments-service' } })
    fireEvent.change(view.getByLabelText('Delivery group'), { target: { value: 'payments' } })
    fireEvent.change(view.getByLabelText('Time window (days)'), { target: { value: '30' } })
    fireEvent.click(view.getByRole('button', { name: 'Apply filters' }))
    await view.findByText('Deployments: 4')
    await view.findByText('Rollbacks: 1')
    await view.findByText('INFRASTRUCTURE')
  })

  await runTest('Deploy view auto-selects first service and loads strategies', async () => {
    window.__DXCP_AUTH0_FACTORY__ = async () => ({
      isAuthenticated: async () => true,
      getUser: async () => ({ email: 'owner@example.com' }),
      getTokenSilently: async () => buildFakeJwt(['dxcp-platform-admins']),
      loginWithRedirect: async () => {},
      logout: async () => {},
      handleRedirectCallback: async () => {}
    })
    globalThis.fetch = buildFetchMock({
      role: 'PLATFORM_ADMIN',
      deployAllowed: true,
      rollbackAllowed: true,
      servicesList: [{ service_name: 'demo-service' }, { service_name: 'demo-service-2' }],
      deliveryGroups: [
        {
          id: 'default',
          name: 'Default Delivery Group',
          services: ['demo-service'],
          allowed_recipes: ['default'],
          guardrails: { daily_deploy_quota: 5, daily_rollback_quota: 3, max_concurrent_deployments: 1 }
        }
      ],
      recipes: [{ id: 'default', name: 'Default Deploy' }]
    })
    const view = renderApp()

    await view.findByText('PLATFORM_ADMIN')
    fireEvent.click(view.getByRole('link', { name: 'Deploy' }))
    await view.findAllByText('Default Delivery Group')
    await waitForCondition(() => view.getByLabelText(/Default Deploy/).checked === true)
    assert.ok(view.queryByText('No delivery group assigned.') === null)
  })

  await runTest('Deploy provenance hides artifact reference when policy disables display', async () => {
    window.__DXCP_AUTH0_FACTORY__ = async () => ({
      isAuthenticated: async () => true,
      getUser: async () => ({ email: 'owner@example.com' }),
      getTokenSilently: async () => buildFakeJwt(['dxcp-platform-admins']),
      loginWithRedirect: async () => {},
      logout: async () => {},
      handleRedirectCallback: async () => {}
    })
    globalThis.fetch = buildFetchMock({
      role: 'PLATFORM_ADMIN',
      deployAllowed: true,
      rollbackAllowed: true,
      versionsByService: { 'demo-service': ['2.1.0'] },
      uiExposureArtifactRefDisplay: false
    })
    const view = renderApp()

    await view.findByText('PLATFORM_ADMIN')
    fireEvent.click(view.getByRole('link', { name: 'Deploy' }))
    await ensureServiceSelected(view)
    await ensureEnvironmentSelected(view)
    const versionSelect = view.container.querySelector('#deploy-version')
    assert.ok(versionSelect)
    fireEvent.change(versionSelect, { target: { value: '2.1.0' } })

    await view.findByText('Build Provenance')
    await view.findByText('Hidden by policy')
    assert.equal(view.queryByRole('button', { name: 'Copy full artifact reference' }), null)
    assert.equal(view.queryByText('s3://dxcp-artifacts/demo-service/2.1.0.zip'), null)
    assert.equal(view.queryByRole('link', { name: '0123456789' }), null)
    assert.equal(view.queryByRole('link', { name: 'run-123' }), null)
  })

  await runTest('Deploy provenance shows artifact reference and copy when policy enables display', async () => {
    window.__DXCP_AUTH0_FACTORY__ = async () => ({
      isAuthenticated: async () => true,
      getUser: async () => ({ email: 'owner@example.com' }),
      getTokenSilently: async () => buildFakeJwt(['dxcp-platform-admins']),
      loginWithRedirect: async () => {},
      logout: async () => {},
      handleRedirectCallback: async () => {}
    })
    globalThis.fetch = buildFetchMock({
      role: 'PLATFORM_ADMIN',
      deployAllowed: true,
      rollbackAllowed: true,
      versionsByService: { 'demo-service': ['2.1.0'] },
      uiExposureArtifactRefDisplay: true
    })
    const view = renderApp()

    await view.findByText('PLATFORM_ADMIN')
    fireEvent.click(view.getByRole('link', { name: 'Deploy' }))
    await ensureServiceSelected(view)
    await ensureEnvironmentSelected(view)
    const versionSelect = view.container.querySelector('#deploy-version')
    assert.ok(versionSelect)
    fireEvent.change(versionSelect, { target: { value: '2.1.0' } })

    await view.findByText('Build Provenance')
    await view.findByText('2.1.0.zip')
    assert.ok(view.getByRole('button', { name: 'Copy full artifact reference' }))
  })

  await runTest('Deploy provenance links update after toggling external links policy without page refresh', async () => {
    window.__DXCP_AUTH0_FACTORY__ = async () => ({
      isAuthenticated: async () => true,
      getUser: async () => ({ email: 'owner@example.com' }),
      getTokenSilently: async () => buildFakeJwt(['dxcp-platform-admins']),
      loginWithRedirect: async () => {},
      logout: async () => {},
      handleRedirectCallback: async () => {}
    })
    globalThis.fetch = buildFetchMock({
      role: 'PLATFORM_ADMIN',
      deployAllowed: true,
      rollbackAllowed: true,
      versionsByService: { 'demo-service': ['2.1.0'] },
      uiExposureArtifactRefDisplay: true,
      uiExposureExternalLinksDisplay: false
    })
    const view = renderApp()

    await view.findByText('PLATFORM_ADMIN')
    fireEvent.click(view.getByRole('link', { name: 'Deploy' }))
    await ensureServiceSelected(view)
    await ensureEnvironmentSelected(view)
    const versionSelect = view.container.querySelector('#deploy-version')
    assert.ok(versionSelect)
    fireEvent.change(versionSelect, { target: { value: '2.1.0' } })

    await view.findByText('Build Provenance')
    assert.equal(view.queryByRole('link', { name: '0123456789' }), null)
    assert.equal(view.queryByRole('link', { name: 'run-123' }), null)

    fireEvent.click(view.getByRole('link', { name: 'Admin' }))
    fireEvent.click(view.getByRole('button', { name: 'System Settings' }))
    await view.findByText('Build Provenance Exposure')
    fireEvent.click(view.getByLabelText('Show external links (commit and CI run)'))
    fireEvent.click(view.getByRole('button', { name: 'Save exposure policy' }))
    await view.findByText('Build provenance exposure policy saved.')

    fireEvent.click(view.getByRole('link', { name: 'Deploy' }))
    const commitLink = await view.findByRole('link', { name: '0123456789' })
    const runLink = await view.findByRole('link', { name: 'run-123' })
    assert.equal(commitLink.getAttribute('href'), 'https://scm.example.internal/commit/abc123')
    assert.equal(runLink.getAttribute('href'), 'https://ci.example.internal/runs/123')
  })

  await runTest('No environments configured shows clear empty state', async () => {
    window.__DXCP_AUTH0_FACTORY__ = async () => ({
      isAuthenticated: async () => true,
      getUser: async () => ({ email: 'owner@example.com' }),
      getTokenSilently: async () => buildFakeJwt(['dxcp-platform-admins']),
      loginWithRedirect: async () => {},
      logout: async () => {},
      handleRedirectCallback: async () => {}
    })
    globalThis.fetch = buildFetchMock({
      role: 'PLATFORM_ADMIN',
      deployAllowed: true,
      rollbackAllowed: true,
      environments: []
    })
    const view = renderApp()

    await view.findByText('PLATFORM_ADMIN')
    await view.findByText('No environments available')
    await view.findByText('No environments configured.')
    const emptyState = await view.findAllByText('No environments configured. Ask a platform admin.')
    assert.ok(emptyState.length > 0)
    assert.equal(view.queryByTestId('environment-selector'), null)

    fireEvent.click(view.getByRole('link', { name: 'Deploy' }))
    const deployEmptyState = await view.findAllByText('No environments configured. Ask a platform admin.')
    assert.ok(deployEmptyState.length > 0)
  })

  await runTest('Deploy hides blocked environments from selector', async () => {
    window.__DXCP_AUTH0_FACTORY__ = async () => ({
      isAuthenticated: async () => true,
      getUser: async () => ({ email: 'owner@example.com' }),
      getTokenSilently: async () => buildFakeJwt(['dxcp-platform-admins']),
      loginWithRedirect: async () => {},
      logout: async () => {},
      handleRedirectCallback: async () => {}
    })
    globalThis.fetch = buildFetchMock({
      role: 'PLATFORM_ADMIN',
      deployAllowed: true,
      rollbackAllowed: true,
      deliveryGroups: [
        {
          id: 'default',
          name: 'Default Delivery Group',
          services: ['demo-service'],
          allowed_recipes: ['default'],
          guardrails: { daily_deploy_quota: 5, daily_rollback_quota: 3, max_concurrent_deployments: 1 }
        },
        {
          id: 'payments',
          name: 'Payments Delivery Group',
          services: ['payments-service'],
          allowed_recipes: ['default'],
          guardrails: { daily_deploy_quota: 5, daily_rollback_quota: 3, max_concurrent_deployments: 1 }
        }
      ],
      environments: [
        { id: 'env-default', name: 'sandbox', type: 'non_prod', delivery_group_id: 'default', is_enabled: true },
        { id: 'env-payments', name: 'prod', type: 'prod', delivery_group_id: 'payments', is_enabled: true }
      ]
    })
    const view = renderApp()

    await view.findByText('PLATFORM_ADMIN')
    fireEvent.click(view.getByRole('link', { name: 'Deploy' }))
    const blockedNote = await view.findAllByText(
      'Some environments are unavailable for this service based on delivery group policy.'
    )
    assert.ok(blockedNote.length > 0)
    const selector = await view.findByTestId('environment-selector')
    const values = Array.from(selector.options || []).map((opt) => opt.value)
    assert.deepEqual(values, ['sandbox'])
    assert.equal(values.includes('prod'), false)
  })

  await runTest('Environment selector excludes disabled environments', async () => {
    window.__DXCP_AUTH0_FACTORY__ = async () => ({
      isAuthenticated: async () => true,
      getUser: async () => ({ email: 'owner@example.com' }),
      getTokenSilently: async () => buildFakeJwt(['dxcp-platform-admins']),
      loginWithRedirect: async () => {},
      logout: async () => {},
      handleRedirectCallback: async () => {}
    })
    globalThis.fetch = buildFetchMock({
      role: 'PLATFORM_ADMIN',
      deployAllowed: true,
      rollbackAllowed: true,
      deliveryGroups: [
        {
          id: 'default',
          name: 'Default Delivery Group',
          services: ['demo-service'],
          allowed_recipes: ['default'],
          guardrails: { daily_deploy_quota: 5, daily_rollback_quota: 3, max_concurrent_deployments: 1 }
        }
      ],
      environments: [
        { id: 'env-default', name: 'sandbox', type: 'non_prod', delivery_group_id: 'default', is_enabled: true },
        { id: 'env-default-disabled', name: 'staging', type: 'non_prod', delivery_group_id: 'default', is_enabled: false }
      ]
    })
    const view = renderApp()

    await view.findByText('PLATFORM_ADMIN')
    const selector = await view.findByTestId('environment-selector')
    const values = Array.from(selector.options || []).map((opt) => opt.value)
    assert.deepEqual(values, ['sandbox'])
    assert.equal(values.includes('staging'), false)
  })

  await runTest('Change summary triggers preflight validation when filled', async () => {
    window.__DXCP_AUTH0_FACTORY__ = async () => ({
      isAuthenticated: async () => true,
      getUser: async () => ({ email: 'owner@example.com' }),
      getTokenSilently: async () => buildFakeJwt(['dxcp-platform-admins']),
      loginWithRedirect: async () => {},
      logout: async () => {},
      handleRedirectCallback: async () => {}
    })
    let validateCalls = 0
    const baseFetch = buildFetchMock({
      role: 'PLATFORM_ADMIN',
      deployAllowed: true,
      rollbackAllowed: true,
      servicesList: [{ service_name: 'demo-service' }, { service_name: 'demo-service-2' }],
      recipes: [{ id: 'default', name: 'Default Deploy' }],
      versionsByService: { 'demo-service': ['2.1.0'] }
    })
    globalThis.fetch = async (url, options = {}) => {
      const parsed = new URL(url)
      if (parsed.pathname === '/v1/deployments/validate' && options.method === 'POST') {
        validateCalls += 1
      }
      return baseFetch(url, options)
    }
    const view = renderApp()

    await view.findByText('PLATFORM_ADMIN')
    fireEvent.click(view.getByRole('link', { name: 'Deploy' }))
    await view.findAllByText('Default Delivery Group')
    await ensureServiceSelected(view)
    await ensureEnvironmentSelected(view)
    await view.findByText(/Default applied \(only option\): Default Deploy/)
    const versionSelect = view.container.querySelector('#deploy-version')
    assert.ok(versionSelect)
    fireEvent.change(versionSelect, { target: { value: '2.1.0' } })
    const changeInput = view.getByLabelText('Change summary')
    changeInput.value = 'Release notes'
    changeInput.dispatchEvent(new window.Event('input', { bubbles: true }))
    changeInput.dispatchEvent(new window.Event('change', { bubbles: true }))
    await ensureReviewReady(view)
    await waitForCondition(() => validateCalls >= 1)
  })

  await runTest('Review deploy validates once and blocks on failure', async () => {
    window.__DXCP_AUTH0_FACTORY__ = async () => ({
      isAuthenticated: async () => true,
      getUser: async () => ({ email: 'owner@example.com' }),
      getTokenSilently: async () => buildFakeJwt(['dxcp-platform-admins']),
      loginWithRedirect: async () => {},
      logout: async () => {},
      handleRedirectCallback: async () => {}
    })
    let validateCalls = 0
    const baseFetch = buildFetchMock({
      role: 'PLATFORM_ADMIN',
      deployAllowed: true,
      rollbackAllowed: true,
      servicesList: [{ service_name: 'demo-service' }, { service_name: 'demo-service-2' }],
      preflightResponse: { code: 'QUOTA_EXCEEDED', message: 'Daily quota exceeded', failure_cause: 'POLICY_CHANGE' },
      versionsByService: { 'demo-service': ['2.1.0'] }
    })
    globalThis.fetch = async (url, options = {}) => {
      const parsed = new URL(url)
      if (parsed.pathname === '/v1/deployments/validate' && options.method === 'POST') {
        validateCalls += 1
      }
      return baseFetch(url, options)
    }
    const view = renderApp()

    await view.findByText('PLATFORM_ADMIN')
    fireEvent.click(view.getByRole('link', { name: 'Deploy' }))
    await view.findAllByText('Default Delivery Group')
    await ensureServiceSelected(view)
    await ensureEnvironmentSelected(view)
    await view.findByText(/Default applied \(only option\): Default Deploy/)
    const versionSelect = view.container.querySelector('#deploy-version')
    assert.ok(versionSelect)
    fireEvent.change(versionSelect, { target: { value: '2.1.0' } })
    const changeInput = view.getByLabelText('Change summary')
    changeInput.value = 'release'
    changeInput.dispatchEvent(new window.Event('input', { bubbles: true }))
    changeInput.dispatchEvent(new window.Event('change', { bubbles: true }))
    await waitForCondition(() => versionSelect.value === '2.1.0')
    await view.findByDisplayValue('release')
    await ensureReviewReady(view)
    await clickReviewUntil(view, {
      label: 'Review deploy',
      expectConfirm: false,
      getValidateCalls: () => validateCalls
    })
    await waitForPreflightError(view)
    await view.findByText(/QUOTA_EXCEEDED/)
    assert.equal(view.queryByText('Confirm deploy'), null)
  })

  await runTest('Blocked deploy shows correct message', async () => {
    window.__DXCP_AUTH0_FACTORY__ = async () => ({
      isAuthenticated: async () => true,
      getUser: async () => ({ email: 'owner@example.com' }),
      getTokenSilently: async () => buildFakeJwt(['dxcp-platform-admins']),
      loginWithRedirect: async () => {},
      logout: async () => {},
      handleRedirectCallback: async () => {}
    })
    let validateCalls = 0
    const baseFetch = buildFetchMock({
      role: 'PLATFORM_ADMIN',
      deployAllowed: true,
      rollbackAllowed: true,
      servicesList: [{ service_name: 'demo-service' }, { service_name: 'demo-service-2' }],
      preflightResponse: { code: 'QUOTA_EXCEEDED', message: 'Daily quota exceeded', failure_cause: 'POLICY_CHANGE' },
      versionsByService: { 'demo-service': ['2.1.0'] }
    })
    globalThis.fetch = async (url, options = {}) => {
      const parsed = new URL(url)
      if (parsed.pathname === '/v1/deployments/validate' && options.method === 'POST') {
        validateCalls += 1
      }
      return baseFetch(url, options)
    }
    const view = renderApp()

    await view.findByText('PLATFORM_ADMIN')
    fireEvent.click(view.getByRole('link', { name: 'Deploy' }))
    await view.findAllByText('Default Delivery Group')
    await ensureServiceSelected(view)
    await ensureEnvironmentSelected(view)
    await view.findByText(/Default applied \(only option\): Default Deploy/)
    const versionSelect = view.container.querySelector('#deploy-version')
    assert.ok(versionSelect)
    fireEvent.change(versionSelect, { target: { value: '2.1.0' } })
    const changeInput = view.getByLabelText('Change summary')
    changeInput.value = 'release'
    changeInput.dispatchEvent(new window.Event('input', { bubbles: true }))
    changeInput.dispatchEvent(new window.Event('change', { bubbles: true }))
    await view.findByDisplayValue('release')
    await waitForCondition(() => versionSelect.value === '2.1.0')
    await ensureReviewReady(view)
    await clickReviewUntil(view, {
      label: 'Blocked deploy',
      expectConfirm: false,
      getValidateCalls: () => validateCalls
    })
    await waitForPreflightError(view)
    await view.findByText(/QUOTA_EXCEEDED/)
    assert.equal(view.queryByText('Confirm deploy'), null)
  })

  await runTest('Allowed deploy redirects to detail page', async () => {
    window.__DXCP_AUTH0_FACTORY__ = async () => ({
      isAuthenticated: async () => true,
      getUser: async () => ({ email: 'owner@example.com' }),
      getTokenSilently: async () => buildFakeJwt(['dxcp-platform-admins']),
      loginWithRedirect: async () => {},
      logout: async () => {},
      handleRedirectCallback: async () => {}
    })
    let validateCalls = 0
    const baseFetch = buildFetchMock({
      role: 'PLATFORM_ADMIN',
      deployAllowed: true,
      rollbackAllowed: true,
      servicesList: [{ service_name: 'demo-service' }, { service_name: 'demo-service-2' }],
      deployResponse: { id: 'dep-1', service: 'demo-service', version: '2.1.0', state: 'IN_PROGRESS' },
      versionsByService: { 'demo-service': ['2.1.0'] }
    })
    globalThis.fetch = async (url, options = {}) => {
      const parsed = new URL(url)
      if (parsed.pathname === '/v1/deployments/validate' && options.method === 'POST') {
        validateCalls += 1
      }
      return baseFetch(url, options)
    }
    const view = renderApp()

    await view.findByText('PLATFORM_ADMIN')
    fireEvent.click(view.getByRole('link', { name: 'Deploy' }))
    await view.findAllByText('Default Delivery Group')
    await ensureServiceSelected(view)
    await ensureEnvironmentSelected(view)
    await view.findByText(/Default applied \(only option\): Default Deploy/)
    const versionSelect = view.container.querySelector('#deploy-version')
    assert.ok(versionSelect)
    fireEvent.change(versionSelect, { target: { value: '2.1.0' } })
    const changeInput = view.getByLabelText('Change summary')
    changeInput.value = 'release'
    changeInput.dispatchEvent(new window.Event('input', { bubbles: true }))
    changeInput.dispatchEvent(new window.Event('change', { bubbles: true }))
    await view.findByDisplayValue('release')
    await waitForCondition(() => versionSelect.value === '2.1.0')
    await ensureReviewReady(view)
    const reviewButton = view.getByRole('button', { name: 'Review deploy' })
    assert.equal(reviewButton.disabled, false)
    await clickReviewUntil(view, {
      label: 'Allowed deploy',
      expectConfirm: true,
      getValidateCalls: () => validateCalls
    })
    await waitForConfirmDeploy(view)
    const confirmButton = await view.findByRole('button', { name: 'Confirm deploy' })
    await waitForCondition(() => !confirmButton.disabled)
    fireEvent.click(confirmButton)
    await waitForConditionWithDump(
      () => view.queryByText('Deployment detail') !== null,
      view,
      'Allowed deploy detail view'
    )
  })

  await runTest('Deprecated recipe blocks deploy', async () => {
    window.__DXCP_AUTH0_FACTORY__ = async () => ({
      isAuthenticated: async () => true,
      getUser: async () => ({ email: 'owner@example.com' }),
      getTokenSilently: async () => buildFakeJwt(['dxcp-platform-admins']),
      loginWithRedirect: async () => {},
      logout: async () => {},
      handleRedirectCallback: async () => {}
    })
    globalThis.fetch = buildFetchMock({
      role: 'PLATFORM_ADMIN',
      deployAllowed: true,
      rollbackAllowed: true,
      recipes: [{ id: 'default', name: 'Default Deploy', status: 'deprecated' }],
      versionsByService: { 'demo-service': ['2.1.0'] }
    })
    const view = renderApp()

    await view.findByText('PLATFORM_ADMIN')
    fireEvent.click(view.getByRole('link', { name: 'Deploy' }))
    await view.findAllByText('Default Delivery Group')
    await waitForCondition(() => view.getByLabelText(/Default Deploy/).checked === true)
    const changeInput = view.getByLabelText('Change summary')
    changeInput.value = 'release'
    changeInput.dispatchEvent(new window.Event('input', { bubbles: true }))
    changeInput.dispatchEvent(new window.Event('change', { bubbles: true }))
    await view.findByDisplayValue('release')
    await view.findByText('Selected recipe is deprecated and cannot be used for new deployments.')
    const reviewButton = view.getByRole('button', { name: 'Review deploy' })
    assert.equal(reviewButton.disabled, true)
  })

  await runTest('Admin can delete an unreferenced recipe from Recipes tab', async () => {
    window.__DXCP_AUTH0_FACTORY__ = async () => ({
      isAuthenticated: async () => true,
      getUser: async () => ({ email: 'admin@example.com' }),
      getTokenSilently: async () => buildFakeJwt(['dxcp-platform-admins']),
      loginWithRedirect: async () => {},
      logout: async () => {},
      handleRedirectCallback: async () => {}
    })
    globalThis.fetch = buildFetchMock({
      role: 'PLATFORM_ADMIN',
      deployAllowed: true,
      rollbackAllowed: true,
      deliveryGroups: [
        {
          id: 'default',
          name: 'Default Delivery Group',
          services: ['demo-service'],
          allowed_recipes: ['default', 'temp-delete'],
          guardrails: { daily_deploy_quota: 5, daily_rollback_quota: 3, max_concurrent_deployments: 1 }
        }
      ],
      recipes: [
        { id: 'default', name: 'Default Deploy', status: 'active' },
        { id: 'temp-delete', name: 'Temp Delete Recipe', status: 'active' }
      ]
    })
    const previousConfirm = window.confirm
    window.confirm = () => true
    try {
      const view = renderApp()
      await view.findByText('PLATFORM_ADMIN')
      fireEvent.click(view.getByRole('link', { name: 'Admin' }))
      fireEvent.click(view.getByRole('button', { name: 'Recipes' }))
      const recipeIdCell = await view.findByText('temp-delete')
      const row = recipeIdCell.closest('.list-item')
      assert.ok(row)
      const deleteButton = row.querySelector('[data-testid="admin-recipe-delete"]')
      assert.ok(deleteButton)
      fireEvent.click(deleteButton)
      await view.findByText('Recipe deleted.')
      await waitForCondition(() => view.queryByText('temp-delete') === null)
    } finally {
      window.confirm = previousConfirm
    }
  })

  await runTest('Admin delete shows in-use error and keeps recipe row', async () => {
    window.__DXCP_AUTH0_FACTORY__ = async () => ({
      isAuthenticated: async () => true,
      getUser: async () => ({ email: 'admin@example.com' }),
      getTokenSilently: async () => buildFakeJwt(['dxcp-platform-admins']),
      loginWithRedirect: async () => {},
      logout: async () => {},
      handleRedirectCallback: async () => {}
    })
    globalThis.fetch = buildFetchMock({
      role: 'PLATFORM_ADMIN',
      deployAllowed: true,
      rollbackAllowed: true,
      recipes: [{ id: 'default', name: 'Default Deploy', status: 'active' }],
      deleteRecipeResponses: {
        default: {
          status: 409,
          body: {
            code: 'RECIPE_IN_USE',
            message: 'Recipe default is still referenced by service_environment_routing',
            details: {
              reference_type: 'service_environment_routing',
              reference_count: 1,
              references: [{ service_id: 'demo-service', environment_id: 'sandbox' }]
            }
          }
        }
      }
    })
    const previousConfirm = window.confirm
    window.confirm = () => true
    try {
      const view = renderApp()
      await view.findByText('PLATFORM_ADMIN')
      fireEvent.click(view.getByRole('link', { name: 'Admin' }))
      fireEvent.click(view.getByRole('button', { name: 'Recipes' }))
      const recipeIdCell = await view.findByText('default')
      const row = recipeIdCell.closest('.list-item')
      assert.ok(row)
      const deleteButton = row.querySelector('[data-testid="admin-recipe-delete"]')
      assert.ok(deleteButton)
      fireEvent.click(deleteButton)
      await view.findByText(/RECIPE_IN_USE:/)
      await view.findByText(/demo-service:sandbox/)
      assert.ok(view.queryByText('default'))
    } finally {
      window.confirm = previousConfirm
    }
  })

  await runTest('Admin can create and edit delivery group', async () => {
    window.__DXCP_AUTH0_FACTORY__ = async () => ({
      isAuthenticated: async () => true,
      getUser: async () => ({ email: 'admin@example.com' }),
      getTokenSilently: async () => buildFakeJwt(['dxcp-platform-admins']),
      loginWithRedirect: async () => {},
      logout: async () => {},
      handleRedirectCallback: async () => {}
    })
    globalThis.fetch = buildFetchMock({
      role: 'PLATFORM_ADMIN',
      deployAllowed: true,
      rollbackAllowed: true,
      deliveryGroups: [
        {
          id: 'default',
          name: 'Default Delivery Group',
          services: ['demo-service'],
          allowed_recipes: ['default'],
          guardrails: { daily_deploy_quota: 5, daily_rollback_quota: 3, max_concurrent_deployments: 1 }
        }
      ],
      servicesList: [{ service_name: 'demo-service' }, { service_name: 'payments-service' }],
      recipes: [
        { id: 'default', name: 'Default Deploy' },
        { id: 'canary', name: 'Canary Deploy' }
      ]
    })
    const view = renderApp()

    await view.findByText('PLATFORM_ADMIN')
    fireEvent.click(view.getByRole('link', { name: 'Admin' }))
    await view.findByText('Delivery groups')
    fireEvent.click(view.getByRole('button', { name: 'Create group' }))
    const idInput = await view.findByLabelText('Group id')
    fireEvent.input(idInput, { target: { value: 'payments' } })
    await waitForCondition(() => view.getByLabelText('Group id').value === 'payments')
    const nameInput = view.getByLabelText('Name')
    fireEvent.input(nameInput, { target: { value: 'Payments Group' } })
    await waitForCondition(() => view.getByLabelText('Name').value === 'Payments Group')
    const ownerInput = view.getByLabelText('Owner emails (comma-separated)')
    fireEvent.input(ownerInput, { target: { value: 'team-payments@example.com, team-ops@example.com' } })
    await waitForCondition(
      () => view.getByLabelText('Owner emails (comma-separated)').value === 'team-payments@example.com, team-ops@example.com'
    )
    fireEvent.click(view.getByLabelText('payments-service'))
    fireEvent.click(view.getByLabelText(/Canary Deploy/))
    fireEvent.change(view.getByLabelText('Max concurrent deployments'), { target: { value: '2' } })
    fireEvent.change(view.getByLabelText('Daily deploy quota'), { target: { value: '10' } })
    fireEvent.click(view.getByRole('button', { name: 'Save group' }))
    await waitForCondition(() => view.queryAllByText('Payments Group').length > 0)
    assert.ok(view.getAllByText('Payments Group').length > 0)

    const editButtons = view.getAllByRole('button', { name: 'Edit' })
    fireEvent.click(editButtons[editButtons.length - 1])
    await view.findByText('Edit delivery group')
    fireEvent.input(view.getByLabelText('Name'), { target: { value: 'Payments Core' } })
    await waitForCondition(() => view.getByLabelText('Name').value === 'Payments Core')
    fireEvent.click(view.getByLabelText(/Default Deploy/))
    fireEvent.click(view.getByRole('button', { name: 'Save group' }))
    await waitForCondition(() => view.queryAllByText('Payments Core').length > 0)
    assert.ok(view.getAllByText('Payments Core').length > 0)
  })

  await runTest('Admin must confirm guardrail warnings before saving', async () => {
    window.__DXCP_AUTH0_FACTORY__ = async () => ({
      isAuthenticated: async () => true,
      getUser: async () => ({ email: 'admin@example.com' }),
      getTokenSilently: async () => buildFakeJwt(['dxcp-platform-admins']),
      loginWithRedirect: async () => {},
      logout: async () => {},
      handleRedirectCallback: async () => {}
    })
    globalThis.fetch = buildFetchMock({
      role: 'PLATFORM_ADMIN',
      deployAllowed: true,
      rollbackAllowed: true,
      guardrailValidation: {
        validation_status: 'WARNING',
        messages: [{ type: 'WARNING', field: 'services', message: 'No services selected; this group will be inert.' }]
      }
    })
    const view = renderApp()

    await view.findByText('PLATFORM_ADMIN')
    fireEvent.click(view.getByRole('link', { name: 'Admin' }))
    fireEvent.click(view.getByRole('button', { name: 'Create group' }))
    fireEvent.input(await view.findByLabelText('Group id'), { target: { value: 'warn-group' } })
    fireEvent.input(view.getByLabelText('Name'), { target: { value: 'Warn Group' } })
    fireEvent.click(view.getByRole('button', { name: 'Preview changes' }))
    await view.findByText('Validation: WARNING')
    fireEvent.click(view.getByRole('button', { name: 'Save group' }))
    await view.findByText('Warnings require confirmation before saving.')
    fireEvent.click(view.getByLabelText('Confirm warnings and proceed to save.'))
    fireEvent.click(view.getByRole('button', { name: 'Save group' }))
    await waitForCondition(() => view.queryAllByText('Warn Group').length > 0)
    assert.ok(view.getAllByText('Warn Group').length > 0)
  })

  await runTest('Admin can create environment from Admin UI', async () => {
    window.__DXCP_AUTH0_FACTORY__ = async () => ({
      isAuthenticated: async () => true,
      getUser: async () => ({ email: 'admin@example.com' }),
      getTokenSilently: async () => buildFakeJwt(['dxcp-platform-admins']),
      loginWithRedirect: async () => {},
      logout: async () => {},
      handleRedirectCallback: async () => {}
    })
    globalThis.fetch = buildFetchMock({
      role: 'PLATFORM_ADMIN',
      deployAllowed: true,
      rollbackAllowed: true,
      adminEnvironments: [{ environment_id: 'sandbox', display_name: 'Sandbox', type: 'non_prod', is_enabled: true }]
    })
    const view = renderApp()

    await view.findByText('PLATFORM_ADMIN')
    fireEvent.click(view.getByRole('link', { name: 'Admin' }))
    fireEvent.click(view.getByRole('button', { name: 'Environments' }))
    await view.findByText('Environment ID')
    const envIdInput = await view.findByTestId('admin-environment-id-input')
    assert.equal(envIdInput.getAttribute('placeholder'), 'dev, staging, prod')
    assert.ok(view.getByRole('button', { name: 'Environment ID details' }))
    assert.ok(
      view.getByText(
        'Stable identifier used internally and in APIs. Lowercase letters, numbers, and hyphens only. Cannot be changed later.'
      )
    )
    fireEvent.input(envIdInput, { target: { value: 'staging' } })
    fireEvent.input(view.getByLabelText('Display name'), { target: { value: 'Staging' } })
    fireEvent.click(view.getByTestId('admin-environment-save'))
    await view.findByText('Environment created.')
    await view.findByText('staging')
  })

  await runTest('Admin can bind environment to delivery group', async () => {
    window.__DXCP_AUTH0_FACTORY__ = async () => ({
      isAuthenticated: async () => true,
      getUser: async () => ({ email: 'admin@example.com' }),
      getTokenSilently: async () => buildFakeJwt(['dxcp-platform-admins']),
      loginWithRedirect: async () => {},
      logout: async () => {},
      handleRedirectCallback: async () => {}
    })
    globalThis.fetch = buildFetchMock({
      role: 'PLATFORM_ADMIN',
      deployAllowed: true,
      rollbackAllowed: true,
      adminEnvironments: [{ environment_id: 'staging', display_name: 'Staging', type: 'non_prod', is_enabled: true }]
    })
    const view = renderApp()

    await view.findByText('PLATFORM_ADMIN')
    fireEvent.click(view.getByRole('link', { name: 'Admin' }))
    fireEvent.click(view.getByRole('button', { name: 'DG Environment Policy' }))
    fireEvent.change(await view.findByLabelText('Delivery group'), { target: { value: 'default' } })
    fireEvent.click((await view.findAllByTestId('admin-dg-bind-save'))[0])
    await view.findByText('Binding saved.')
  })

  await runTest('Admin can set service environment routing', async () => {
    window.__DXCP_AUTH0_FACTORY__ = async () => ({
      isAuthenticated: async () => true,
      getUser: async () => ({ email: 'admin@example.com' }),
      getTokenSilently: async () => buildFakeJwt(['dxcp-platform-admins']),
      loginWithRedirect: async () => {},
      logout: async () => {},
      handleRedirectCallback: async () => {}
    })
    globalThis.fetch = buildFetchMock({
      role: 'PLATFORM_ADMIN',
      deployAllowed: true,
      rollbackAllowed: true,
      adminEnvironments: [{ environment_id: 'staging', display_name: 'Staging', type: 'non_prod', is_enabled: true }]
    })
    const view = renderApp()

    await view.findByText('PLATFORM_ADMIN')
    fireEvent.click(view.getByRole('link', { name: 'Admin' }))
    fireEvent.click(view.getByRole('button', { name: 'Service Environment Routing' }))
    fireEvent.change(await view.findByLabelText('Service'), { target: { value: 'demo-service' } })
    fireEvent.change((await view.findAllByTestId('admin-service-route-save'))[0], { target: { value: 'default' } })
    await view.findByText('Routing saved.')
  })

  await runTest('Admin cannot save when validation has errors', async () => {
    window.__DXCP_AUTH0_FACTORY__ = async () => ({
      isAuthenticated: async () => true,
      getUser: async () => ({ email: 'admin@example.com' }),
      getTokenSilently: async () => buildFakeJwt(['dxcp-platform-admins']),
      loginWithRedirect: async () => {},
      logout: async () => {},
      handleRedirectCallback: async () => {}
    })
    globalThis.fetch = buildFetchMock({
      role: 'PLATFORM_ADMIN',
      deployAllowed: true,
      rollbackAllowed: true,
      guardrailValidation: {
        validation_status: 'ERROR',
        messages: [{ type: 'ERROR', field: 'guardrails', message: 'Invalid guardrail.' }]
      }
    })
    const view = renderApp()

    await view.findByText('PLATFORM_ADMIN')
    fireEvent.click(view.getByRole('link', { name: 'Admin' }))
    fireEvent.click(view.getByRole('button', { name: 'Create group' }))
    fireEvent.input(await view.findByLabelText('Group id'), { target: { value: 'error-group' } })
    fireEvent.input(view.getByLabelText('Name'), { target: { value: 'Error Group' } })
    fireEvent.click(view.getByRole('button', { name: 'Preview changes' }))
    await view.findByText('Validation: ERROR')
    const saveButton = view.getByRole('button', { name: 'Save group' })
    assert.equal(saveButton.disabled, true)
  })

  await runTest('Delivery group validation errors shown', async () => {
    window.__DXCP_AUTH0_FACTORY__ = async () => ({
      isAuthenticated: async () => true,
      getUser: async () => ({ email: 'admin@example.com' }),
      getTokenSilently: async () => buildFakeJwt(['dxcp-platform-admins']),
      loginWithRedirect: async () => {},
      logout: async () => {},
      handleRedirectCallback: async () => {}
    })
    globalThis.fetch = buildFetchMock({
      role: 'PLATFORM_ADMIN',
      deployAllowed: true,
      rollbackAllowed: true,
      deliveryGroups: [
        {
          id: 'default',
          name: 'Default Delivery Group',
          services: ['demo-service'],
          allowed_recipes: ['default'],
          guardrails: { daily_deploy_quota: 5, daily_rollback_quota: 3, max_concurrent_deployments: 1 }
        }
      ],
      servicesList: [{ service_name: 'demo-service' }]
    })
    const view = renderApp()

    await view.findByText('PLATFORM_ADMIN')
    fireEvent.click(view.getByRole('link', { name: 'Admin' }))
    await view.findByText('Delivery groups')
    fireEvent.click(view.getByRole('button', { name: 'Create group' }))
    const conflictId = await view.findByLabelText('Group id')
    conflictId.value = 'conflict'
    conflictId.dispatchEvent(new window.Event('input', { bubbles: true }))
    conflictId.dispatchEvent(new window.Event('change', { bubbles: true }))
    const conflictName = view.getByLabelText('Name')
    conflictName.value = 'Conflict Group'
    conflictName.dispatchEvent(new window.Event('input', { bubbles: true }))
    conflictName.dispatchEvent(new window.Event('change', { bubbles: true }))
    fireEvent.click(view.getByLabelText('demo-service'))
    fireEvent.click(view.getByRole('button', { name: 'Save group' }))
    const messages = await view.findAllByText(/already belongs to/i)
    assert.ok(messages.length > 0)
  })

  await runTest('Timeline renders normalized order', async () => {
    window.__DXCP_AUTH0_FACTORY__ = async () => ({
      isAuthenticated: async () => true,
      getUser: async () => ({ email: 'owner@example.com' }),
      getTokenSilently: async () => buildFakeJwt(['dxcp-platform-admins']),
      loginWithRedirect: async () => {},
      logout: async () => {},
      handleRedirectCallback: async () => {}
    })
    const timeline = [
      {
        key: 'succeeded',
        label: 'Succeeded',
        occurredAt: '2025-01-02T00:00:00Z',
        detail: 'Deployment completed.'
      },
      {
        key: 'submitted',
        label: 'Submitted',
        occurredAt: '2025-01-01T00:00:00Z',
        detail: 'Deployment intent received.'
      }
    ]
    globalThis.fetch = buildFetchMock({
      role: 'PLATFORM_ADMIN',
      deployAllowed: true,
      rollbackAllowed: true,
      timeline
    })
    const view = renderApp()

    await view.findByText('PLATFORM_ADMIN')
    fireEvent.click(view.getByRole('link', { name: 'Deployments' }))
    await view.findByText('SUCCEEDED')
    fireEvent.click(view.getAllByRole('button', { name: 'Details' })[0])
    await view.findByText('Deployment detail')
    const steps = view.container.querySelectorAll('.timeline-step')
    assert.equal(steps.length, 2)
    assert.ok(steps[0].textContent.includes('Submitted'))
    assert.ok(steps[1].textContent.includes('Succeeded'))
  })

  await runTest('Failure list renders badge and suggested action', async () => {
    window.__DXCP_AUTH0_FACTORY__ = async () => ({
      isAuthenticated: async () => true,
      getUser: async () => ({ email: 'owner@example.com' }),
      getTokenSilently: async () => buildFakeJwt(['dxcp-platform-admins']),
      loginWithRedirect: async () => {},
      logout: async () => {},
      handleRedirectCallback: async () => {}
    })
    const failures = [
      {
        category: 'INFRA',
        summary: 'Execution failed during bake.',
        actionHint: 'Retry after checking the image registry.',
        observedAt: '2025-01-02T01:00:00Z'
      }
    ]
    globalThis.fetch = buildFetchMock({
      role: 'PLATFORM_ADMIN',
      deployAllowed: true,
      rollbackAllowed: true,
      failures
    })
    const view = renderApp()

    await view.findByText('PLATFORM_ADMIN')
    fireEvent.click(view.getByRole('link', { name: 'Deployments' }))
    await view.findByText('SUCCEEDED')
    fireEvent.click(view.getAllByRole('button', { name: 'Details' })[0])
    await view.findByText('Failures')
    assert.ok(view.getByText('Suggested action: Retry after checking the image registry.'))
    const badge = view.container.querySelector('.failure .badge')
    assert.ok(badge)
    assert.equal(badge.textContent, 'INFRASTRUCTURE')
    assert.ok(view.getByRole('link', { name: 'Open execution detail' }))
  })

  await runTest('Services list renders from API', async () => {
    window.__DXCP_AUTH0_FACTORY__ = async () => ({
      isAuthenticated: async () => true,
      getUser: async () => ({ email: 'owner@example.com' }),
      getTokenSilently: async () => buildFakeJwt(['dxcp-platform-admins']),
      loginWithRedirect: async () => {},
      logout: async () => {},
      handleRedirectCallback: async () => {}
    })
    globalThis.fetch = buildFetchMock({ role: 'PLATFORM_ADMIN', deployAllowed: true, rollbackAllowed: true })
    const view = renderApp()

    await view.findByText('PLATFORM_ADMIN')
    fireEvent.click(view.getByRole('link', { name: 'Services' }))
    await view.findByText('demo-service')
    await view.findByText('SUCCEEDED')
  })

  await runTest('Service detail loads correct data', async () => {
    window.__DXCP_AUTH0_FACTORY__ = async () => ({
      isAuthenticated: async () => true,
      getUser: async () => ({ email: 'owner@example.com' }),
      getTokenSilently: async () => buildFakeJwt(['dxcp-platform-admins']),
      loginWithRedirect: async () => {},
      logout: async () => {},
      handleRedirectCallback: async () => {}
    })
    globalThis.fetch = buildFetchMock({ role: 'PLATFORM_ADMIN', deployAllowed: true, rollbackAllowed: true })
    const view = renderApp()

    await view.findByText('PLATFORM_ADMIN')
    fireEvent.click(view.getByRole('link', { name: 'Services' }))
    await view.findByText('demo-service')
    fireEvent.click(view.getByRole('button', { name: /demo-service/ }))
    await view.findByText('Service detail')
    await view.findByText('Version: 2.1.0')
  })

  await runTest('Service detail shows promotion action with structured summary', async () => {
    window.__DXCP_AUTH0_FACTORY__ = async () => ({
      isAuthenticated: async () => true,
      getUser: async () => ({ email: 'owner@example.com' }),
      getTokenSilently: async () => buildFakeJwt(['dxcp-platform-admins']),
      loginWithRedirect: async () => {},
      logout: async () => {},
      handleRedirectCallback: async () => {}
    })
    globalThis.fetch = buildFetchMock({ role: 'PLATFORM_ADMIN', deployAllowed: true, rollbackAllowed: true })
    const view = renderApp()

    await view.findByText('PLATFORM_ADMIN')
    fireEvent.click(view.getByRole('link', { name: 'Services' }))
    await view.findByText('demo-service')
    fireEvent.click(view.getByRole('button', { name: /demo-service/ }))
    await view.findByText('Service detail')
    await view.findByText('Promote')
    await view.findByText('Source environment')
    await view.findByText('Target environment')
    await view.findByText('staging')
    assert.ok(view.getByRole('button', { name: 'Review promotion' }))
  })

  await runTest('Promote payload excludes recipeId and confirm view uses validate recipeId binding', async () => {
    const appSource = readFileSync(resolvePath(process.cwd(), 'src', 'App.jsx'), 'utf8')
    const servicesPageSource = readFileSync(resolvePath(process.cwd(), 'src', 'pages', 'ServicesPage.jsx'), 'utf8')
    assert.ok(appSource.includes("const result = await api.post('/promotions/validate', payload)"))
    assert.ok(appSource.includes("const result = await api.post('/promotions', payload, key)"))
    assert.ok(!appSource.includes('recipeId: candidate.recipeId'))
    assert.ok(!appSource.includes('recipeId: promotionValidation.recipeId'))
    assert.ok(servicesPageSource.includes('{promotionValidation?.recipeId || \'-\'}'))
  })

  await runTest('Service detail shows Backstage link when configured', async () => {
    window.__DXCP_AUTH0_FACTORY__ = async () => ({
      isAuthenticated: async () => true,
      getUser: async () => ({ email: 'owner@example.com' }),
      getTokenSilently: async () => buildFakeJwt(['dxcp-platform-admins']),
      loginWithRedirect: async () => {},
      logout: async () => {},
      handleRedirectCallback: async () => {}
    })
    globalThis.fetch = buildFetchMock({
      role: 'PLATFORM_ADMIN',
      deployAllowed: true,
      rollbackAllowed: true,
      servicesList: [
        {
          service_name: 'demo-service',
          backstage_entity_ref: 'component:default/demo-service',
          backstage_entity_url: 'https://backstage.example/catalog/default/component/demo-service'
        }
      ]
    })
    const view = renderApp()

    await view.findByText('PLATFORM_ADMIN')
    fireEvent.click(view.getByRole('link', { name: 'Services' }))
    await view.findByText('demo-service')
    fireEvent.click(view.getByRole('button', { name: /demo-service/ }))
    await view.findByText('Integrations')
    await view.findByText('component:default/demo-service')
    assert.ok(view.getByRole('link', { name: 'Open in Backstage' }))
  })

  await runTest('API client attaches Authorization header', async () => {
    let capturedAuth = ''
    globalThis.fetch = async (url, options) => {
      capturedAuth = options?.headers?.Authorization || ''
      return { json: async () => ({ ok: true }) }
    }
    const client = createApiClient({
      baseUrl: 'http://localhost:8000/v1',
      getToken: async () => 'test-token'
    })
    await client.get('/services')
    assert.equal(capturedAuth, 'Bearer test-token')
  })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runAllTests()
}
