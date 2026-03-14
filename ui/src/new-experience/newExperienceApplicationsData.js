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
