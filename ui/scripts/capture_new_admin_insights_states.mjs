import http from 'node:http'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const uiRoot = path.resolve(__dirname, '..')
const distRoot = path.join(uiRoot, 'dist')
const screenshotRoot = path.join(uiRoot, 'artifacts', 'slice-g')
const host = '127.0.0.1'
const port = 4175

const services = [
  { service_name: 'payments-service', description: 'Payments application.' },
  { service_name: 'checkout-service', description: 'Checkout orchestration.' }
]

const deliveryGroups = [
  {
    id: 'payments',
    name: 'Payments Core',
    owner: 'team-payments@example.com',
    description: 'Payments guardrails.',
    services: ['payments-service'],
    allowed_recipes: ['bluegreen', 'rolling'],
    guardrails: { daily_deploy_quota: 5, daily_rollback_quota: 3, max_concurrent_deployments: 1 }
  }
]

const recipes = [
  { id: 'bluegreen', name: 'Blue-Green', status: 'active', effective_behavior_summary: 'Blue-green deployment.' },
  { id: 'rolling', name: 'Rolling', status: 'active', effective_behavior_summary: 'Rolling deployment.' }
]

const auditEvents = [
  {
    target_id: 'payments',
    actor_id: 'admin@example.com',
    timestamp: '2025-01-03T10:12:00Z',
    summary: 'Deployment Group guardrails were previously reviewed.'
  }
]

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

function buildJwt(role) {
  const roleClaim =
    role === 'PLATFORM_ADMIN'
      ? ['dxcp-platform-admins']
      : role === 'DELIVERY_OWNER'
        ? ['dxcp-delivery-owners']
        : ['dxcp-observers']
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
    'https://dxcp.example/claims/roles': roleClaim
  })}.signature`
}

async function installAppState(page, role) {
  await page.addInitScript(
    ({ apiBase, jwt, email }) => {
      window.__DXCP_AUTH0_CONFIG__ = {
        domain: 'example.us.auth0.com',
        clientId: 'client-id',
        audience: 'https://dxcp-api',
        rolesClaim: 'https://dxcp.example/claims/roles',
        apiBase
      }
      window.__DXCP_AUTH0_FACTORY__ = async () => ({
        isAuthenticated: async () => true,
        getUser: async () => ({ email }),
        getTokenSilently: async () => jwt,
        loginWithRedirect: async () => {},
        logout: async () => {},
        handleRedirectCallback: async () => {}
      })
      window.__DXCP_AUTH0_RESET__ = true
    },
    {
      apiBase: `http://${host}:${port}`,
      jwt: buildJwt(role),
      email: role === 'PLATFORM_ADMIN' ? 'admin@example.com' : 'owner@example.com'
    }
  )
}

function jsonRoute(route, payload, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(payload)
  })
}

async function installApiRoutes(page, scenario) {
  await page.route(`http://${host}:${port}/v1/**`, async (route) => {
    const url = new URL(route.request().url())
    const pathname = url.pathname

    if (pathname === '/v1/services') {
      return jsonRoute(route, services)
    }
    if (pathname === '/v1/delivery-groups') {
      return jsonRoute(route, deliveryGroups)
    }
    if (pathname === '/v1/recipes') {
      if (scenario === 'insights-failure') {
        return jsonRoute(route, recipes)
      }
      return jsonRoute(route, recipes)
    }
    if (pathname === '/v1/settings/public') {
      return jsonRoute(route, {
        default_refresh_interval_seconds: 300,
        min_refresh_interval_seconds: 60,
        max_refresh_interval_seconds: 3600,
        mutations_disabled: scenario === 'admin-blocked-save'
      })
    }
    if (pathname === '/v1/settings/admin') {
      return jsonRoute(route, {
        default_refresh_interval_seconds: 300,
        min_refresh_interval_seconds: 60,
        max_refresh_interval_seconds: 3600,
        daily_deploy_quota: 25,
        daily_rollback_quota: 10
      })
    }
    if (pathname === '/v1/audit/events') {
      return jsonRoute(route, auditEvents)
    }
    if (pathname === '/v1/admin/guardrails/validate' && route.request().method() === 'POST') {
      return jsonRoute(route, { validation_status: 'OK', messages: [] })
    }
    if (pathname.startsWith('/v1/delivery-groups/') && route.request().method() === 'PUT') {
      const payload = JSON.parse(route.request().postData() || '{}')
      return jsonRoute(route, payload)
    }
    if (pathname === '/v1/insights/failures') {
      if (scenario === 'insights-failure') {
        return route.abort('failed')
      }
      return jsonRoute(route, {
        rollbackRate: 0.25,
        totalDeployments: 4,
        totalRollbacks: 1,
        failuresByCategory: [{ key: 'INFRASTRUCTURE', count: 2 }],
        deploymentsByRecipe: [{ key: 'bluegreen', count: 4 }],
        deploymentsByGroup: [{ key: 'payments', count: 4 }]
      })
    }

    return jsonRoute(route, {})
  })
}

async function captureState({
  browser,
  routePath,
  role,
  scenario,
  waitForText,
  screenshotName,
  viewport,
  prepare
}) {
  const page = await browser.newPage({ viewport })
  await installAppState(page, role)
  await installApiRoutes(page, scenario)
  await page.goto(`http://${host}:${port}${routePath}`, { waitUntil: 'networkidle' })
  if (prepare) {
    await prepare(page)
  }
  await page.getByText(waitForText).waitFor()
  await page.screenshot({ path: path.join(screenshotRoot, screenshotName), fullPage: true })
  await page.close()
}

const server = await startStaticServer()
const browser = await chromium.launch()

try {
  await mkdir(screenshotRoot, { recursive: true })

  await captureState({
    browser,
    routePath: '/new/admin',
    role: 'PLATFORM_ADMIN',
    scenario: 'admin-normal',
    waitForText: 'Governance object',
    screenshotName: 'admin-normal.png',
    viewport: { width: 1280, height: 1400 }
  })

  await captureState({
    browser,
    routePath: '/new/admin',
    role: 'PLATFORM_ADMIN',
    scenario: 'admin-normal',
    waitForText: 'Governance object',
    screenshotName: 'admin-normal-narrow.png',
    viewport: { width: 390, height: 1600 }
  })

  await captureState({
    browser,
    routePath: '/new/admin',
    role: 'PLATFORM_ADMIN',
    scenario: 'admin-blocked-save',
    waitForText: 'Blocked save explanation',
    screenshotName: 'admin-blocked-save.png',
    viewport: { width: 1280, height: 1500 },
    prepare: async (page) => {
      await page.getByText('Deployment Group: Payments Core').waitFor()
      await page.getByRole('button', { name: 'Edit' }).click()
      await page.getByRole('checkbox', { name: 'Rolling' }).click()
      await page.getByRole('button', { name: 'Review changes' }).click()
    }
  })

  await captureState({
    browser,
    routePath: '/new/insights?service=payments-service',
    role: 'DELIVERY_OWNER',
    scenario: 'insights-populated',
    waitForText: 'Rollback share is elevated enough to inspect',
    screenshotName: 'insights-populated.png',
    viewport: { width: 1280, height: 1400 }
  })

  await captureState({
    browser,
    routePath: '/new/insights?service=payments-service',
    role: 'DELIVERY_OWNER',
    scenario: 'insights-populated',
    waitForText: 'Rollback share is elevated enough to inspect',
    screenshotName: 'insights-populated-narrow.png',
    viewport: { width: 390, height: 1600 }
  })

  await captureState({
    browser,
    routePath: '/new/insights',
    role: 'DELIVERY_OWNER',
    scenario: 'insights-failure',
    waitForText: 'Aggregate delivery reading is unavailable right now',
    screenshotName: 'insights-failure.png',
    viewport: { width: 1280, height: 1300 }
  })
} finally {
  await browser.close()
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
}
