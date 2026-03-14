const SAFE_ENVIRONMENT_NAME_RE = /(sandbox|dev|test|staging|stage|qa|nonprod|non-prod)/i
const ACTIVE_DEPLOYMENT_STATES = ['ACTIVE', 'IN_PROGRESS', 'PENDING', 'RUNNING', 'QUEUED']

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

function sortEnvironments(environments) {
  return (Array.isArray(environments) ? environments : []).slice().sort((left, right) => {
    const orderDiff = normalizeEnvironmentOrder(left) - normalizeEnvironmentOrder(right)
    if (orderDiff !== 0) return orderDiff
    const leftType = String(left?.type || '').toLowerCase()
    const rightType = String(right?.type || '').toLowerCase()
    const leftTypeOrder = leftType === 'prod' ? 1 : 0
    const rightTypeOrder = rightType === 'prod' ? 1 : 0
    if (leftTypeOrder !== rightTypeOrder) return leftTypeOrder - rightTypeOrder
    return String(left?.display_name || left?.name || '').localeCompare(String(right?.display_name || right?.name || ''))
  })
}

function pickDefaultEnvironment(environments) {
  if (!Array.isArray(environments) || environments.length === 0) return null
  const ordered = sortEnvironments(environments)
  const safeByName = ordered.find((environment) => SAFE_ENVIRONMENT_NAME_RE.test(environment?.name || ''))
  if (safeByName) return safeByName
  const safeByType = ordered.find((environment) => String(environment?.type || '').toLowerCase() === 'non_prod')
  if (safeByType) return safeByType
  return ordered[0] || null
}

function findDeliveryGroup(groups, serviceName) {
  if (!Array.isArray(groups) || !serviceName) return null
  return groups.find((group) => Array.isArray(group?.services) && group.services.includes(serviceName)) || null
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

function normalizeStrategy(recipe) {
  return {
    id: recipe?.id || '',
    name: recipe?.name || recipe?.id || 'Unnamed strategy',
    summary: recipe?.effective_behavior_summary || recipe?.description || 'No behavior summary is available for this strategy.',
    status: String(recipe?.status || 'active').toLowerCase(),
    revision: recipe?.recipe_revision ?? null
  }
}

function buildAllowedStrategies(group, recipes) {
  const allowedIds = Array.isArray(group?.allowed_recipes) ? group.allowed_recipes : []
  return (Array.isArray(recipes) ? recipes : [])
    .filter((recipe) => allowedIds.includes(recipe?.id))
    .map(normalizeStrategy)
    .sort((left, right) => left.name.localeCompare(right.name))
}

function findActiveDeployment(deployments) {
  return (
    (Array.isArray(deployments) ? deployments : []).find((deployment) =>
      ACTIVE_DEPLOYMENT_STATES.includes(String(deployment?.state || '').toUpperCase())
    ) || null
  )
}

export async function loadDeployBaseData(api, applicationName, options = {}) {
  const requestOptions = { ...options }
  const [servicesResult, groupsResult, environmentsResult, recipesResult, settingsResult, actionsResult, versionsResult] =
    await Promise.allSettled([
      api.get('/services', requestOptions),
      api.get('/delivery-groups', requestOptions),
      api.get('/environments', requestOptions),
      api.get('/recipes', requestOptions),
      api.get('/settings/public', requestOptions),
      api.get(`/services/${encodeURIComponent(applicationName)}/allowed-actions`, requestOptions),
      api.get(`/services/${encodeURIComponent(applicationName)}/versions`, requestOptions)
    ])

  if (servicesResult.status === 'rejected' || !Array.isArray(servicesResult.value)) {
    return {
      kind: 'failure',
      base: null,
      degradedReasons: [],
      errorMessage: 'DXCP could not load this deploy workflow right now. Refresh to try again.'
    }
  }

  const services = servicesResult.value
    .map((service) => ({ ...service, service_name: service?.service_name || service?.name || '' }))
    .filter((service) => service.service_name)
  const service = services.find((entry) => entry.service_name === applicationName)

  if (!service) {
    return {
      kind: 'unavailable',
      base: null,
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

  const recipes =
    recipesResult.status === 'fulfilled' && Array.isArray(recipesResult.value)
      ? recipesResult.value
      : []
  if (recipesResult.status === 'rejected' || (recipesResult.status === 'fulfilled' && !Array.isArray(recipesResult.value))) {
    degradedReasons.push('Deployment Strategy data could not be refreshed.')
  }

  const versions =
    versionsResult.status === 'fulfilled' && Array.isArray(versionsResult.value?.versions)
      ? versionsResult.value.versions
      : []
  if (
    versionsResult.status === 'rejected' ||
    (versionsResult.status === 'fulfilled' && !Array.isArray(versionsResult.value?.versions))
  ) {
    degradedReasons.push('Registered version data could not be refreshed.')
  }

  const publicSettings =
    settingsResult.status === 'fulfilled' && settingsResult.value && !settingsResult.value.code
      ? settingsResult.value
      : {}
  if (settingsResult.status === 'rejected' || (settingsResult.status === 'fulfilled' && settingsResult.value?.code)) {
    degradedReasons.push('Read-only system posture could not be refreshed.')
  }

  const allowedActions =
    actionsResult.status === 'fulfilled' && actionsResult.value && !actionsResult.value.code
      ? actionsResult.value
      : { actions: { view: true, deploy: false, rollback: false } }
  if (actionsResult.status === 'rejected' || (actionsResult.status === 'fulfilled' && actionsResult.value?.code)) {
    degradedReasons.push('Deploy access data could not be refreshed.')
  }

  const deliveryGroup = findDeliveryGroup(groups, applicationName)
  const sortedEnvironments = sortEnvironments(environments)
  const defaultEnvironment = pickDefaultEnvironment(sortedEnvironments)
  const allowedStrategies = buildAllowedStrategies(deliveryGroup, recipes)
  const normalizedVersions = versions
    .map((item) => (typeof item === 'string' ? { version: item } : item))
    .filter((item) => item?.version)
    .map((item) => ({ version: item.version }))

  return {
    kind: degradedReasons.length > 0 ? 'degraded' : 'ready',
    degradedReasons,
    errorMessage: '',
    base: {
      service: {
        name: service.service_name,
        summary:
          service?.description ||
          service?.summary ||
          'Deploy intent stays anchored to the application record rather than a generic engine workflow.'
      },
      deliveryGroup,
      environments: sortedEnvironments.map((environment) => ({
        id: environment?.id || environment?.environment_id || environment?.name || '',
        name: environment?.name || environment?.environment_id || '',
        label: environment?.display_name || environment?.name || environment?.environment_id || '',
        type: environment?.type || '',
        isEnabled: environment?.is_enabled !== false
      })),
      defaultEnvironmentName: defaultEnvironment?.name || defaultEnvironment?.environment_id || '',
      allowedStrategies,
      defaultStrategyId: allowedStrategies.length === 1 ? allowedStrategies[0].id : '',
      versions: normalizedVersions,
      defaultVersion: normalizedVersions.length === 1 ? String(normalizedVersions[0]?.version || '') : '',
      allowedActions,
      mutationsDisabled: publicSettings?.mutations_disabled === true,
      guardrails: summarizeGuardrails(deliveryGroup)
    }
  }
}

export async function loadDeployEnvironmentContext(api, applicationName, environmentName, strategyId, options = {}) {
  if (!applicationName || !environmentName) {
    return {
      kind: 'ready',
      degradedReasons: [],
      errorMessage: '',
      context: {
        activeDeployment: null,
        policySummary: null,
        deliveryStatus: null
      }
    }
  }

  const requestOptions = { ...options }
  const [statusResult, deploymentsResult, policySummaryResult] = await Promise.allSettled([
    api.get(
      `/services/${encodeURIComponent(applicationName)}/delivery-status?environment=${encodeURIComponent(environmentName)}`,
      requestOptions
    ),
    api.get(
      `/deployments?service=${encodeURIComponent(applicationName)}&environment=${encodeURIComponent(environmentName)}`,
      requestOptions
    ),
    api.post('/policy/summary', {
      service: applicationName,
      environment: environmentName,
      recipeId: strategyId || null
    })
  ])

  const degradedReasons = []
  const deliveryStatus =
    statusResult.status === 'fulfilled' && statusResult.value && !statusResult.value.code
      ? statusResult.value
      : null
  if (!deliveryStatus) {
    degradedReasons.push('Current deployment status could not be refreshed for this environment.')
  }

  const deployments =
    deploymentsResult.status === 'fulfilled' && Array.isArray(deploymentsResult.value)
      ? deploymentsResult.value
      : []
  if (deploymentsResult.status === 'rejected' || (deploymentsResult.status === 'fulfilled' && !Array.isArray(deploymentsResult.value))) {
    degradedReasons.push('Recent deployment history could not be refreshed for this environment.')
  }

  const policySummary =
    policySummaryResult.status === 'fulfilled' && policySummaryResult.value && !policySummaryResult.value.code
      ? policySummaryResult.value
      : null
  if (!policySummary) {
    degradedReasons.push('Supporting policy summary could not be refreshed.')
  }

  return {
    kind: degradedReasons.length > 0 ? 'degraded' : 'ready',
    degradedReasons,
    errorMessage: '',
    context: {
      activeDeployment: findActiveDeployment(deployments),
      policySummary,
      deliveryStatus
    }
  }
}

export async function validateDeployIntent(api, payload) {
  if (!payload?.service || !payload?.environment || !payload?.recipeId || !payload?.version || !payload?.changeSummary) {
    return { kind: 'incomplete', result: null, errorMessage: '', diagnostics: null }
  }

  try {
    const result = await api.post('/deployments/validate', payload)
    if (result && result.code) {
      return {
        kind: 'blocked',
        result,
        errorMessage: formatApiError(result, 'DXCP could not validate this deploy intent.'),
        diagnostics: result
      }
    }

    return {
      kind: 'ready',
      result,
      errorMessage: '',
      diagnostics: null
    }
  } catch (error) {
    return {
      kind: 'error',
      result: null,
      errorMessage: 'DXCP could not validate this deploy intent right now.',
      diagnostics: null
    }
  }
}
