function formatApiError(result, fallbackMessage) {
  if (!result || typeof result !== 'object') return fallbackMessage
  if (!result.code && !result.message) return fallbackMessage
  return [result.code, result.message].filter(Boolean).join(': ') || fallbackMessage
}

function normalizeFailureCategory(value) {
  const raw = String(value || '').trim().toUpperCase()
  if (raw === 'INFRA' || raw === 'INFRASTRUCTURE') return 'Infrastructure'
  if (raw === 'CONFIG') return 'Configuration'
  if (raw === 'APP') return 'Application'
  if (raw === 'POLICY') return 'Policy'
  if (raw === 'VALIDATION') return 'Validation'
  if (raw === 'ARTIFACT') return 'Artifact'
  if (raw === 'TIMEOUT') return 'Timeout'
  if (raw === 'ROLLBACK') return 'Rollback'
  return raw ? raw.replace(/_/g, ' ').toLowerCase().replace(/(^|\s)\S/g, (part) => part.toUpperCase()) : 'Failure'
}

function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return 'Not recorded'
  return `${(Number(value) * 100).toFixed(1)}%`
}

function normalizeScopeOptions(items, getName) {
  if (!Array.isArray(items)) return []
  return items
    .map((item) => ({ value: getName(item), label: getName(item) }))
    .filter((item) => item.value)
    .sort((left, right) => left.label.localeCompare(right.label))
}

function buildQuery(windowDays, groupId, service) {
  const params = new URLSearchParams()
  params.set('windowDays', String(windowDays))
  if (groupId) params.set('groupId', groupId)
  if (service) params.set('service', service)
  return params.toString()
}

function buildSummary(payload) {
  const totalDeployments = Number.isFinite(Number(payload?.totalDeployments))
    ? Number(payload.totalDeployments)
    : Array.isArray(payload?.deploymentsByRecipe)
      ? payload.deploymentsByRecipe.reduce((sum, item) => sum + Number(item?.count || 0), 0)
      : 0
  const totalRollbacks = Number.isFinite(Number(payload?.totalRollbacks)) ? Number(payload.totalRollbacks) : null
  const totalFailures = Array.isArray(payload?.failuresByCategory)
    ? payload.failuresByCategory.reduce((sum, item) => sum + Number(item?.count || 0), 0)
    : 0
  const rollbackRate = payload?.rollbackRate

  return [
    {
      label: 'Deployments',
      value: `${totalDeployments}`,
      note:
        totalDeployments > 0
          ? 'Visible aggregate deployment activity in the selected scope.'
          : 'No deployments were recorded in the selected scope.'
    },
    {
      label: 'Failures',
      value: `${totalFailures}`,
      note:
        totalFailures > 0
          ? 'Failures remain visible as normalized aggregate delivery signals.'
          : 'No failed deployments were recorded in the selected scope.'
    },
    {
      label: totalRollbacks !== null ? 'Rollbacks' : 'Rollback rate',
      value: totalRollbacks !== null ? `${totalRollbacks}` : formatPercent(rollbackRate),
      note:
        rollbackRate !== null && rollbackRate !== undefined
          ? `Rollback share in the selected scope is ${formatPercent(rollbackRate)}.`
          : 'Rollback share is not available in this aggregate read.'
    }
  ]
}

function normalizeBreakdownRows(items, mapLabel) {
  return (Array.isArray(items) ? items : [])
    .map((item) => ({
      label: mapLabel(item?.key),
      value: Number(item?.count || 0)
    }))
    .filter((item) => item.label)
    .sort((left, right) => {
      if (right.value !== left.value) return right.value - left.value
      return left.label.localeCompare(right.label)
    })
}

function buildAttentionItems(payload, groupNames) {
  const items = []
  const rollbackRate = Number(payload?.rollbackRate || 0)
  if (rollbackRate > 0) {
    items.push({
      title: 'Rollback share is elevated enough to inspect',
      detail: `Rollback rate for the selected scope is ${formatPercent(rollbackRate)}. Open Deployments for the authoritative deployment records behind this aggregate.`,
      to: '/new/deployments'
    })
  }

  const failuresByCategory = normalizeBreakdownRows(payload?.failuresByCategory, normalizeFailureCategory)
  if (failuresByCategory.length > 0) {
    const topCategory = failuresByCategory[0]
    items.push({
      title: `${topCategory.label} failures are the current leading category`,
      detail: `${topCategory.value} deployment${topCategory.value === 1 ? '' : 's'} in the selected scope are currently grouped under ${topCategory.label.toLowerCase()}.`,
      to: '/new/deployments'
    })
  }

  const groups = normalizeBreakdownRows(payload?.deploymentsByGroup, (value) => groupNames.get(value) || value || '')
  if (groups.length > 0) {
    const topGroup = groups[0]
    items.push({
      title: `${topGroup.label} carries the highest visible deployment volume`,
      detail: `This aggregate is concentrated in ${topGroup.label}. Open Deployments or Applications for the next object-level read.`,
      to: '/new/deployments'
    })
  }

  return items
}

function buildBreakdowns(payload, recipesById, groupNames) {
  const failures = normalizeBreakdownRows(payload?.failuresByCategory, normalizeFailureCategory)
  const byStrategy = normalizeBreakdownRows(payload?.deploymentsByRecipe, (value) => recipesById.get(value) || value || '')
  const byGroup = normalizeBreakdownRows(payload?.deploymentsByGroup, (value) => groupNames.get(value) || value || '')

  return [
    {
      title: 'Failures by category',
      intro: 'Normalized failure categories stay visible as aggregate delivery reading rather than raw engine evidence.',
      rows: failures
    },
    {
      title: 'Deployments by Deployment Strategy',
      intro: 'Deployment Strategy distribution remains descriptive and subordinate to object-level investigation.',
      rows: byStrategy
    },
    {
      title: 'Deployments by Deployment Group',
      intro: 'Deployment Group aggregates stay compact so Insights remains a restrained orientation surface.',
      rows: byGroup
    }
  ].filter((section) => section.rows.length > 0)
}

function buildEmptyState() {
  return {
    title: 'No deployments in this time range',
    body:
      'Insights keeps the same page structure when the selected scope has no delivery activity. Try a broader time window or clear scope filters before switching into a different object route.'
  }
}

export async function loadInsightsData(api, filters, options = {}) {
  const requestOptions = { ...options }
  const query = buildQuery(filters.windowDays, filters.groupId, filters.service)

  const [insightsResult, servicesResult, groupsResult, recipesResult] = await Promise.allSettled([
    api.get(`/insights/failures?${query}`, requestOptions),
    api.get('/services', requestOptions),
    api.get('/delivery-groups', requestOptions),
    api.get('/recipes', requestOptions)
  ])

  if (insightsResult.status === 'rejected') {
    return {
      kind: 'failure',
      errorMessage: 'DXCP could not refresh the selected Insights scope. Refresh to try again.',
      viewModel: null
    }
  }

  const insightsPayload = insightsResult.value
  if (!insightsPayload || insightsPayload.code) {
    return {
      kind: 'failure',
      errorMessage: formatApiError(
        insightsPayload,
        'DXCP could not refresh the selected Insights scope. Refresh to try again.'
      ),
      viewModel: null
    }
  }

  const degradedReasons = []
  const services =
    servicesResult.status === 'fulfilled' && Array.isArray(servicesResult.value)
      ? servicesResult.value
      : []
  if (servicesResult.status === 'rejected' || (servicesResult.status === 'fulfilled' && !Array.isArray(servicesResult.value))) {
    degradedReasons.push('Application scope options could not be refreshed.')
  }

  const groups =
    groupsResult.status === 'fulfilled' && Array.isArray(groupsResult.value)
      ? groupsResult.value
      : []
  if (groupsResult.status === 'rejected' || (groupsResult.status === 'fulfilled' && !Array.isArray(groupsResult.value))) {
    degradedReasons.push('Deployment Group scope options could not be refreshed.')
  }

  const recipes =
    recipesResult.status === 'fulfilled' && Array.isArray(recipesResult.value)
      ? recipesResult.value
      : []
  if (recipesResult.status === 'rejected' || (recipesResult.status === 'fulfilled' && !Array.isArray(recipesResult.value))) {
    degradedReasons.push('Deployment Strategy labels could not be refreshed.')
  }

  const groupNames = new Map(groups.map((group) => [group?.id || '', group?.name || group?.id || '']))
  const recipesById = new Map(recipes.map((recipe) => [recipe?.id || '', recipe?.name || recipe?.id || '']))
  const breakdowns = buildBreakdowns(insightsPayload, recipesById, groupNames)
  const summary = buildSummary(insightsPayload)
  const totalDeployments = Number(summary[0]?.value || 0)
  const isEmpty =
    totalDeployments === 0 &&
    breakdowns.length === 0 &&
    Number(summary[1]?.value || 0) === 0

  if (!Array.isArray(insightsPayload?.failuresByCategory)) {
    degradedReasons.push('Failure category breakdown could not be refreshed.')
  }
  if (!Array.isArray(insightsPayload?.deploymentsByRecipe)) {
    degradedReasons.push('Deployment Strategy breakdown could not be refreshed.')
  }
  if (!Array.isArray(insightsPayload?.deploymentsByGroup)) {
    degradedReasons.push('Deployment Group breakdown could not be refreshed.')
  }

  return {
    kind: isEmpty ? 'empty' : degradedReasons.length > 0 ? 'degraded' : 'ready',
    errorMessage: '',
    viewModel: {
      filters: {
        serviceOptions: normalizeScopeOptions(services, (item) => item?.service_name || item?.name || ''),
        groupOptions: normalizeScopeOptions(groups, (item) => item?.id || ''),
        groupLabels: new Map(groups.map((group) => [group?.id || '', group?.name || group?.id || '']))
      },
      summary,
      breakdowns,
      attentionItems: buildAttentionItems(insightsPayload, groupNames),
      degradedReasons,
      emptyState: isEmpty ? buildEmptyState() : null
    }
  }
}
