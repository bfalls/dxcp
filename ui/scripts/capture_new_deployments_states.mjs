import http from 'node:http'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const uiRoot = path.resolve(__dirname, '..')
const distRoot = path.join(uiRoot, 'dist')
const screenshotRoot = path.join(uiRoot, 'artifacts', 'slice-f')
const host = '127.0.0.1'
const port = 4174

const services = [
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
    guardrails: { daily_deploy_quota: 4, daily_rollback_quota: 2, max_concurrent_deployments: 1 }
  },
  {
    id: 'web',
    name: 'Web Experience',
    owner: 'Web Platform',
    services: ['web-frontend'],
    allowed_recipes: ['canary'],
    guardrails: { daily_deploy_quota: 6, daily_rollback_quota: 2, max_concurrent_deployments: 2 }
  }
]

const recipes = [
  {
    id: 'default',
    name: 'Default Deploy',
    effective_behavior_summary: 'Standard roll-forward deploy with rollback support.'
  },
  {
    id: 'canary',
    name: 'Canary Deploy',
    effective_behavior_summary: 'Gradual production exposure before full traffic shift.'
  }
]

const deploymentHistoryByService = {
  'payments-api': [
    {
      id: '9842',
      service: 'payments-api',
      environment: 'sandbox',
      version: 'v1.33.0',
      recipeId: 'default',
      changeSummary: 'Promote the current checkout patch to sandbox.',
      state: 'IN_PROGRESS',
      createdAt: '2025-01-02T16:58:00Z',
      updatedAt: '2025-01-02T17:05:00Z'
    },
    {
      id: '9831',
      service: 'payments-api',
      environment: 'sandbox',
      version: 'v1.32.1',
      recipeId: 'default',
      changeSummary: 'Roll forward the payment retries fix.',
      state: 'SUCCEEDED',
      outcome: 'SUCCEEDED',
      createdAt: '2025-01-02T16:40:00Z',
      updatedAt: '2025-01-02T17:03:00Z'
    },
    {
      id: '9819',
      service: 'payments-api',
      environment: 'production',
      version: 'v1.31.9',
      recipeId: 'default',
      changeSummary: 'Promote the stable payment queue fixes into production.',
      state: 'FAILED',
      outcome: 'FAILED',
      createdAt: '2025-01-02T12:50:00Z',
      updatedAt: '2025-01-02T13:12:00Z'
    }
  ],
  'billing-worker': [
    {
      id: '9807',
      service: 'billing-worker',
      environment: 'sandbox',
      version: 'v4.5.2',
      recipeId: 'default',
      changeSummary: 'Refresh invoice tax mapping in sandbox.',
      state: 'SUCCEEDED',
      outcome: 'SUCCEEDED',
      createdAt: '2025-01-01T18:00:00Z',
      updatedAt: '2025-01-01T18:15:00Z'
    }
  ],
  'web-frontend': [
    {
      id: '9798',
      service: 'web-frontend',
      environment: 'production',
      version: 'v8.4.1',
      recipeId: 'canary',
      changeSummary: 'Advance the homepage experiment bundle.',
      state: 'SUCCEEDED',
      outcome: 'SUCCEEDED',
      createdAt: '2025-01-01T15:00:00Z',
      updatedAt: '2025-01-01T15:25:00Z'
    }
  ]
}

const deploymentDetailsById = {
  '9831': deploymentHistoryByService['payments-api'][1],
  '9819': deploymentHistoryByService['payments-api'][2],
  '9842': {
    ...deploymentHistoryByService['payments-api'][0],
    engineExecutionId: 'exec-9842',
    engineExecutionUrl: 'https://example.invalid/executions/9842'
  }
}

const deploymentTimelineById = {
  '9831': [
    { key: 'submitted', occurredAt: '2025-01-02T16:40:00Z', detail: 'DXCP created the deployment record for sandbox.' },
    { key: 'validated', occurredAt: '2025-01-02T16:42:00Z', detail: 'Readiness checks passed for sandbox deploy.' },
    { key: 'in_progress', occurredAt: '2025-01-02T16:45:00Z', detail: 'Deployment execution started in sandbox.' },
    { key: 'succeeded', occurredAt: '2025-01-02T17:03:00Z', detail: 'Sandbox is now running v1.32.1.' }
  ],
  '9819': [
    { key: 'submitted', occurredAt: '2025-01-02T12:50:00Z', detail: 'DXCP created the deployment record for production.' },
    { key: 'validated', occurredAt: '2025-01-02T12:53:00Z', detail: 'Readiness checks passed for production deploy.' },
    { key: 'in_progress', occurredAt: '2025-01-02T12:57:00Z', detail: 'Production delivery started.' },
    { key: 'failed', occurredAt: '2025-01-02T13:12:00Z', detail: 'DXCP recorded a failed production outcome.' }
  ],
  '9842': [
    { key: 'submitted', occurredAt: '2025-01-02T16:58:00Z', detail: 'DXCP created the deployment record for sandbox.' },
    { key: 'validated', occurredAt: '2025-01-02T17:00:00Z', detail: 'Readiness checks passed for sandbox deploy.' },
    { key: 'in_progress', occurredAt: '2025-01-02T17:05:00Z', detail: 'DXCP is still processing this deployment.' }
  ]
}

const deploymentFailuresById = {
  '9831': [],
  '9819': [
    {
      category: 'INFRA',
      summary: 'Traffic could not shift to the new production workload.',
      detail: 'The production load balancer health checks did not pass in time.',
      actionHint: 'Review the production health checks and confirm platform readiness before deploying again.',
      observedAt: '2025-01-02T13:12:00Z'
    }
  ],
  '9842': []
}

const deliveryStatusByServiceEnvironment = {
  'payments-api:sandbox': {
    currentRunning: {
      deploymentId: '9842',
      version: 'v1.33.0',
      environment: 'sandbox',
      derivedAt: '2025-01-02T17:05:00Z'
    }
  },
  'payments-api:production': {
    currentRunning: {
      deploymentId: '9788',
      version: 'v1.31.8',
      environment: 'production',
      derivedAt: '2025-01-02T13:15:00Z'
    }
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
      return jsonRoute(route, recipes)
    }
    if (pathname === '/v1/deployments') {
      const serviceName = url.searchParams.get('service') || ''
      if (scenarioName === 'browse-degraded' && serviceName === 'billing-worker') {
        return route.abort('failed')
      }
      if (scenarioName === 'browse-empty') {
        return jsonRoute(route, [])
      }
      return jsonRoute(route, deploymentHistoryByService[serviceName] || [])
    }
    if (pathname.startsWith('/v1/deployments/')) {
      const parts = pathname.split('/')
      const deploymentId = parts[3]
      const suffix = parts[4] || ''
      if (!deploymentDetailsById[deploymentId]) {
        return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ code: 'NOT_FOUND', message: 'Not found' }) })
      }
      if (!suffix) {
        return jsonRoute(route, deploymentDetailsById[deploymentId])
      }
      if (suffix === 'timeline') {
        return jsonRoute(route, deploymentTimelineById[deploymentId] || [])
      }
      if (suffix === 'failures') {
        return jsonRoute(route, deploymentFailuresById[deploymentId] || [])
      }
    }
    if (pathname.startsWith('/v1/services/') && pathname.endsWith('/delivery-status')) {
      const serviceName = pathname.split('/')[3]
      const environment = url.searchParams.get('environment') || ''
      return jsonRoute(route, deliveryStatusByServiceEnvironment[`${serviceName}:${environment}`] || {})
    }

    return jsonRoute(route, {})
  })
}

async function capture(browser, routePath, expectedText, screenshotName, viewport, scenarioName) {
  const page = await browser.newPage({ viewport })
  await installAppState(page)
  await installApiRoutes(page, scenarioName)
  await page.goto(`http://${host}:${port}${routePath}`, { waitUntil: 'networkidle' })
  await page.getByText(expectedText).waitFor()
  await page.screenshot({ path: path.join(screenshotRoot, screenshotName), fullPage: true })
  await page.close()
}

const server = await startStaticServer()
const browser = await chromium.launch()

try {
  await mkdir(screenshotRoot, { recursive: true })
  await capture(browser, '/new/deployments', 'Row reading stays primary.', 'deployments-browse-populated.png', { width: 1280, height: 1180 }, 'browse-populated')
  await capture(
    browser,
    '/new/deployments',
    'Deployment history could not be refreshed for billing-worker.',
    'deployments-browse-degraded.png',
    { width: 1280, height: 1180 },
    'browse-degraded'
  )
  await capture(browser, '/new/deployments?service=payments-api&outcome=Succeeded', 'Row reading stays primary.', 'deployments-browse-populated-narrow.png', { width: 390, height: 1400 }, 'browse-populated')
  await capture(browser, '/new/deployments/9831', 'Deployment timeline', 'deployment-detail-success.png', { width: 1280, height: 1500 }, 'browse-populated')
  await capture(
    browser,
    '/new/deployments/9819',
    'Traffic could not shift to the new production workload.',
    'deployment-detail-failed.png',
    { width: 1280, height: 1600 },
    'browse-populated'
  )
  await capture(browser, '/new/deployments/9842', 'Deployment timeline', 'deployment-detail-in-progress.png', { width: 1280, height: 1550 }, 'browse-populated')
} finally {
  await browser.close()
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
}
