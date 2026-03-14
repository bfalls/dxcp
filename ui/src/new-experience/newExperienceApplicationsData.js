const SAFE_ENVIRONMENT_NAME_RE = /(sandbox|dev|test|staging|stage|qa|nonprod|non-prod)/i

function formatApiError(result, fallbackMessage) {
  if (!result || typeof result !== 'object') return fallbackMessage
  if (!result.code && !result.message) return fallbackMessage
  return [result.code, result.message].filter(Boolean).join(': ') || fallbackMessage
}

function normalizeEnvironmentOrder(environment) {
  return Number.isInteger(environment?.promotion_order) && environment.promotion_order > 0
    ? environment.promotion_order
    : Number.MAX_SAFE_INTEGER
}

function pickDefaultEnvironment(environments) {
  if (!Array.isArray(environments) || environments.length === 0) return null
  const ordered = environments
    .slice()
    .sort((left, right) => {
      const orderDiff = normalizeEnvironmentOrder(left) - normalizeEnvironmentOrder(right)
      if (orderDiff !== 0) return orderDiff
      return String(left?.name || '').localeCompare(String(right?.name || ''))
    })
  const safeByName = ordered.find((environment) => SAFE_ENVIRONMENT_NAME_RE.test(environment?.name || ''))
  if (safeByName) return safeByName
  const safeByType = ordered.find((environment) => String(environment?.type || '').toLowerCase() === 'non_prod')
  if (safeByType) return safeByType
  return ordered[0] || null
}

function buildRecentState(statusPayload, environmentLabel, statusAvailable) {
  if (!statusAvailable) {
    return {
      label: 'Status unavailable',
      tone: 'neutral',
      detail:
        'Application access is available, but current state could not be refreshed. Open the application record for the authoritative object route.'
    }
  }

  const latest = statusPayload?.latest || null
  if (!latest) {
    return {
      label: 'No deployments yet',
      tone: 'neutral',
      detail:
        'No deployment record has been returned for this application yet. Open the application record when you need a fuller deployment view.'
    }
  }

  const state = String(latest.state || '').toUpperCase()
  const outcome = String(latest.outcome || '').toUpperCase()
  const currentEnvironment = statusPayload?.environment || environmentLabel || 'the selected environment'

  if (['ACTIVE', 'IN_PROGRESS', 'PENDING', 'RUNNING', 'QUEUED'].includes(state)) {
    return {
      label: 'Active deployment',
      tone: 'warn',
      detail: `A deployment is still progressing in ${currentEnvironment}. Open the application record to inspect the current deployment.`
    }
  }

  if (['FAILED', 'CANCELED', 'ROLLED_BACK'].includes(outcome) || ['FAILED', 'CANCELED', 'ROLLED_BACK'].includes(state)) {
    return {
      label: 'Needs review',
      tone: 'neutral',
      detail:
        'Recent deployment activity needs review before the next change. Open the application record for the authoritative deployment history.'
    }
  }

  return {
    label: 'Stable',
    tone: 'info',
    detail:
      'No active deployment is in progress. Open the application record to review current state and deployment history.'
  }
}

function normalizeApplication(service, group, statusPayload, environmentLabel, statusAvailable) {
  const name = service?.service_name || service?.name || ''
  const recentState = buildRecentState(statusPayload, environmentLabel, statusAvailable)
  return {
    name,
    summary:
      service?.description ||
      service?.summary ||
      'Open the application record to review current state and deployment history.',
    owner: service?.owner || group?.owner || 'Not provided',
    deploymentGroup: group?.name || 'Not assigned',
    environment: environmentLabel || 'Not available',
    recentState: recentState.label,
    recentStateTone: recentState.tone,
    recentStateDetail: recentState.detail
  }
}

function findDeliveryGroup(groups, serviceName) {
  if (!Array.isArray(groups) || !serviceName) return null
  return groups.find((group) => Array.isArray(group?.services) && group.services.includes(serviceName)) || null
}

function normalizeDeploymentTimestamp(deployment) {
  return deployment?.updatedAt || deployment?.createdAt || deployment?.validatedAt || ''
}

function sortDeploymentsNewestFirst(left, right) {
  const leftAt = Date.parse(normalizeDeploymentTimestamp(left) || '')
  const rightAt = Date.parse(normalizeDeploymentTimestamp(right) || '')
  if (Number.isNaN(leftAt) && Number.isNaN(rightAt)) return 0
  if (Number.isNaN(leftAt)) return 1
  if (Number.isNaN(rightAt)) return -1
  return rightAt - leftAt
}

function normalizeStatusLabel(deployment) {
  const state = String(deployment?.state || '').toUpperCase()
  const outcome = String(deployment?.outcome || '').toUpperCase()

  if (['ACTIVE', 'IN_PROGRESS', 'PENDING', 'RUNNING', 'QUEUED'].includes(state)) {
    return { label: 'In progress', tone: 'warn' }
  }
  if (outcome === 'SUCCEEDED' || state === 'SUCCEEDED') {
    return { label: 'Succeeded', tone: 'info' }
  }
  if (outcome === 'FAILED' || state === 'FAILED') {
    return { label: 'Failed', tone: 'danger' }
  }
  if (outcome === 'ROLLED_BACK' || state === 'ROLLED_BACK') {
    return { label: 'Rolled back', tone: 'neutral' }
  }
  if (outcome === 'CANCELED' || state === 'CANCELED') {
    return { label: 'Canceled', tone: 'neutral' }
  }
  return { label: state ? state.replace(/_/g, ' ') : 'Recorded', tone: 'neutral' }
}

function formatDateTime(value) {
  if (!value) return ''
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return String(value)
  return parsed.toLocaleString()
}

function findLatestCompletedDeployment(deployments) {
  return (
    deployments.find((deployment) => {
      const state = String(deployment?.state || '').toUpperCase()
      const outcome = String(deployment?.outcome || '').toUpperCase()
      return !['ACTIVE', 'IN_PROGRESS', 'PENDING', 'RUNNING', 'QUEUED'].includes(state) && (state || outcome)
    }) || null
  )
}

function findActiveDeployment(deployments) {
  return (
    deployments.find((deployment) => {
      const state = String(deployment?.state || '').toUpperCase()
      return ['ACTIVE', 'IN_PROGRESS', 'PENDING', 'RUNNING', 'QUEUED'].includes(state)
    }) || null
  )
}

function summarizeGuardrails(group) {
  const guardrails = group?.guardrails || {}
  const items = []
  if (guardrails.max_concurrent_deployments) {
    items.push(`Max ${guardrails.max_concurrent_deployments} active deployment${guardrails.max_concurrent_deployments === 1 ? '' : 's'} at a time`)
  }
  if (guardrails.daily_deploy_quota) {
    items.push(`${guardrails.daily_deploy_quota} deploy${guardrails.daily_deploy_quota === 1 ? '' : 's'} per day`)
  }
  if (guardrails.daily_rollback_quota) {
    items.push(`${guardrails.daily_rollback_quota} rollback${guardrails.daily_rollback_quota === 1 ? '' : 's'} per day`)
  }
  return items
}

function buildApplicationSummary(service, group, environmentLabel) {
  return {
    name: service?.service_name || service?.name || '',
    summary:
      service?.description ||
      service?.summary ||
      'DXCP exposes this application record so current state, recent deployment state, and next actions stay anchored to the application itself.',
    owner: service?.owner || group?.owner || 'Not provided',
    deploymentGroup: group?.name || 'Not assigned',
    environment: environmentLabel || 'Not available'
  }
}

function buildCurrentRunningSummary(currentRunning, latest, environmentLabel) {
  if (!currentRunning) {
    return {
      kind: 'missing',
      environment: environmentLabel || 'Not available',
      explanation:
        'DXCP did not return authoritative running state for this application in the selected environment. Recent deployment history remains visible below, but current running state cannot be asserted on this route yet.'
    }
  }

  const recordedAt = currentRunning.derivedAt || currentRunning.updatedAt || currentRunning.createdAt || ''
  return {
    kind: 'ready',
    environment: currentRunning.environment || environmentLabel || 'Not available',
    version: currentRunning.version || 'Not recorded',
    deploymentId: currentRunning.deploymentId || '',
    deploymentKind: currentRunning.deploymentKind || '',
    recordedAt,
    recordedLabel: recordedAt ? formatDateTime(recordedAt) : 'Recorded by DXCP',
    note:
      latest?.id && latest.id !== currentRunning.deploymentId && ['ACTIVE', 'IN_PROGRESS', 'PENDING', 'RUNNING', 'QUEUED'].includes(String(latest?.state || '').toUpperCase())
        ? 'A newer deployment is still in progress. Running state remains tied to the last completed DXCP record until that newer deployment finishes.'
        : 'Running state is derived from DXCP deployment records and remains the primary answer to what is currently running.'
  }
}

function buildRecentDeploymentSummary(deployments, currentRunning) {
  if (!Array.isArray(deployments) || deployments.length === 0) {
    return {
      kind: 'empty',
      items: []
    }
  }

  const activeDeployment = findActiveDeployment(deployments)
  const latestCompleted = findLatestCompletedDeployment(deployments)
  const items = []

  if (activeDeployment) {
    const status = normalizeStatusLabel(activeDeployment)
    items.push({
      key: `active-${activeDeployment.id || normalizeDeploymentTimestamp(activeDeployment)}`,
      label: 'Active deployment',
      state: status.label,
      tone: status.tone,
      detail: `${activeDeployment.version || 'Version not recorded'} is still moving through ${activeDeployment.environment || 'the selected environment'}.`,
      timestamp: formatDateTime(normalizeDeploymentTimestamp(activeDeployment)) || 'Recently updated',
      deploymentId: activeDeployment.id || ''
    })
  }

  if (latestCompleted) {
    const status = normalizeStatusLabel(latestCompleted)
    const becameCurrent =
      currentRunning?.deploymentId && latestCompleted.id && currentRunning.deploymentId === latestCompleted.id
        ? 'This deployment currently defines running state.'
        : 'Open the deployment record for fuller outcome detail.'
    items.push({
      key: `completed-${latestCompleted.id || normalizeDeploymentTimestamp(latestCompleted)}`,
      label: 'Recent deployment',
      state: status.label,
      tone: status.tone,
      detail: `${latestCompleted.version || 'Version not recorded'} was the latest finished deployment. ${becameCurrent}`,
      timestamp: formatDateTime(normalizeDeploymentTimestamp(latestCompleted)) || 'Recently updated',
      deploymentId: latestCompleted.id || ''
    })
  }

  const distinctItems = items.filter((item, index, list) => {
    return index === list.findIndex((candidate) => candidate.deploymentId === item.deploymentId && candidate.label === item.label)
  })

  return {
    kind: distinctItems.length > 0 ? 'ready' : 'empty',
    items: distinctItems
  }
}

function buildActionPosture({ role, mutationsDisabled, activeDeployment, group, environment }) {
  if (role === 'OBSERVER') {
    return {
      state: 'read-only',
      note: 'Observers can inspect the application summary, current running state, and recent deployment state here, but deploy remains read-only on this route.'
    }
  }

  if (mutationsDisabled) {
    return {
      state: 'read-only',
      note: 'DXCP is currently in read-only mode. Application state remains available here, but deploy stays read-only until mutations are re-enabled.'
    }
  }

  if (!group?.id) {
    return {
      state: 'blocked',
      note: 'Deploy is blocked because this application does not have resolved Deployment Group context on this route. Open recent deployment detail while policy context is repaired.'
    }
  }

  if (!environment?.name) {
    return {
      state: 'blocked',
      note: 'Deploy is blocked because DXCP could not resolve environment context for this application. Current state remains visible, but deploy handoff requires environment context first.'
    }
  }

  if (activeDeployment?.id) {
    return {
      state: 'blocked',
      note: `Deploy is blocked because Deployment ${activeDeployment.id} is still in progress for ${activeDeployment.environment || environment.name}. Open that deployment to follow the current work before starting another deploy.`
    }
  }

  return {
    state: 'available',
    note: 'Open the deploy workflow to review deploy readiness in application context. The application record stays primary while deploy intent moves into its own route.'
  }
}

function buildApplicationDetailViewModel({
  service,
  group,
  environment,
  statusPayload,
  deployments,
  role,
  mutationsDisabled
}) {
  const environmentLabel = statusPayload?.environment || environment?.display_name || environment?.name || 'Not available'
  const summary = buildApplicationSummary(service, group, environmentLabel)
  const currentRunning = buildCurrentRunningSummary(statusPayload?.currentRunning || null, statusPayload?.latest || null, environmentLabel)
  const sortedDeployments = Array.isArray(deployments) ? deployments.slice().sort(sortDeploymentsNewestFirst) : []
  const activeDeployment = findActiveDeployment(sortedDeployments)
  const recentDeploymentSummary = buildRecentDeploymentSummary(sortedDeployments, statusPayload?.currentRunning || null)
  const actionPosture = buildActionPosture({
    role,
    mutationsDisabled,
    activeDeployment,
    group,
    environment
  })
  const currentVersion = currentRunning.kind === 'ready' ? currentRunning.version : statusPayload?.latest?.version || 'Not recorded'
  const recentState = activeDeployment
    ? 'In progress'
    : recentDeploymentSummary.items[0]?.state || (currentRunning.kind === 'ready' ? 'Current' : 'Unavailable')

  return {
    summary,
    currentRunning,
    recentDeploymentSummary,
    actionPosture,
    guardrails: summarizeGuardrails(group),
    diagnosticsBoundary:
      role === 'PLATFORM_ADMIN'
        ? 'Platform-admin diagnostics remain secondary to the normalized application and deployment records on this route.'
        : 'Engine-adjacent diagnostics stay outside the primary application surface and remain limited to platform-admin disclosure.',
    stateSummaryItems: [
      { label: 'Environment', value: summary.environment },
      { label: 'Current version', value: currentVersion || 'Not recorded' },
      { label: 'Recent state', value: recentState }
    ]
  }
}

export async function loadApplicationsChooserData(api, options = {}) {
  const requestOptions = { ...options }
  let servicesPayload
  try {
    servicesPayload = await api.get('/services', requestOptions)
  } catch (error) {
    return {
      kind: 'failure',
      applications: [],
      degradedReasons: [],
      errorMessage: 'DXCP could not load accessible applications right now. Refresh to try again.'
    }
  }

  if (!Array.isArray(servicesPayload)) {
    return {
      kind: 'failure',
      applications: [],
      degradedReasons: [],
      errorMessage: formatApiError(servicesPayload, 'DXCP could not load accessible applications right now. Refresh to try again.')
    }
  }

  const services = servicesPayload
    .map((service) => ({ ...service, service_name: service?.service_name || service?.name || '' }))
    .filter((service) => service.service_name)

  if (services.length === 0) {
    return {
      kind: 'empty',
      applications: [],
      degradedReasons: [],
      errorMessage: ''
    }
  }

  const degradedReasons = []

  const [groupsResult, environmentsResult] = await Promise.allSettled([
    api.get('/delivery-groups', requestOptions),
    api.get('/environments', requestOptions)
  ])

  const groups =
    groupsResult.status === 'fulfilled' && Array.isArray(groupsResult.value)
      ? groupsResult.value
      : []
  if (groupsResult.status === 'rejected' || (groupsResult.status === 'fulfilled' && !Array.isArray(groupsResult.value))) {
    degradedReasons.push('Deployment group context could not be refreshed.')
  }

  const environments =
    environmentsResult.status === 'fulfilled' && Array.isArray(environmentsResult.value)
      ? environmentsResult.value
      : []
  if (
    environmentsResult.status === 'rejected' ||
    (environmentsResult.status === 'fulfilled' && !Array.isArray(environmentsResult.value))
  ) {
    degradedReasons.push('Environment context could not be refreshed.')
  }

  const defaultEnvironment = pickDefaultEnvironment(environments)
  const environmentLabel = defaultEnvironment?.display_name || defaultEnvironment?.name || 'Not available'

  let statusResults = []
  if (defaultEnvironment?.name) {
    statusResults = await Promise.allSettled(
      services.map((service) =>
        api.get(
          `/services/${encodeURIComponent(service.service_name)}/delivery-status?environment=${encodeURIComponent(defaultEnvironment.name)}`,
          requestOptions
        )
      )
    )
    if (statusResults.some((result) => result.status === 'rejected' || !result.value || result.value.code)) {
      degradedReasons.push('Recent deployment state could not be refreshed for every application.')
    }
  } else {
    degradedReasons.push('No default environment was available for current-state reads.')
  }

  const applications = services
    .map((service, index) => {
      const group = findDeliveryGroup(groups, service.service_name)
      const statusResult = statusResults[index]
      const statusPayload =
        statusResult?.status === 'fulfilled' && statusResult.value && !statusResult.value.code ? statusResult.value : null
      const application = normalizeApplication(
        service,
        group,
        statusPayload,
        statusPayload?.environment || environmentLabel,
        Boolean(statusPayload)
      )
      return application.name ? application : null
    })
    .filter(Boolean)
    .sort((left, right) => left.name.localeCompare(right.name))

  if (applications.length === 0) {
    return {
      kind: 'empty',
      applications: [],
      degradedReasons,
      errorMessage: ''
    }
  }

  return {
    kind: degradedReasons.length > 0 ? 'degraded' : 'ready',
    applications,
    degradedReasons,
    errorMessage: '',
    environmentLabel
  }
}

export async function loadApplicationDetailData(api, applicationName, role, options = {}) {
  const requestOptions = { ...options }
  const [servicesResult, groupsResult, environmentsResult, settingsResult] = await Promise.allSettled([
    api.get('/services', requestOptions),
    api.get('/delivery-groups', requestOptions),
    api.get('/environments', requestOptions),
    api.get('/settings/public', requestOptions)
  ])

  if (servicesResult.status === 'rejected' || !Array.isArray(servicesResult.value)) {
    return {
      kind: 'failure',
      viewModel: null,
      degradedReasons: [],
      errorMessage: 'DXCP could not load this application record right now. Refresh to try again.'
    }
  }

  const services = servicesResult.value
    .map((service) => ({ ...service, service_name: service?.service_name || service?.name || '' }))
    .filter((service) => service.service_name)
  const service = services.find((entry) => entry.service_name === applicationName)

  if (!service) {
    return {
      kind: 'unavailable',
      viewModel: null,
      degradedReasons: [],
      errorMessage: 'This application is not available from the accessible DXCP application set on this route.'
    }
  }

  const degradedReasons = []
  const groups =
    groupsResult.status === 'fulfilled' && Array.isArray(groupsResult.value)
      ? groupsResult.value
      : []
  if (groupsResult.status === 'rejected' || (groupsResult.status === 'fulfilled' && !Array.isArray(groupsResult.value))) {
    degradedReasons.push('Deployment Group context could not be refreshed.')
  }

  const environments =
    environmentsResult.status === 'fulfilled' && Array.isArray(environmentsResult.value)
      ? environmentsResult.value
      : []
  if (
    environmentsResult.status === 'rejected' ||
    (environmentsResult.status === 'fulfilled' && !Array.isArray(environmentsResult.value))
  ) {
    degradedReasons.push('Environment context could not be refreshed.')
  }

  const defaultEnvironment = pickDefaultEnvironment(environments)
  const group = findDeliveryGroup(groups, applicationName)
  const publicSettings =
    settingsResult.status === 'fulfilled' && settingsResult.value && !settingsResult.value.code ? settingsResult.value : {}
  if (settingsResult.status === 'rejected' || (settingsResult.status === 'fulfilled' && settingsResult.value?.code)) {
    degradedReasons.push('Read-only system posture could not be refreshed.')
  }

  let statusPayload = null
  let deployments = []
  if (defaultEnvironment?.name) {
    const [statusResult, deploymentsResult] = await Promise.allSettled([
      api.get(
        `/services/${encodeURIComponent(applicationName)}/delivery-status?environment=${encodeURIComponent(defaultEnvironment.name)}`,
        requestOptions
      ),
      api.get(
        `/deployments?service=${encodeURIComponent(applicationName)}&environment=${encodeURIComponent(defaultEnvironment.name)}`,
        requestOptions
      )
    ])

    if (statusResult.status === 'fulfilled' && statusResult.value && !statusResult.value.code) {
      statusPayload = statusResult.value
    } else {
      degradedReasons.push('Current running state could not be refreshed.')
    }

    if (deploymentsResult.status === 'fulfilled' && Array.isArray(deploymentsResult.value)) {
      deployments = deploymentsResult.value
    } else {
      degradedReasons.push('Recent deployment history could not be refreshed.')
    }
  } else {
    degradedReasons.push('No default environment was available for application state reads.')
  }

  const viewModel = buildApplicationDetailViewModel({
    service,
    group,
    environment: defaultEnvironment,
    statusPayload,
    deployments,
    role,
    mutationsDisabled: publicSettings?.mutations_disabled === true
  })

  return {
    kind: degradedReasons.length > 0 ? 'degraded' : 'ready',
    viewModel,
    degradedReasons,
    errorMessage: ''
  }
}
