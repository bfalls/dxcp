import http from 'node:http'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const uiRoot = path.resolve(__dirname, '..')
const distRoot = path.join(uiRoot, 'dist')
const screenshotRoot = path.join(uiRoot, 'artifacts', 'slice-h')
const host = '127.0.0.1'
const port = 4176

const services = [
  { service_name: 'payments-api', description: 'Checkout and payment authorization workflows.' },
  { service_name: 'billing-worker', description: 'Invoice generation and billing reconciliation.' }
]

const deliveryGroups = [
  {
    id: 'payments',
    name: 'Payments Core',
    owner: 'Payments Platform',
    services: ['payments-api'],
    allowed_recipes: ['default'],
    guardrails: { daily_deploy_quota: 5, daily_rollback_quota: 3, max_concurrent_deployments: 1 }
  }
]

const environments = [
  { id: 'env-payments', name: 'sandbox', display_name: 'Sandbox', type: 'non_prod', delivery_group_id: 'payments', is_enabled: true }
]

const recipes = [
  {
    id: 'default',
    name: 'Default Deploy',
    status: 'active',
    effective_behavior_summary: 'Standard roll-forward deploy with rollback support.'
  }
]

const serviceStatus = {
  service: 'payments-api',
  environment: 'sandbox',
  hasDeployments: true,
  currentRunning: {
    environment: 'sandbox',
    version: 'v1.32.1',
    deploymentId: '9831',
    deploymentKind: 'ROLL_FORWARD',
    derivedAt: '2025-01-03T00:03:00Z'
  },
  latest: {
    id: '9842',
    state: 'IN_PROGRESS',
    version: 'v1.33.0',
    environment: 'sandbox',
    recipeId: 'default',
    changeSummary: 'Promote the latest checkout fix to sandbox.',
    createdAt: '2025-01-03T00:01:00Z'
  }
}

const deployments = [
  {
    id: '9842',
    service: 'payments-api',
    environment: 'sandbox',
    version: 'v1.33.0',
    recipeId: 'default',
    state: 'IN_PROGRESS',
    createdAt: '2025-01-03T00:01:00Z',
    updatedAt: '2025-01-03T00:04:00Z',
    changeSummary: 'Promote the latest checkout fix to sandbox.'
  },
  {
    id: '9831',
    service: 'payments-api',
    environment: 'sandbox',
    version: 'v1.32.1',
    recipeId: 'default',
    state: 'SUCCEEDED',
    outcome: 'SUCCEEDED',
    createdAt: '2025-01-02T18:21:00Z',
    updatedAt: '2025-01-02T18:33:00Z',
    changeSummary: 'Roll forward the current payments patch.'
  }
]

const deploymentTimeline = {
  '9831': [
    { key: 'submitted', occurredAt: '2025-01-02T18:21:00Z', detail: 'DXCP recorded the deployment request.' },
    { key: 'validated', occurredAt: '2025-01-02T18:23:00Z', detail: 'Readiness checks passed for sandbox.' },
    { key: 'succeeded', occurredAt: '2025-01-02T18:33:00Z', detail: 'Sandbox now runs v1.32.1.' }
  ]
}

function contentTypeFor(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8'
  if (filePath.endsWith('.js')) return 'application/javascript; charset=utf-8'
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8'
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8'
  return 'application/octet-stream'
}

async function startStaticServer() {
  const server = http.createServer(async (request, response) => {
    const requestPath = request.url === '/' ? '/index.html' : request.url
    const filePath = path.join(distRoot, requestPath.replace(/\?.*$/, ''))
    try {
      const body = await readFile(filePath)
      response.writeHead(200, { 'Content-Type': contentTypeFor(filePath) })
      response.end(body)
    } catch {
      const body = await readFile(path.join(distRoot, 'index.html'))
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      response.end(body)
    }
  })

  await new Promise((resolve) => server.listen(port, host, resolve))
  return server
}

function buildJwt() {
  const encode = (value) =>
    Buffer.from(JSON.stringify(value))
      .toString('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
  return `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({
    iss: 'https://dxcp.example/',
    aud: 'https://dxcp-api',
    sub: 'user-1',
    'https://dxcp.example/claims/roles': ['dxcp-delivery-owners']
  })}.signature`
}

async function installAppState(page, preference = '') {
  const jwt = buildJwt()
  await page.addInitScript(
    ({ apiBase, accessToken, storedPreference }) => {
      window.__DXCP_AUTH0_CONFIG__ = {
        domain: 'example.us.auth0.com',
        clientId: 'client-id',
        audience: 'https://dxcp-api',
        rolesClaim: 'https://dxcp.example/claims/roles',
        apiBase
      }
      if (storedPreference) {
        window.localStorage.setItem('dxcp.experience_choice.v1', storedPreference)
      } else {
        window.localStorage.removeItem('dxcp.experience_choice.v1')
      }
      window.__DXCP_AUTH0_FACTORY__ = async () => ({
        isAuthenticated: async () => true,
        getUser: async () => ({ email: 'owner@example.com' }),
        getTokenSilently: async () => accessToken,
        loginWithRedirect: async () => {},
        logout: async () => {},
        handleRedirectCallback: async () => {}
      })
      window.__DXCP_AUTH0_RESET__ = true
    },
    { apiBase: `http://${host}:${port}`, accessToken: jwt, storedPreference: preference }
  )
}

function jsonRoute(route, payload, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(payload)
  })
}

async function installApiRoutes(page) {
  await page.route(`http://${host}:${port}/v1/**`, async (route) => {
    const url = new URL(route.request().url())
    const pathname = url.pathname

    if (pathname === '/v1/settings/public') {
      return jsonRoute(route, {
        default_refresh_interval_seconds: 300,
        min_refresh_interval_seconds: 60,
        max_refresh_interval_seconds: 3600,
        mutations_disabled: false
      })
    }
    if (pathname === '/v1/services') {
      return jsonRoute(route, services)
    }
    if (pathname === '/v1/delivery-groups') {
      return jsonRoute(route, deliveryGroups)
    }
    if (pathname === '/v1/environments') {
      return jsonRoute(route, environments)
    }
    if (pathname === '/v1/recipes') {
      return jsonRoute(route, recipes)
    }
    if (pathname === '/v1/settings/admin') {
      return jsonRoute(route, {})
    }
    if (pathname === '/v1/audit/events') {
      return jsonRoute(route, [])
    }
    if (pathname.startsWith('/v1/services/') && pathname.endsWith('/allowed-actions')) {
      return jsonRoute(route, { actions: { deploy: true } })
    }
    if (pathname.startsWith('/v1/services/') && pathname.endsWith('/versions')) {
      return jsonRoute(route, { versions: [{ version: 'v1.33.0' }, { version: 'v1.32.1' }] })
    }
    if (pathname.startsWith('/v1/services/') && pathname.endsWith('/delivery-status')) {
      return jsonRoute(route, serviceStatus)
    }
    if (pathname === '/v1/deployments') {
      const service = url.searchParams.get('service') || ''
      return jsonRoute(route, service === 'payments-api' || !service ? deployments : [])
    }
    if (pathname.startsWith('/v1/deployments/')) {
      const parts = pathname.split('/')
      const deploymentId = parts[3]
      const suffix = parts[4] || ''
      const selected = deployments.find((item) => item.id === deploymentId) || null
      if (!selected) {
        return jsonRoute(route, { code: 'NOT_FOUND', message: 'Not found' }, 404)
      }
      if (!suffix) {
        return jsonRoute(route, selected)
      }
      if (suffix === 'timeline') {
        return jsonRoute(route, deploymentTimeline[deploymentId] || [])
      }
      if (suffix === 'failures') {
        return jsonRoute(route, [])
      }
    }

    return jsonRoute(route, {})
  })
}

async function capture(browser, routePath, waitForText, screenshotName, options = {}) {
  const page = await browser.newPage({ viewport: options.viewport || { width: 1280, height: 1200 } })
  await installAppState(page, options.preference || '')
  await installApiRoutes(page)
  await page.goto(`http://${host}:${port}${routePath}`, { waitUntil: 'networkidle' })
  if (typeof options.prepare === 'function') {
    await options.prepare(page)
  }
  await page.getByText(waitForText).waitFor()
  await page.screenshot({ path: path.join(screenshotRoot, screenshotName), fullPage: true })
  await page.close()
}

const server = await startStaticServer()
const browser = await chromium.launch()

try {
  await mkdir(screenshotRoot, { recursive: true })
  await capture(browser, '/', 'DXCP Control Plane', 'legacy-entry.png')
  await capture(browser, '/', 'New Experience Preview', 'new-entry.png', { preference: 'new' })
  await capture(browser, '/services/payments-api', 'Open New Experience', 'switch-control.png')
  await capture(browser, '/new/applications/payments-api', 'DXCP Control Plane', 'return-to-legacy.png', {
    prepare: async (page) => {
      await page.getByText('New Experience Preview').waitFor()
      await page.getByRole('link', { name: 'Return to Legacy' }).click()
    }
  })
  await capture(browser, '/new/deployments/9831', 'Deployment timeline', 'direct-link-handling.png')
  await capture(browser, '/services/payments-api', 'Open New Experience', 'switch-control-narrow.png', {
    viewport: { width: 390, height: 1400 }
  })
} finally {
  await browser.close()
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
}
