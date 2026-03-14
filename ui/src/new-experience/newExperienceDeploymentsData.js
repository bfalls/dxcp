const ACTIVE_DEPLOYMENT_STATES = ['ACTIVE', 'IN_PROGRESS', 'PENDING', 'RUNNING', 'QUEUED']
const RAW_BACKEND_WORDING_RE = /\b(spinnaker|pipeline|stage|task|job|execution|manifest|orca|clouddriver|bake)\b/i

function formatApiError(result, fallbackMessage) {
  if (!result || typeof result !== 'object') return fallbackMessage
  if (!result.code && !result.message) return fallbackMessage
  return [result.code, result.message].filter(Boolean).join(': ') || fallbackMessage
}

function normalizeTimestamp(deployment) {
  return deployment?.updatedAt || deployment?.createdAt || deployment?.validatedAt || ''
}

function sortNewestFirst(left, right) {
  const leftAt = Date.parse(normalizeTimestamp(left) || '')
  const rightAt = Date.parse(normalizeTimestamp(right) || '')
  if (Number.isNaN(leftAt) && Number.isNaN(rightAt)) return 0
  if (Number.isNaN(leftAt)) return 1
  if (Number.isNaN(rightAt)) return -1
  return rightAt - leftAt
}

function formatDateTime(value) {
  if (!value) return 'Time not recorded'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return String(value)
  return parsed.toLocaleString()
}

function normalizeDeploymentKind(kind, rollbackOf) {
  if (kind) return String(kind).toUpperCase()
  return rollbackOf ? 'ROLLBACK' : 'ROLL_FORWARD'
}

function deploymentKindLabel(kind, rollbackOf) {
  const normalized = normalizeDeploymentKind(kind, rollbackOf)
  if (normalized === 'ROLLBACK') return 'Rollback'
  if (normalized === 'PROMOTE') return 'Promote'
  return 'Roll-forward'
}

function normalizeStatus(deployment) {
  const state = String(deployment?.state || '').toUpperCase()
  const outcome = String(deployment?.outcome || '').toUpperCase()

  if (ACTIVE_DEPLOYMENT_STATES.includes(state)) {
    return {
      label: 'In progress',
      tone: 'warn',
      summary: 'DXCP is still processing this deployment.'
    }
  }
  if (outcome === 'SUCCEEDED' || state === 'SUCCEEDED') {
    return {
      label: 'Succeeded',
      tone: 'info',
      summary: 'DXCP recorded a successful deployment outcome.'
    }
  }
  if (outcome === 'FAILED' || state === 'FAILED') {
    return {
      label: 'Failed',
      tone: 'danger',
      summary: 'DXCP recorded a failed deployment outcome.'
    }
  }
  if (outcome === 'ROLLED_BACK' || state === 'ROLLED_BACK') {
    return {
      label: 'Rolled back',
      tone: 'neutral',
      summary: 'DXCP recorded that this deployment was rolled back.'
    }
  }
  if (outcome === 'CANCELED' || state === 'CANCELED') {
    return {
      label: 'Canceled',
      tone: 'neutral',
      summary: 'DXCP recorded that this deployment was canceled.'
    }
  }
  return {
    label: state ? state.replace(/_/g, ' ') : 'Recorded',
    tone: 'neutral',
    summary: 'DXCP recorded this deployment.'
  }
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
  return 'Failure'
}

function normalizeEvidenceText(value) {
  if (!value) return ''
  return String(value).replace(/\s+/g, ' ').trim()
}

function sentenceCase(value) {
  if (!value) return value
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function normalizePrimaryNarrative(value, fallback) {
  const raw = normalizeEvidenceText(value)
  if (!raw) return fallback
  if (RAW_BACKEND_WORDING_RE.test(raw)) return fallback

  const normalized = raw
    .replace(/\bservice\b/gi, 'application')
    .replace(/\brecipe\b/gi, 'Deployment Strategy')
    .replace(/\bdeliverygroup\b/gi, 'Deployment Group')
    .replace(/\broll[- ]?forward\b/gi, 'deployment')

  return sentenceCase(normalized)
}

function buildRawEvidence(label, value, normalizedValue) {
  const raw = normalizeEvidenceText(value)
  if (!raw) return null
  if (normalizedValue && raw === normalizedValue) return null
  return { label, value: raw }
}

function normalizeTimelineTitle(item) {
  const key = String(item?.key || '').toLowerCase()
  const rawLabel = String(item?.label || '').trim()
  if (key === 'submitted') return 'Deployment requested'
  if (key === 'validated') return 'Readiness confirmed'
  if (key === 'in_progress' || key === 'active') return 'Deployment still in progress'
  if (key === 'succeeded') return 'Deployment completed'
  if (key === 'failed') return 'Deployment did not complete'
  if (key === 'rollback_started') return 'Rollback started'
  if (key === 'rollback_failed') return 'Rollback did not complete'
  if (key === 'rollback_succeeded') return 'Rollback completed'
  if (key === 'canceled') return 'Deployment was canceled'
  if (key === 'rolled_back') return 'Deployment was rolled back'
  return normalizePrimaryNarrative(rawLabel, 'Deployment update')
}

function normalizeTimelineCategory(item) {
  const key = String(item?.key || '').toLowerCase()
  if (key === 'submitted') return 'Submission'
  if (key === 'validated') return 'Readiness'
  if (key === 'in_progress' || key === 'active') return 'Delivery'
  if (key.startsWith('rollback')) return 'Rollback'
  if (key === 'failed') return 'Failure'
  return 'Outcome'
}

function normalizeTimelineTone(item) {
  const key = String(item?.key || '').toLowerCase()
  if (key === 'failed' || key === 'rollback_failed') return 'danger'
  if (key === 'in_progress' || key === 'active') return 'warn'
  if (key === 'succeeded' || key === 'rollback_succeeded' || key === 'rolled_back') return 'info'
  return 'neutral'
}

function normalizeTimelineSummary(item, title) {
  const key = String(item?.key || '').toLowerCase()
  if (key === 'submitted') return 'DXCP recorded the deployment request and handed it to the delivery engine.'
  if (key === 'validated') return 'DXCP confirmed the deployment intent was ready to proceed.'
  if (key === 'in_progress' || key === 'active') return 'DXCP is still tracking this deployment as it moves through the selected plan.'
  if (key === 'succeeded') return 'DXCP recorded that the new version completed successfully in the selected environment.'
  if (key === 'failed') return 'DXCP recorded that this deployment did not complete successfully.'
  if (key === 'rollback_started') return 'DXCP recorded that rollback work started for this deployment.'
  if (key === 'rollback_failed') return 'DXCP recorded that rollback work did not complete successfully.'
  if (key === 'rollback_succeeded' || key === 'rolled_back') {
    return 'DXCP recorded that the previous running version was restored.'
  }
  if (key === 'canceled') return 'DXCP recorded that this deployment was canceled before completion.'
  return normalizePrimaryNarrative(item?.detail, `${title} was recorded for this deployment.`)
}

function buildTimelineEvidence(item, title, summary) {
  return [
    buildRawEvidence('Original event label', item?.label, title),
    buildRawEvidence('Original event detail', item?.detail, summary)
  ].filter(Boolean)
}

function normalizeTimelineItems(items) {
  return (Array.isArray(items) ? items : [])
    .slice()
    .sort((left, right) => {
      const leftAt = Date.parse(String(left?.occurredAt || ''))
      const rightAt = Date.parse(String(right?.occurredAt || ''))
      if (Number.isNaN(leftAt) && Number.isNaN(rightAt)) return 0
      if (Number.isNaN(leftAt)) return 1
      if (Number.isNaN(rightAt)) return -1
      return leftAt - rightAt
    })
    .map((item, index) => {
      const title = normalizeTimelineTitle(item)
      const summary = normalizeTimelineSummary(item, title)
      return {
        id: item?.key || `event-${index}`,
        category: normalizeTimelineCategory(item),
        title,
        tone: normalizeTimelineTone(item),
        summary,
        time: formatDateTime(item?.occurredAt),
        evidence: buildTimelineEvidence(item, title, summary)
      }
    })
}

function findDeliveryGroup(groups, serviceName) {
  if (!Array.isArray(groups) || !serviceName) return null
  return groups.find((group) => Array.isArray(group?.services) && group.services.includes(serviceName)) || null
}

function findRecipe(recipes, recipeId) {
  if (!Array.isArray(recipes) || !recipeId) return null
  return recipes.find((recipe) => recipe?.id === recipeId) || null
}

function normalizeDeploymentRow(deployment, fallbackServiceName) {
  const serviceName = deployment?.service || fallbackServiceName || 'Application not recorded'
  const status = normalizeStatus(deployment)
  return {
    id: deployment?.id || '',
    application: serviceName,
    version: deployment?.version || 'Version not recorded',
    environment: deployment?.environment || 'Environment not recorded',
    kind: deploymentKindLabel(deployment?.deploymentKind, deployment?.rollbackOf),
    status: status.label,
    tone: status.tone,
    time: formatDateTime(normalizeTimestamp(deployment)),
    note: status.summary,
    sortAt: normalizeTimestamp(deployment)
  }
}

function buildCurrentRunningSummary(currentRunning, deploymentId, environmentLabel) {
  if (!currentRunning) {
    return {
      kind: 'missing',
      explanation:
        'DXCP did not return current running context for this environment on this route. The deployment record remains authoritative for what happened here.'
    }
  }

  return {
    kind: 'ready',
    relationship:
      currentRunning.deploymentId && deploymentId && currentRunning.deploymentId === deploymentId
        ? 'This deployment is the running version'
        : 'Running version remains tied to another deployment',
    version: currentRunning.version || 'Version not recorded',
    deploymentId: currentRunning.deploymentId || '',
    environment: currentRunning.environment || environmentLabel || 'Environment not recorded',
    recordedAt: formatDateTime(currentRunning.derivedAt || currentRunning.updatedAt || currentRunning.createdAt)
  }
}

function buildFailureNarrative(failures) {
  if (!Array.isArray(failures) || failures.length === 0) return null
  const primaryFailure = failures[0]
  const category = normalizeFailureCategory(primaryFailure?.category)
  const whatFailedFallbackByCategory = {
    Policy: 'Deployment policy prevented this deployment from continuing.',
    Validation: 'DXCP could not confirm this deployment was valid to continue.',
    Artifact: 'DXCP could not use the selected deployment version.',
    Infrastructure: 'The deployment environment could not complete this deployment.',
    Configuration: 'Configuration for this deployment could not be applied successfully.',
    Application: 'The application could not complete deployment successfully.',
    Timeout: 'The deployment took too long to complete.',
    Rollback: 'Rollback work did not complete successfully.',
    Failure: 'DXCP recorded a deployment failure.'
  }
  const whyFailedFallbackByCategory = {
    Policy: 'A guardrail or policy condition prevented the deployment from continuing.',
    Validation: 'DXCP found a validation issue before the deployment could complete.',
    Artifact: 'The selected version or its source could not be verified for deployment.',
    Infrastructure: 'An environment dependency or platform condition prevented successful completion.',
    Configuration: 'A deployment configuration issue prevented successful completion.',
    Application: 'The application did not reach a successful running state during deployment.',
    Timeout: 'The deployment remained in progress longer than DXCP could allow.',
    Rollback: 'The deployment required rollback work that did not complete cleanly.',
    Failure: 'Additional failure evidence was not returned on this route.'
  }
  const nextStepFallbackByCategory = {
    Policy: 'Review the applicable Deployment Group guardrails before deploying again.',
    Validation: 'Review the deployment plan and correct the validation issue before deploying again.',
    Artifact: 'Confirm the selected version is available and approved before deploying again.',
    Infrastructure: 'Review environment conditions and the deployment record before deploying again.',
    Configuration: 'Review the deployment configuration and try again after it is corrected.',
    Application: 'Review the application change and current running context before deploying again.',
    Timeout: 'Review the deployment record and current running context before retrying.',
    Rollback: 'Review rollback evidence and current running context before attempting another change.',
    Failure: 'Review the deployment record and current running context before deploying again.'
  }

  const whatFailed = normalizePrimaryNarrative(
    primaryFailure?.summary,
    whatFailedFallbackByCategory[category] || whatFailedFallbackByCategory.Failure
  )
  const whyItFailed = normalizePrimaryNarrative(
    primaryFailure?.detail,
    whyFailedFallbackByCategory[category] || whyFailedFallbackByCategory.Failure
  )
  const nextStep = normalizePrimaryNarrative(
    primaryFailure?.actionHint,
    nextStepFallbackByCategory[category] || nextStepFallbackByCategory.Failure
  )
  return {
    category,
    whatFailed,
    whyItFailed,
    nextStep,
    observedAt: formatDateTime(primaryFailure?.observedAt),
    evidence: [
      buildRawEvidence('Original failure summary', primaryFailure?.summary, whatFailed),
      buildRawEvidence('Original failure detail', primaryFailure?.detail, whyItFailed),
      buildRawEvidence('Original next-step hint', primaryFailure?.actionHint, nextStep)
    ].filter(Boolean)
  }
}

function buildSupportingEvidence(failureNarrative, timeline) {
  const entries = []

  if (failureNarrative?.evidence?.length) {
    entries.push({
      id: 'failure',
      title: 'Failure source wording',
      items: failureNarrative.evidence
    })
  }

  ;(Array.isArray(timeline) ? timeline : [])
    .filter((event) => Array.isArray(event.evidence) && event.evidence.length > 0)
    .forEach((event) => {
      entries.push({
        id: event.id,
        title: `${event.title} source wording`,
        items: event.evidence
      })
    })

  return entries
}

function buildPolicyContext(deliveryGroup, recipe, recipes) {
  const guardrails = deliveryGroup?.guardrails || {}
  const allowedStrategies = (Array.isArray(deliveryGroup?.allowed_recipes) ? deliveryGroup.allowed_recipes : [])
    .map((recipeId) => findRecipe(recipes, recipeId)?.name || '')
    .filter(Boolean)
  return {
    deploymentGroup: deliveryGroup?.name || 'Not assigned',
    owner: deliveryGroup?.owner || 'Not provided',
    allowedStrategies: allowedStrategies.length > 0 ? allowedStrategies.join(', ') : 'Not recorded',
    strategyName: recipe?.name || '',
    strategySummary: recipe?.effective_behavior_summary || recipe?.description || '',
    concurrency:
      guardrails.max_concurrent_deployments
        ? `Max ${guardrails.max_concurrent_deployments} active deployment${guardrails.max_concurrent_deployments === 1 ? '' : 's'}`
        : 'Concurrency guardrail not recorded',
    deployQuota:
      guardrails.daily_deploy_quota
        ? `${guardrails.daily_deploy_quota} deploy${guardrails.daily_deploy_quota === 1 ? '' : 's'} per day`
        : 'Deploy quota not recorded',
    rollbackQuota:
      guardrails.daily_rollback_quota
        ? `${guardrails.daily_rollback_quota} rollback${guardrails.daily_rollback_quota === 1 ? '' : 's'} per day`
        : 'Rollback quota not recorded'
  }
}

export async function loadDeploymentsBrowseData(api, options = {}) {
  const requestOptions = { ...options }
  let servicesPayload
  try {
    servicesPayload = await api.get('/services', requestOptions)
  } catch (error) {
    return {
      kind: 'failure',
      rows: [],
      services: [],
      degradedReasons: [],
      errorMessage: 'DXCP could not load deployment history right now. Refresh to try again.'
    }
  }

  if (!Array.isArray(servicesPayload)) {
    return {
      kind: 'failure',
      rows: [],
      services: [],
      degradedReasons: [],
      errorMessage: formatApiError(servicesPayload, 'DXCP could not load deployment history right now. Refresh to try again.')
    }
  }

  const services = servicesPayload
    .map((service) => ({ name: service?.service_name || service?.name || '' }))
    .filter((service) => service.name)
    .sort((left, right) => left.name.localeCompare(right.name))

  if (services.length === 0) {
    return {
      kind: 'empty',
      rows: [],
      services: [],
      degradedReasons: [],
      errorMessage: ''
    }
  }

  const deploymentResults = await Promise.allSettled(
    services.map((service) => api.get(`/deployments?service=${encodeURIComponent(service.name)}`, requestOptions))
  )

  const degradedReasons = []
  const rows = []

  deploymentResults.forEach((result, index) => {
    const serviceName = services[index]?.name || ''
    if (result.status !== 'fulfilled' || !Array.isArray(result.value)) {
      degradedReasons.push(`Deployment history could not be refreshed for ${serviceName}.`)
      return
    }
    result.value
      .slice()
      .sort(sortNewestFirst)
      .forEach((deployment) => {
        rows.push(normalizeDeploymentRow({ ...deployment, service: deployment?.service || serviceName }, serviceName))
      })
  })

  rows.sort((left, right) => {
    const leftAt = Date.parse(String(left.sortAt || ''))
    const rightAt = Date.parse(String(right.sortAt || ''))
    if (Number.isNaN(leftAt) && Number.isNaN(rightAt)) return 0
    if (Number.isNaN(leftAt)) return 1
    if (Number.isNaN(rightAt)) return -1
    return rightAt - leftAt
  })

  return {
    kind: rows.length === 0 ? 'empty' : degradedReasons.length > 0 ? 'degraded' : 'ready',
    rows: rows.map((row) => ({
      id: row.id,
      application: row.application,
      version: row.version,
      environment: row.environment,
      kind: row.kind,
      status: row.status,
      tone: row.tone,
      time: row.time,
      note: row.note
    })),
    services,
    degradedReasons,
    errorMessage: ''
  }
}

export async function loadDeploymentDetailData(api, deploymentId, options = {}) {
  const requestOptions = { ...options }
  let detailPayload

  try {
    detailPayload = await api.get(`/deployments/${encodeURIComponent(deploymentId)}`, requestOptions)
  } catch (error) {
    return {
      kind: 'failure',
      viewModel: null,
      degradedReasons: [],
      errorMessage: 'DXCP could not load this deployment record right now. Refresh to try again.'
    }
  }

  if (!detailPayload || detailPayload.code) {
    return {
      kind: 'unavailable',
      viewModel: null,
      degradedReasons: [],
      errorMessage: formatApiError(detailPayload, 'This deployment is not available on this route.')
    }
  }

  const serviceName = detailPayload?.service || ''
  const environmentName = detailPayload?.environment || ''

  const [servicesResult, groupsResult, recipesResult, timelineResult, failuresResult, deliveryStatusResult] = await Promise.allSettled([
    api.get('/services', requestOptions),
    api.get('/delivery-groups', requestOptions),
    api.get('/recipes', requestOptions),
    api.get(`/deployments/${encodeURIComponent(deploymentId)}/timeline`, requestOptions),
    api.get(`/deployments/${encodeURIComponent(deploymentId)}/failures`, requestOptions),
    serviceName && environmentName
      ? api.get(
          `/services/${encodeURIComponent(serviceName)}/delivery-status?environment=${encodeURIComponent(environmentName)}`,
          requestOptions
        )
      : Promise.resolve(null)
  ])

  const degradedReasons = []
  const services =
    servicesResult.status === 'fulfilled' && Array.isArray(servicesResult.value)
      ? servicesResult.value
      : []
  if (servicesResult.status === 'rejected' || (servicesResult.status === 'fulfilled' && !Array.isArray(servicesResult.value))) {
    degradedReasons.push('Accessible application context could not be refreshed.')
  }

  const groups =
    groupsResult.status === 'fulfilled' && Array.isArray(groupsResult.value)
      ? groupsResult.value
      : []
  if (groupsResult.status === 'rejected' || (groupsResult.status === 'fulfilled' && !Array.isArray(groupsResult.value))) {
    degradedReasons.push('Deployment Group context could not be refreshed.')
  }

  const recipes =
    recipesResult.status === 'fulfilled' && Array.isArray(recipesResult.value)
      ? recipesResult.value
      : []
  if (recipesResult.status === 'rejected' || (recipesResult.status === 'fulfilled' && !Array.isArray(recipesResult.value))) {
    degradedReasons.push('Deployment Strategy context could not be refreshed.')
  }

  const timeline =
    timelineResult.status === 'fulfilled' && Array.isArray(timelineResult.value)
      ? timelineResult.value
      : []
  if (timelineResult.status === 'rejected' || (timelineResult.status === 'fulfilled' && !Array.isArray(timelineResult.value))) {
    degradedReasons.push('Timeline evidence could not be refreshed.')
  }

  const failures =
    failuresResult.status === 'fulfilled' && Array.isArray(failuresResult.value)
      ? failuresResult.value
      : []
  if (failuresResult.status === 'rejected' || (failuresResult.status === 'fulfilled' && !Array.isArray(failuresResult.value))) {
    degradedReasons.push('Failure evidence could not be refreshed.')
  }

  const deliveryStatus =
    deliveryStatusResult.status === 'fulfilled' && deliveryStatusResult.value && !deliveryStatusResult.value?.code
      ? deliveryStatusResult.value
      : null
  if (
    serviceName &&
    environmentName &&
    (deliveryStatusResult.status === 'rejected' ||
      (deliveryStatusResult.status === 'fulfilled' && deliveryStatusResult.value?.code))
  ) {
    degradedReasons.push('Current running context could not be refreshed.')
  }

  if (services.length > 0 && serviceName) {
    const serviceExists = services.some((service) => {
      const candidateName = service?.service_name || service?.name || ''
      return candidateName === serviceName
    })
    if (!serviceExists) {
      return {
        kind: 'unavailable',
        viewModel: null,
        degradedReasons: [],
        errorMessage: 'This deployment is not available from the accessible DXCP application set on this route.'
      }
    }
  }

  const status = normalizeStatus(detailPayload)
  const deliveryGroup = findDeliveryGroup(groups, serviceName)
  const recipe = findRecipe(recipes, detailPayload?.recipeId)
  const timelineItems = normalizeTimelineItems(timeline)
  const failureNarrative = buildFailureNarrative(failures)
  const viewModel = {
    id: detailPayload?.id || deploymentId,
    application: serviceName || 'Application not recorded',
    environment: environmentName || 'Environment not recorded',
    version: detailPayload?.version || 'Version not recorded',
    changeSummary:
      detailPayload?.changeSummary ||
      'DXCP recorded this deployment as a durable deployment record.',
    outcome: status.label,
    outcomeTone: status.tone,
    outcomeSummary: status.summary,
    kind: deploymentKindLabel(detailPayload?.deploymentKind, detailPayload?.rollbackOf),
    createdAt: formatDateTime(detailPayload?.createdAt),
    updatedAt: formatDateTime(detailPayload?.updatedAt),
    strategyName: recipe?.name || '',
    strategySummary: recipe?.effective_behavior_summary || recipe?.description || '',
    policyContext: buildPolicyContext(deliveryGroup, recipe, recipes),
    currentRunning: buildCurrentRunningSummary(
      deliveryStatus?.currentRunning || null,
      detailPayload?.id || deploymentId,
      environmentName
    ),
    timeline: timelineItems,
    failureNarrative,
    supportingEvidence: buildSupportingEvidence(failureNarrative, timelineItems),
    diagnostics: {
      engineExecutionId: detailPayload?.engineExecutionId || '',
      engineExecutionUrl: detailPayload?.engineExecutionUrl || ''
    },
    stateSummaryItems: [
      { label: 'Outcome', value: status.label },
      { label: 'Application', value: serviceName || 'Not recorded' },
      { label: 'Environment', value: environmentName || 'Not recorded' }
    ]
  }

  return {
    kind: degradedReasons.length > 0 ? 'degraded' : 'ready',
    viewModel,
    degradedReasons,
    errorMessage: ''
  }
}
