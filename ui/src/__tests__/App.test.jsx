import { render, cleanup } from '@testing-library/react'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import App from '../App.jsx'
import { createApiClient } from '../apiClient.js'

const ok = (data) =>
  Promise.resolve({
    json: () => Promise.resolve(data)
  })

const buildFetchMock = ({ role, deployAllowed, rollbackAllowed }) =>
  async (url) => {
    const { pathname } = new URL(url)
    if (pathname === '/v1/services') {
      return ok([{ service_name: 'demo-service' }])
    }
    if (pathname === '/v1/recipes') {
      return ok([{ id: 'default', name: 'Default Deploy' }])
    }
    if (pathname === '/v1/delivery-groups') {
      return ok([{ id: 'default', name: 'Default Delivery Group', services: ['demo-service'] }])
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

async function withDom(fn) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' })
  Object.defineProperty(globalThis, 'window', { value: dom.window, configurable: true })
  Object.defineProperty(globalThis, 'document', { value: dom.window.document, configurable: true })
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
  Object.defineProperty(globalThis, 'HTMLElement', { value: dom.window.HTMLElement, configurable: true })
  Object.defineProperty(globalThis, 'getComputedStyle', { value: dom.window.getComputedStyle, configurable: true })
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
    await fn()
  } finally {
    cleanup()
    dom.window.close()
    delete globalThis.window.__DXCP_AUTH0_FACTORY__
    delete globalThis.window.__DXCP_AUTH0_CONFIG__
    delete globalThis.window
    delete globalThis.document
    delete globalThis.navigator
    delete globalThis.HTMLElement
    delete globalThis.getComputedStyle
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
    assert.ok(view.getByRole('button', { name: 'Admin' }))
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
