import http from 'node:http'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const uiRoot = path.resolve(__dirname, '..')
const distRoot = path.join(uiRoot, 'dist')
const screenshotRoot = path.join(uiRoot, 'artifacts', 'slice-c')
const host = '127.0.0.1'
const port = 4173

const servicesList = [
  { service_name: 'payments-api', description: 'Checkout and payment authorization workflows.' },
  { service_name: 'billing-worker', description: 'Invoice generation and billing reconciliation.' },
  { service_name: 'web-frontend', description: 'Customer-facing web experience and edge routing updates.' }
]

const deliveryGroups = [
  {
    id: 'payments',
    name: 'Payments Core',
    owner: 'Payments Platform',
    services: ['payments-api'],
    allowed_recipes: ['default'],
    guardrails: { daily_deploy_quota: 5, daily_rollback_quota: 3, max_concurrent_deployments: 1 }
  },
  {
    id: 'billing',
    name: 'Billing Core',
    owner: 'Finance Platform',
    services: ['billing-worker'],
    allowed_recipes: ['default'],
    guardrails: { daily_deploy_quota: 5, daily_rollback_quota: 3, max_concurrent_deployments: 1 }
  },
  {
    id: 'web',
    name: 'Web Experience',
    owner: 'Web Platform',
    services: ['web-frontend'],
    allowed_recipes: ['default'],
    guardrails: { daily_deploy_quota: 5, daily_rollback_quota: 3, max_concurrent_deployments: 1 }
  }
]

const serviceStatuses = {
  'payments-api': {
    service: 'payments-api',
    environment: 'sandbox',
    hasDeployments: true,
    latest: {
      id: 'dep-payments',
      state: 'IN_PROGRESS',
      version: '1.33.0',
      createdAt: '2025-01-03T00:00:00Z',
      updatedAt: '2025-01-03T00:05:00Z'
    }
  },
  'billing-worker': {
    service: 'billing-worker',
    environment: 'sandbox',
    hasDeployments: true,
    latest: {
      id: 'dep-billing',
      state: 'SUCCEEDED',
      outcome: 'SUCCEEDED',
      version: '4.2.0',
      createdAt: '2025-01-02T00:00:00Z',
      updatedAt: '2025-01-02T00:05:00Z'
    }
  },
  'web-frontend': {
    service: 'web-frontend',
    environment: 'sandbox',
    hasDeployments: true,
    latest: {
      id: 'dep-web',
      state: 'FAILED',
      outcome: 'FAILED',
      version: '8.4.1',
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-01T00:05:00Z'
    }
  }
}

const scenarioConfigs = {
  populated: {
    services: servicesList,
    groups: deliveryGroups,
    environments: [
      { id: 'sandbox', name: 'sandbox', display_name: 'Sandbox', type: 'non_prod', promotion_order: 1 },
      { id: 'production', name: 'production', display_name: 'Production', type: 'prod', promotion_order: 2 }
    ],
    statuses: serviceStatuses
  },
  empty: {
    services: [],
    groups: deliveryGroups,
    environments: [
      { id: 'sandbox', name: 'sandbox', display_name: 'Sandbox', type: 'non_prod', promotion_order: 1 }
    ],
    statuses: {}
  },
  degraded: {
    services: servicesList,
    failGroups: true,
    environments: [
      { id: 'sandbox', name: 'sandbox', display_name: 'Sandbox', type: 'non_prod', promotion_order: 1 }
    ],
    statuses: serviceStatuses,
    failStatuses: ['web-frontend']
  },
  failure: {
    failServices: true
  }
}

function contentTypeFor(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8'
  if (filePath.endsWith('.js')) return 'application/javascript; charset=utf-8'
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8'
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8'
  if (filePath.endsWith('.svg')) return 'image/svg+xml'
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
      try {
        const body = await readFile(path.join(distRoot, 'index.html'))
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        response.end(body)
      } catch (error) {
        response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
        response.end(String(error))
      }
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

async function installAppState(page) {
  const token = buildJwt()
  await page.addInitScript(
    ({ apiBase, jwt }) => {
      window.__DXCP_AUTH0_CONFIG__ = {
        domain: 'example.us.auth0.com',
        clientId: 'client-id',
        audience: 'https://dxcp-api',
        rolesClaim: 'https://dxcp.example/claims/roles',
        apiBase
      }
      window.__DXCP_AUTH0_FACTORY__ = async () => ({
        isAuthenticated: async () => true,
        getUser: async () => ({ email: 'owner@example.com' }),
        getTokenSilently: async () => jwt,
        loginWithRedirect: async () => {},
        logout: async () => {},
        handleRedirectCallback: async () => {}
      })
      window.__DXCP_AUTH0_RESET__ = true
    },
    { apiBase: `http://${host}:${port}`, jwt: token }
  )
}

function jsonRoute(route, payload) {
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(payload)
  })
}

async function installApiRoutes(page, scenarioName) {
  const config = scenarioConfigs[scenarioName]
  await page.route(`http://${host}:${port}/v1/**`, async (route) => {
    const url = new URL(route.request().url())
    const pathname = url.pathname
    if (pathname === '/v1/services') {
      if (config.failServices) {
        return route.abort('failed')
      }
      return jsonRoute(route, config.services || [])
    }
    if (pathname === '/v1/delivery-groups') {
      if (config.failGroups) {
        return route.abort('failed')
      }
      return jsonRoute(route, config.groups || [])
    }
    if (pathname === '/v1/environments') {
      if (config.failEnvironments) {
        return route.abort('failed')
      }
      return jsonRoute(route, config.environments || [])
    }
    if (pathname.startsWith('/v1/services/') && pathname.endsWith('/delivery-status')) {
      const serviceName = pathname.split('/')[3]
      if (Array.isArray(config.failStatuses) && config.failStatuses.includes(serviceName)) {
        return route.abort('failed')
      }
      return jsonRoute(route, config.statuses?.[serviceName] || { service: serviceName, environment: 'sandbox', latest: null })
    }
    return jsonRoute(route, {})
  })
}

async function captureScenario(browser, scenarioName, screenshotName, viewport) {
  const page = await browser.newPage({ viewport })
  await installAppState(page)
  await installApiRoutes(page, scenarioName)
  await page.goto(`http://${host}:${port}/new/applications`, { waitUntil: 'networkidle' })
  if (scenarioName === 'failure') {
    await page.getByText('Accessible applications could not be loaded').waitFor()
  } else if (scenarioName === 'empty') {
    await page.getByText('No accessible applications are available').waitFor()
  } else {
    await page.getByText('Application selection').waitFor()
  }
  await page.screenshot({ path: path.join(screenshotRoot, screenshotName), fullPage: true })
  await page.close()
}

const server = await startStaticServer()
const browser = await chromium.launch()

try {
  await mkdir(screenshotRoot, { recursive: true })
  await captureScenario(browser, 'populated', 'new-applications-populated.png', { width: 1280, height: 1180 })
  await captureScenario(browser, 'populated', 'new-applications-populated-narrow.png', { width: 390, height: 1400 })
  await captureScenario(browser, 'empty', 'new-applications-empty.png', { width: 1280, height: 1180 })
  await captureScenario(browser, 'degraded', 'new-applications-degraded.png', { width: 1280, height: 1180 })
  await captureScenario(browser, 'failure', 'new-applications-failure.png', { width: 1280, height: 1180 })
} finally {
  await browser.close()
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
}
