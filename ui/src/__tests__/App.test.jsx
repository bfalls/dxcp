import { render, cleanup, fireEvent } from '@testing-library/react'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import App from '../App.jsx'
import { createApiClient } from '../apiClient.js'

const ok = (data) =>
  Promise.resolve({
    json: () => Promise.resolve(data)
  })

const buildFetchMock = ({ role, deployAllowed, rollbackAllowed, deployResponse, timeline, failures }) =>
  async (url, options = {}) => {
    const parsed = new URL(url)
    const { pathname } = parsed
    if (pathname === '/v1/deployments' && options.method === 'POST') {
      return ok(deployResponse || { id: 'dep-1', service: 'demo-service', version: '2.1.0', state: 'IN_PROGRESS' })
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
    if (pathname === '/v1/services') {
      return ok([{ service_name: 'demo-service' }])
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
      return ok([{ id: 'default', name: 'Default Deploy' }])
    }
    if (pathname === '/v1/delivery-groups') {
      return ok([
        {
          id: 'default',
          name: 'Default Delivery Group',
          services: ['demo-service'],
          allowed_recipes: ['default'],
          guardrails: { daily_deploy_quota: 5, daily_rollback_quota: 3, max_concurrent_deployments: 1 }
        }
      ])
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
        spinnakerExecutionUrl: 'https://spinnaker.example/executions/dep-1'
      })
    }
    if (pathname === '/v1/deployments/dep-1/failures') {
      return ok(failures || [])
    }
    if (pathname === '/v1/deployments/dep-1/timeline') {
      return ok(timeline || [])
    }
    if (pathname.endsWith('/versions')) {
      return ok({ versions: [] })
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
  await runTest('OBSERVER cannot see Admin nav', async () => {
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
    assert.equal(view.queryByRole('button', { name: 'Admin' }), null)
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
    const deployButton = view.getByRole('button', { name: 'Deploy now' })
    assert.equal(deployButton.disabled, true)
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
      deployResponse: { code: 'RATE_LIMITED', message: 'Daily quota exceeded' }
    })
    const view = render(<App />)

    await view.findByText('PLATFORM_ADMIN')
    await view.findAllByText('Default Delivery Group')
    await waitForCondition(() => view.getByLabelText('Recipe').value === 'default')
    await view.findByRole('option', { name: 'Default Deploy' })
    fireEvent.change(view.getByLabelText('Recipe'), { target: { value: 'default' } })
    const changeInput = view.getByLabelText('Change summary')
    changeInput.value = 'release'
    changeInput.dispatchEvent(new window.Event('input', { bubbles: true }))
    changeInput.dispatchEvent(new window.Event('change', { bubbles: true }))
    await view.findByDisplayValue('release')
    const deployButton = view.getByRole('button', { name: 'Deploy now' })
    await waitForCondition(() => view.queryByText('Deploy disabled. Loading access policy.') === null)
    await waitForCondition(() => !deployButton.disabled)
    assert.equal(deployButton.disabled, false)
    fireEvent.click(deployButton)
    await view.findByText('RATE_LIMITED: Daily deploy quota exceeded for this delivery group.')
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
      deployResponse: { id: 'dep-1', service: 'demo-service', version: '2.1.0', state: 'IN_PROGRESS' }
    })
    const view = render(<App />)

    await view.findByText('PLATFORM_ADMIN')
    await view.findAllByText('Default Delivery Group')
    await waitForCondition(() => view.getByLabelText('Recipe').value === 'default')
    await view.findByRole('option', { name: 'Default Deploy' })
    fireEvent.change(view.getByLabelText('Recipe'), { target: { value: 'default' } })
    const changeInput = view.getByLabelText('Change summary')
    changeInput.value = 'release'
    changeInput.dispatchEvent(new window.Event('input', { bubbles: true }))
    changeInput.dispatchEvent(new window.Event('change', { bubbles: true }))
    await view.findByDisplayValue('release')
    const deployButton = view.getByRole('button', { name: 'Deploy now' })
    await waitForCondition(() => view.queryByText('Deploy disabled. Loading access policy.') === null)
    await waitForCondition(() => !deployButton.disabled)
    assert.equal(deployButton.disabled, false)
    fireEvent.click(deployButton)
    await view.findByText('Deployment detail')
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
    assert.ok(view.getByRole('link', { name: 'Open Spinnaker execution' }))
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
