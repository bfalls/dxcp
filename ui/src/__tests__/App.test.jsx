import { render, cleanup, fireEvent } from '@testing-library/react'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import App from '../App.jsx'
import { createApiClient } from '../apiClient.js'

const ok = (data) =>
  Promise.resolve({
    json: () => Promise.resolve(data)
  })

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
  versionsByService
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
    if (pathname === '/v1/settings/public') {
      return ok({
        default_refresh_interval_seconds: 300,
        min_refresh_interval_seconds: 60,
        max_refresh_interval_seconds: 3600
      })
    }
    if (pathname === '/v1/settings/admin') {
      return ok({
        default_refresh_interval_seconds: 300,
        min_refresh_interval_seconds: 60,
        max_refresh_interval_seconds: 3600
      })
    }
    if (pathname === '/v1/admin/guardrails/validate') {
      return ok(
        guardrailValidation || {
          validation_status: 'OK',
          messages: []
        }
      )
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
    if (pathname === '/v1/services') {
      return ok(serviceList)
    }
    if (pathname.startsWith('/v1/services/') && pathname.endsWith('/delivery-status')) {
      return ok({
        service: 'demo-service',
        hasDeployments: true,
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
      return ok([
        {
          id: 'dep-1',
          state: 'SUCCEEDED',
          version: '2.1.0',
          createdAt: '2025-01-01T00:00:00Z'
        }
      ])
    }
    if (pathname === '/v1/deployments') {
      return ok([
        {
          id: 'dep-1',
          state: 'SUCCEEDED',
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
  for (let i = 0; i < attempts; i += 1) {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('Condition not met in time')
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
      rolesClaim: 'https://dxcp.example/claims/roles'
    }
    window.__DXCP_AUTH0_RESET__ = true
    await fn()
  } finally {
    if (globalThis.window?.localStorage) {
      globalThis.window.localStorage.clear()
    }
    cleanup()
    dom.window.close()
    delete globalThis.window.__DXCP_AUTH0_FACTORY__
    delete globalThis.window.__DXCP_AUTH0_CONFIG__
    delete globalThis.window
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
    const view = render(<App />)

    await view.findByText('OBSERVER')
    const adminButton = view.getByRole('button', { name: 'Admin' })
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
    const view = render(<App />)

    await view.findByText('OBSERVER')
    fireEvent.click(view.getByRole('button', { name: 'Deploy' }))
    const reviewButton = view.getByRole('button', { name: 'Review deploy' })
    assert.equal(reviewButton.disabled, true)
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
    const view = render(<App />)

    await view.findByText('PLATFORM_ADMIN')
    assert.ok(view.getAllByRole('button', { name: 'Deploy' })[0])
    assert.ok(view.getByRole('button', { name: 'Deployments' }))
    assert.ok(view.getByRole('button', { name: 'Detail' }))
    assert.ok(view.getByRole('button', { name: 'Insights' }))
    assert.ok(view.getByRole('button', { name: 'Settings' }))
    assert.ok(view.getByRole('button', { name: 'Admin' }))
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
    const view = render(<App />)

    await view.findByText('OBSERVER')
    fireEvent.click(view.getByRole('button', { name: 'Settings' }))
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
    const view = render(<App />)

    await view.findByText('PLATFORM_ADMIN')
    fireEvent.click(view.getByRole('button', { name: 'Settings' }))
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
    const view = render(<App />)

    await view.findByText('PLATFORM_ADMIN')
    fireEvent.click(view.getByRole('button', { name: 'Insights' }))
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
    const view = render(<App />)

    await view.findByText('PLATFORM_ADMIN')
    fireEvent.click(view.getByRole('button', { name: 'Insights' }))
    await view.findByText('Rollback rate')
    fireEvent.change(view.getByLabelText('Service'), { target: { value: 'payments-service' } })
    fireEvent.change(view.getByLabelText('Delivery group'), { target: { value: 'payments' } })
    fireEvent.change(view.getByLabelText('Time window (days)'), { target: { value: '30' } })
    fireEvent.click(view.getByRole('button', { name: 'Apply filters' }))
    await view.findByText('Deployments: 4')
    await view.findByText('Rollbacks: 1')
    await view.findByText('INFRASTRUCTURE')
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
    globalThis.fetch = buildFetchMock({
      role: 'PLATFORM_ADMIN',
      deployAllowed: true,
      rollbackAllowed: true,
      preflightResponse: { code: 'QUOTA_EXCEEDED', message: 'Daily quota exceeded', failure_cause: 'POLICY_CHANGE' },
      versionsByService: { 'demo-service': ['2.1.0'] }
    })
    const view = render(<App />)

    await view.findByText('PLATFORM_ADMIN')
    fireEvent.click(view.getByRole('button', { name: 'Deploy' }))
    await view.findAllByText('Default Delivery Group')
    await waitForCondition(() => view.getByLabelText('Recipe').value === 'default')
    await view.findByRole('option', { name: 'Default Deploy' })
    fireEvent.change(view.getByLabelText('Recipe'), { target: { value: 'default' } })
    const changeInput = view.getByLabelText('Change summary')
    changeInput.value = 'release'
    changeInput.dispatchEvent(new window.Event('input', { bubbles: true }))
    changeInput.dispatchEvent(new window.Event('change', { bubbles: true }))
    await view.findByDisplayValue('release')
    const reviewButton = view.getByRole('button', { name: 'Review deploy' })
    await waitForCondition(() => view.queryByText('Deploy disabled. Loading access policy.') === null)
    await view.findByText(/Blocked by policy change/)
    await view.findByText('QUOTA_EXCEEDED: Daily deploy quota exceeded for this delivery group.')
    await waitForCondition(() => reviewButton.disabled)
    assert.equal(reviewButton.disabled, true)
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
    globalThis.fetch = buildFetchMock({
      role: 'PLATFORM_ADMIN',
      deployAllowed: true,
      rollbackAllowed: true,
      deployResponse: { id: 'dep-1', service: 'demo-service', version: '2.1.0', state: 'IN_PROGRESS' },
      versionsByService: { 'demo-service': ['2.1.0'] }
    })
    const view = render(<App />)

    await view.findByText('PLATFORM_ADMIN')
    fireEvent.click(view.getByRole('button', { name: 'Deploy' }))
    await view.findAllByText('Default Delivery Group')
    await waitForCondition(() => view.getByLabelText('Recipe').value === 'default')
    await view.findByRole('option', { name: 'Default Deploy' })
    fireEvent.change(view.getByLabelText('Recipe'), { target: { value: 'default' } })
    const changeInput = view.getByLabelText('Change summary')
    changeInput.value = 'release'
    changeInput.dispatchEvent(new window.Event('input', { bubbles: true }))
    changeInput.dispatchEvent(new window.Event('change', { bubbles: true }))
    await view.findByDisplayValue('release')
    const reviewButton = view.getByRole('button', { name: 'Review deploy' })
    await waitForCondition(() => view.queryByText('Deploy disabled. Loading access policy.') === null)
    await waitForCondition(() => !reviewButton.disabled)
    assert.equal(reviewButton.disabled, false)
    fireEvent.click(reviewButton)
    const confirmButton = view.getByRole('button', { name: 'Confirm deploy' })
    await waitForCondition(() => !confirmButton.disabled)
    fireEvent.click(confirmButton)
    await view.findByText('Deployment detail')
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
    const view = render(<App />)

    await view.findByText('PLATFORM_ADMIN')
    fireEvent.click(view.getByRole('button', { name: 'Deploy' }))
    await view.findAllByText('Default Delivery Group')
    await waitForCondition(() => view.getByLabelText('Recipe').value === 'default')
    const changeInput = view.getByLabelText('Change summary')
    changeInput.value = 'release'
    changeInput.dispatchEvent(new window.Event('input', { bubbles: true }))
    changeInput.dispatchEvent(new window.Event('change', { bubbles: true }))
    await view.findByDisplayValue('release')
    await view.findByText('Selected recipe is deprecated and cannot be used for new deployments.')
    const reviewButton = view.getByRole('button', { name: 'Review deploy' })
    assert.equal(reviewButton.disabled, true)
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
    const view = render(<App />)

    await view.findByText('PLATFORM_ADMIN')
    fireEvent.click(view.getByRole('button', { name: 'Admin' }))
    await view.findByText('Delivery groups')
    fireEvent.click(view.getByRole('button', { name: 'Create group' }))
    const idInput = await view.findByLabelText('Group id')
    fireEvent.input(idInput, { target: { value: 'payments' } })
    await waitForCondition(() => view.getByLabelText('Group id').value === 'payments')
    const nameInput = view.getByLabelText('Name')
    fireEvent.input(nameInput, { target: { value: 'Payments Group' } })
    await waitForCondition(() => view.getByLabelText('Name').value === 'Payments Group')
    const ownerInput = view.getByLabelText('Owner')
    fireEvent.input(ownerInput, { target: { value: 'team-payments' } })
    await waitForCondition(() => view.getByLabelText('Owner').value === 'team-payments')
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
    const view = render(<App />)

    await view.findByText('PLATFORM_ADMIN')
    fireEvent.click(view.getByRole('button', { name: 'Admin' }))
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
    const view = render(<App />)

    await view.findByText('PLATFORM_ADMIN')
    fireEvent.click(view.getByRole('button', { name: 'Admin' }))
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
    const view = render(<App />)

    await view.findByText('PLATFORM_ADMIN')
    fireEvent.click(view.getByRole('button', { name: 'Admin' }))
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
    const view = render(<App />)

    await view.findByText('PLATFORM_ADMIN')
    fireEvent.click(view.getByRole('button', { name: 'Deployments' }))
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
    const view = render(<App />)

    await view.findByText('PLATFORM_ADMIN')
    fireEvent.click(view.getByRole('button', { name: 'Deployments' }))
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
    const view = render(<App />)

    await view.findByText('PLATFORM_ADMIN')
    fireEvent.click(view.getByRole('button', { name: 'Services' }))
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
    const view = render(<App />)

    await view.findByText('PLATFORM_ADMIN')
    fireEvent.click(view.getByRole('button', { name: 'Services' }))
    await view.findByText('demo-service')
    fireEvent.click(view.getByRole('button', { name: /demo-service/ }))
    await view.findByText('Service detail')
    await view.findByText('Version: 2.1.0')
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
    const view = render(<App />)

    await view.findByText('PLATFORM_ADMIN')
    fireEvent.click(view.getByRole('button', { name: 'Services' }))
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
