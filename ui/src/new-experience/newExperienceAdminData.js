function formatApiError(result, fallbackMessage) {
  if (!result || typeof result !== 'object') return fallbackMessage
  if (!result.code && !result.message) return fallbackMessage
  return [result.code, result.message].filter(Boolean).join(': ') || fallbackMessage
}

function parseGuardrailValue(value, fallbackValue = null) {
  if (value === null || value === undefined || value === '') return fallbackValue
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallbackValue
}

function normalizeGroup(group, defaults, environmentNamesById = new Map()) {
  const guardrails = group?.guardrails || {}
  return {
    id: group?.id || '',
    name: group?.name || '',
    owner: group?.owner || '',
    description: group?.description || '',
    services: Array.isArray(group?.services) ? group.services.slice().sort() : [],
    allowedRecipes: Array.isArray(group?.allowed_recipes) ? group.allowed_recipes.slice().sort() : [],
    allowedEnvironments: Array.isArray(group?.allowed_environments)
      ? group.allowed_environments.map((environmentId) => environmentNamesById.get(environmentId) || environmentId)
      : [],
    guardrails: {
      maxConcurrentDeployments: parseGuardrailValue(
        guardrails.max_concurrent_deployments,
        parseGuardrailValue(group?.max_concurrent_deployments, 1)
      ),
      dailyDeployQuota: parseGuardrailValue(
        guardrails.daily_deploy_quota,
        parseGuardrailValue(group?.daily_deploy_quota, defaults.dailyDeployQuota)
      ),
      dailyRollbackQuota: parseGuardrailValue(
        guardrails.daily_rollback_quota,
        parseGuardrailValue(group?.daily_rollback_quota, defaults.dailyRollbackQuota)
      )
    },
    createdAt: group?.created_at || '',
    createdBy: group?.created_by || '',
    updatedAt: group?.updated_at || '',
    updatedBy: group?.updated_by || '',
    lastChangeReason: group?.last_change_reason || ''
  }
}

function normalizeRecipe(recipe) {
  return {
    id: recipe?.id || '',
    name: recipe?.name || recipe?.id || 'Deployment Strategy',
    status: String(recipe?.status || 'active').toLowerCase(),
    description: recipe?.description || '',
    summary: recipe?.effective_behavior_summary || recipe?.description || '',
    engineType: recipe?.engine_type || 'SPINNAKER',
    spinnakerApplication: recipe?.spinnaker_application || '',
    deployPipeline: recipe?.deploy_pipeline || '',
    rollbackPipeline: recipe?.rollback_pipeline || '',
    recipeRevision: Number.isFinite(Number(recipe?.recipe_revision)) ? Number(recipe.recipe_revision) : 1,
    createdAt: recipe?.created_at || '',
    createdBy: recipe?.created_by || '',
    updatedAt: recipe?.updated_at || '',
    updatedBy: recipe?.updated_by || '',
    lastChangeReason: recipe?.last_change_reason || ''
  }
}

function normalizeEngineAdapter(adapter) {
  const config = adapter?.config || {}
  const engineOptions = Array.isArray(adapter?.engine_options)
    ? adapter.engine_options.map((option) => ({
        id: option?.id || '',
        label: option?.label || option?.id || '',
        availability: option?.availability || 'planned'
      }))
    : []
  return {
    adapterId: adapter?.adapter_id || 'main',
    label: adapter?.label || 'Primary deployment engine',
    engineType: adapter?.engine_type || 'SPINNAKER',
    engineOptions,
    source: adapter?.source || 'runtime',
    config: {
      mode: config?.mode || 'http',
      gateUrl: config?.gate_url || '',
      gateHeaderName: config?.gate_header_name || '',
      gateHeaderValueConfigured: config?.gate_header_value_configured === true,
      auth0Domain: config?.auth0_domain || '',
      auth0ClientId: config?.auth0_client_id || '',
      auth0ClientSecretConfigured: config?.auth0_client_secret_configured === true,
      auth0Audience: config?.auth0_audience || '',
      auth0Scope: config?.auth0_scope || '',
      auth0RefreshSkewSeconds: Number.isFinite(Number(config?.auth0_refresh_skew_seconds))
        ? Number(config.auth0_refresh_skew_seconds)
        : 60,
      mtlsCertPath: config?.mtls_cert_path || '',
      mtlsKeyPath: config?.mtls_key_path || '',
      mtlsCaPath: config?.mtls_ca_path || '',
      mtlsServerName: config?.mtls_server_name || '',
      engineLambdaUrl: config?.engine_lambda_url || '',
      engineLambdaTokenConfigured: config?.engine_lambda_token_configured === true
    }
  }
}

function buildDraft(group) {
  return {
    id: group?.id || '',
    name: group?.name || '',
    owner: group?.owner || '',
    description: group?.description || '',
    services: Array.isArray(group?.services) ? group.services.slice() : [],
    allowedRecipes: Array.isArray(group?.allowedRecipes) ? group.allowedRecipes.slice() : [],
    allowedEnvironments: Array.isArray(group?.allowedEnvironments) ? group.allowedEnvironments.slice() : [],
    dailyDeployQuota: String(group?.guardrails?.dailyDeployQuota ?? ''),
    dailyRollbackQuota: String(group?.guardrails?.dailyRollbackQuota ?? ''),
    maxConcurrentDeployments: String(group?.guardrails?.maxConcurrentDeployments ?? ''),
    changeReason: ''
  }
}

function isValidEmailAddress(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim())
}

function parseOwnerEmails(ownerValue) {
  return String(ownerValue || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function formatStrategies(recipeIds, recipesById) {
  const labels = recipeIds
    .map((recipeId) => recipesById.get(recipeId)?.name || recipeId)
    .filter(Boolean)
  return labels.length > 0 ? labels.join(', ') : 'None selected'
}

function listDiff(currentItems, nextItems) {
  const current = new Set(currentItems)
  const next = new Set(nextItems)
  return {
    removed: Array.from(current).filter((item) => !next.has(item)),
    added: Array.from(next).filter((item) => !current.has(item))
  }
}

function normalizeValidationMessages(messages) {
  const warnings = []
  const errors = []

  ;(Array.isArray(messages) ? messages : []).forEach((message, index) => {
    const text = typeof message === 'string' ? message : message?.message || ''
    if (!text) return
    const type = String(message?.type || '').toUpperCase()
    const normalized = { id: `${type || 'INFO'}-${index}`, text }
    if (type === 'ERROR') {
      errors.push(normalized)
    } else if (type === 'WARNING') {
      warnings.push(normalized)
    } else {
      warnings.push(normalized)
    }
  })

  return { warnings, errors }
}

function buildPayload(baseGroup, draft) {
  const dailyDeployQuota = Number(draft.dailyDeployQuota)
  const dailyRollbackQuota = Number(draft.dailyRollbackQuota)
  const maxConcurrentDeployments = Number(draft.maxConcurrentDeployments)
  const localErrors = []
  const ownerEmails = parseOwnerEmails(draft.owner)

  if (!String(draft.id || '').trim()) {
    localErrors.push({ id: 'id', text: 'Delivery Group ID is required before DXCP can review this governance object.' })
  }
  if (!String(draft.name || '').trim()) {
    localErrors.push({ id: 'name', text: 'Delivery Group name is required before DXCP can review this governance object.' })
  }
  if (ownerEmails.length === 0) {
    localErrors.push({ id: 'owner', text: 'Add one or more owner email addresses before saving this Delivery Group.' })
  } else if (ownerEmails.some((email) => !isValidEmailAddress(email))) {
    localErrors.push({
      id: 'owner-format',
      text: 'Owner emails must be a comma-separated list of valid email addresses.'
    })
  }
  if (!Number.isInteger(dailyDeployQuota) || dailyDeployQuota <= 0) {
    localErrors.push({ id: 'daily-deploy-quota', text: 'Daily deploy quota must be a positive integer.' })
  }
  if (!Number.isInteger(dailyRollbackQuota) || dailyRollbackQuota <= 0) {
    localErrors.push({ id: 'daily-rollback-quota', text: 'Daily rollback quota must be a positive integer.' })
  }
  if (!Number.isInteger(maxConcurrentDeployments) || maxConcurrentDeployments <= 0) {
    localErrors.push({ id: 'max-concurrent-deployments', text: 'Max concurrent deployments must be a positive integer.' })
  }
  if (draft.allowedRecipes.length === 0) {
    localErrors.push({
      id: 'allowed-recipes',
      text: 'At least one Deployment Strategy must remain allowed before DXCP can save this Deployment Group.'
    })
  }

  const payload = {
    id: String(draft.id || '').trim(),
    name: String(draft.name || '').trim(),
    description: String(draft.description || '').trim() || null,
    owner: ownerEmails.join(', '),
    services: draft.services.slice().sort(),
    allowed_recipes: draft.allowedRecipes.slice().sort(),
    allowed_environments: Array.isArray(baseGroup?.allowedEnvironments)
      ? baseGroup.allowedEnvironments.slice()
      : Array.isArray(draft.allowedEnvironments)
        ? draft.allowedEnvironments.slice()
        : [],
    guardrails: {
      max_concurrent_deployments: maxConcurrentDeployments,
      daily_deploy_quota: dailyDeployQuota,
      daily_rollback_quota: dailyRollbackQuota
    }
  }
  const changeReason = String(draft.changeReason || '').trim()
  if (changeReason) {
    payload.change_reason = changeReason
  }

  return { payload, localErrors }
}

function buildChangeSummary(baseGroup, draft, recipesById) {
  const changes = []
  if (!baseGroup) {
    return [
      { label: 'Delivery Group ID', current: 'New object', proposed: draft.id || 'Not set' },
      { label: 'Name', current: 'New object', proposed: draft.name || 'Not set' },
      { label: 'Owners', current: 'New object', proposed: parseOwnerEmails(draft.owner).join(', ') || 'Not set' },
      { label: 'Applications', current: 'New object', proposed: draft.services.length > 0 ? draft.services.join(', ') : 'None selected' },
      {
        label: 'Allowed Deployment Strategies',
        current: 'New object',
        proposed: formatStrategies(draft.allowedRecipes, recipesById)
      },
      {
        label: 'Guardrails',
        current: 'New object',
        proposed: `Max ${draft.maxConcurrentDeployments || '0'} concurrent | Deploy ${draft.dailyDeployQuota || '0'}/day | Rollback ${draft.dailyRollbackQuota || '0'}/day`
      }
    ]
  }
  if (String(baseGroup.name || '') !== String(draft.name || '')) {
    changes.push({
      label: 'Name',
      current: baseGroup.name || 'Not set',
      proposed: draft.name || 'Not set'
    })
  }
  if (String(baseGroup.description || '') !== String(draft.description || '')) {
    changes.push({
      label: 'Description',
      current: baseGroup.description || 'Not set',
      proposed: draft.description || 'Not set'
    })
  }
  if (String(baseGroup.owner || '') !== String(draft.owner || '')) {
    changes.push({
      label: 'Owners',
      current: baseGroup.owner || 'Not set',
      proposed: draft.owner || 'Not set'
    })
  }
  if (String(baseGroup.guardrails.dailyDeployQuota) !== String(draft.dailyDeployQuota)) {
    changes.push({
      label: 'Daily deploy quota',
      current: `${baseGroup.guardrails.dailyDeployQuota} deploys/day`,
      proposed: `${draft.dailyDeployQuota} deploys/day`
    })
  }
  if (String(baseGroup.guardrails.dailyRollbackQuota) !== String(draft.dailyRollbackQuota)) {
    changes.push({
      label: 'Daily rollback quota',
      current: `${baseGroup.guardrails.dailyRollbackQuota} rollbacks/day`,
      proposed: `${draft.dailyRollbackQuota} rollbacks/day`
    })
  }
  if (String(baseGroup.guardrails.maxConcurrentDeployments) !== String(draft.maxConcurrentDeployments)) {
    changes.push({
      label: 'Max concurrent deployments',
      current: `${baseGroup.guardrails.maxConcurrentDeployments}`,
      proposed: `${draft.maxConcurrentDeployments}`
    })
  }
  if (formatStrategies(baseGroup.allowedRecipes, recipesById) !== formatStrategies(draft.allowedRecipes, recipesById)) {
    changes.push({
      label: 'Allowed Deployment Strategies',
      current: formatStrategies(baseGroup.allowedRecipes, recipesById),
      proposed: formatStrategies(draft.allowedRecipes, recipesById)
    })
  }
  const serviceDiff = listDiff(baseGroup.services, draft.services)
  if (serviceDiff.added.length > 0 || serviceDiff.removed.length > 0) {
    changes.push({
      label: 'Applications',
      current: baseGroup.services.length > 0 ? baseGroup.services.join(', ') : 'None selected',
      proposed: draft.services.length > 0 ? draft.services.join(', ') : 'None selected'
    })
  }
  return changes
}

function buildImpactPreview(baseGroup, draft, recipesById, validation) {
  const newlyBlocked = []
  const newlyAllowed = []
  const unchanged = ['Current running deployments stay unchanged until a future deployment is requested.']
  const recipeDiff = listDiff(baseGroup?.allowedRecipes || [], draft.allowedRecipes)
  const serviceDiff = listDiff(baseGroup?.services || [], draft.services)

  if (!baseGroup) {
    if (draft.services.length > 0) {
      newlyAllowed.push(`DXCP would place ${draft.services.length} application${draft.services.length === 1 ? '' : 's'} inside this governance boundary.`)
    }
    if (draft.allowedRecipes.length > 0) {
      newlyAllowed.push(`DXCP would authorize ${draft.allowedRecipes.length} delivery ${draft.allowedRecipes.length === 1 ? 'strategy' : 'strategies'} for this group.`)
    }
    unchanged.push('Environment policy scope remains managed from the Delivery Group Environment Policy tab.')
    return { newlyBlocked, newlyAllowed, unchanged }
  }

  if (String(baseGroup.guardrails.dailyDeployQuota) !== String(draft.dailyDeployQuota)) {
    const nextValue = Number(draft.dailyDeployQuota)
    const previousValue = Number(baseGroup.guardrails.dailyDeployQuota)
    if (Number.isFinite(nextValue) && Number.isFinite(previousValue)) {
      if (nextValue < previousValue) {
        newlyBlocked.push(`Future deployments will stop after ${nextValue} deploys in one day for ${baseGroup.name}.`)
      } else if (nextValue > previousValue) {
        newlyAllowed.push(`Future deployments may continue until ${nextValue} deploys in one day are reached.`)
      }
    }
  }
  if (String(baseGroup.guardrails.dailyRollbackQuota) !== String(draft.dailyRollbackQuota)) {
    const nextValue = Number(draft.dailyRollbackQuota)
    const previousValue = Number(baseGroup.guardrails.dailyRollbackQuota)
    if (Number.isFinite(nextValue) && Number.isFinite(previousValue)) {
      if (nextValue < previousValue) {
        newlyBlocked.push(`Future rollback requests will stop after ${nextValue} rollbacks in one day for ${baseGroup.name}.`)
      } else if (nextValue > previousValue) {
        newlyAllowed.push(`Future rollback requests may continue until ${nextValue} rollbacks in one day are reached.`)
      }
    }
  }

  recipeDiff.removed.forEach((recipeId) => {
    const label = recipesById.get(recipeId)?.name || recipeId
    newlyBlocked.push(`Applications in this Deployment Group would lose access to ${label}.`)
  })
  recipeDiff.added.forEach((recipeId) => {
    const label = recipesById.get(recipeId)?.name || recipeId
    newlyAllowed.push(`Applications in this Deployment Group would gain access to ${label}.`)
  })
  serviceDiff.removed.forEach((serviceId) => {
    newlyBlocked.push(`${serviceId} would leave this Delivery Group and lose this policy scope.`)
  })
  serviceDiff.added.forEach((serviceId) => {
    newlyAllowed.push(`${serviceId} would enter this Delivery Group and inherit its policy scope.`)
  })

  if (validation.errors.length > 0) {
    unchanged.push('Impact preview remains partial until blocking review errors are resolved.')
  }

  unchanged.push('Environment policy scope remains managed from the Delivery Group Environment Policy tab.')

  return { newlyBlocked, newlyAllowed, unchanged }
}

function buildAuditSummary(auditEvents, group) {
  const relevantEvent =
    (Array.isArray(auditEvents) ? auditEvents : []).find(
      (event) => event?.target_id === group.id || event?.target_id === group.name
    ) || null
  if (!relevantEvent) {
    return 'Audit remains quiet until DXCP records a reviewed governance change for this Deployment Group.'
  }

  const actor = relevantEvent.actor_id || 'Unknown actor'
  const timestamp = relevantEvent.timestamp || 'Time not recorded'
  const summary = relevantEvent.summary || relevantEvent.event_type || 'Recent audit activity was recorded.'
  return `${summary} Last recorded by ${actor} at ${timestamp}.`
}

export async function loadAdminData(api, options = {}) {
  const requestOptions = { ...options }
  const [groupsResult, recipesResult, servicesResult, settingsResult, adminSettingsResult, auditResult, environmentsResult] = await Promise.allSettled([
    api.get('/delivery-groups', requestOptions),
    api.get('/recipes', requestOptions),
    api.get('/services', requestOptions),
    api.get('/settings/public', requestOptions),
    api.get('/settings/admin', requestOptions),
    api.get('/audit/events', requestOptions),
    api.get('/environments', requestOptions)
  ])

  if (groupsResult.status === 'rejected') {
    return {
      kind: 'failure',
      errorMessage: 'DXCP could not load governance data right now. Refresh to try again.',
      viewModel: null
    }
  }

  if (!Array.isArray(groupsResult.value)) {
    return {
      kind: 'failure',
      errorMessage: formatApiError(groupsResult.value, 'DXCP could not load governance data right now. Refresh to try again.'),
      viewModel: null
    }
  }

  const adminDefaults = {
    dailyDeployQuota:
      adminSettingsResult.status === 'fulfilled' && !adminSettingsResult.value?.code
        ? adminSettingsResult.value?.daily_deploy_quota ?? 25
        : 25,
    dailyRollbackQuota:
      adminSettingsResult.status === 'fulfilled' && !adminSettingsResult.value?.code
        ? adminSettingsResult.value?.daily_rollback_quota ?? 10
        : 10
  }
  const degradedReasons = []

  const environmentNamesById =
    environmentsResult.status === 'fulfilled' && Array.isArray(environmentsResult.value)
      ? new Map(
          environmentsResult.value.map((environment) => [
            environment?.id || environment?.environment_id || environment?.name || '',
            environment?.display_name || environment?.displayName || environment?.name || environment?.environment_id || environment?.id || ''
          ])
        )
      : new Map()
  if (environmentsResult.status === 'rejected' || (environmentsResult.status === 'fulfilled' && !Array.isArray(environmentsResult.value))) {
    degradedReasons.push('Environment scope context could not be refreshed.')
  }

  const groups = groupsResult.value
    .map((group) => normalizeGroup(group, adminDefaults, environmentNamesById))
    .filter((group) => group.id)
    .sort((left, right) => left.name.localeCompare(right.name))

  if (groups.length === 0) {
    return {
      kind: 'empty',
      errorMessage: '',
      viewModel: {
        groups: [],
        recipes: [],
        services: [],
        mutationsDisabled: false,
        mutationAvailability: 'ready',
        auditEvents: [],
        degradedReasons: []
      }
    }
  }

  const recipes =
    recipesResult.status === 'fulfilled' && Array.isArray(recipesResult.value)
      ? recipesResult.value.map(normalizeRecipe).filter((recipe) => recipe.id).sort((left, right) => left.name.localeCompare(right.name))
      : []
  if (recipesResult.status === 'rejected' || (recipesResult.status === 'fulfilled' && !Array.isArray(recipesResult.value))) {
    degradedReasons.push('Deployment Strategy context could not be refreshed.')
  }

  const services =
    servicesResult.status === 'fulfilled' && Array.isArray(servicesResult.value)
      ? servicesResult.value
          .map((service) => service?.service_name || service?.name || '')
          .filter(Boolean)
          .sort((left, right) => left.localeCompare(right))
      : []
  if (servicesResult.status === 'rejected' || (servicesResult.status === 'fulfilled' && !Array.isArray(servicesResult.value))) {
    degradedReasons.push('Application membership context could not be refreshed.')
  }

  const settings = settingsResult.status === 'fulfilled' ? settingsResult.value : null
  const mutationAvailability =
    settingsResult.status === 'rejected' || (settingsResult.status === 'fulfilled' && settings?.code)
      ? 'unknown'
      : 'ready'
  if (mutationAvailability === 'unknown') {
    degradedReasons.push('Mutation availability could not be confirmed from public settings.')
  }

  const auditEvents =
    auditResult.status === 'fulfilled' && Array.isArray(auditResult.value)
      ? auditResult.value
      : []
  if (auditResult.status === 'rejected' || (auditResult.status === 'fulfilled' && !Array.isArray(auditResult.value))) {
    degradedReasons.push('Audit context could not be refreshed.')
  }

  return {
    kind: degradedReasons.length > 0 ? 'degraded' : 'ready',
    errorMessage: '',
    viewModel: {
      groups,
      recipes,
      services,
      mutationsDisabled: settings?.mutations_disabled === true,
      mutationAvailability,
      auditEvents,
      degradedReasons,
      adminDefaults
    }
  }
}

export async function reviewAdminGroupDraft(api, baseGroup, draft) {
  const { payload, localErrors } = buildPayload(baseGroup, draft)
  if (localErrors.length > 0) {
    return {
      payload,
      warnings: [],
      errors: localErrors
    }
  }

  try {
    const result = await api.post('/admin/guardrails/validate', payload)
    if (result?.code) {
      return {
        payload,
        warnings: [],
        errors: [{ id: 'validate-request', text: formatApiError(result, 'DXCP could not review this governance change.') }]
      }
    }

    const normalized = normalizeValidationMessages(result?.messages)
    return {
      payload,
      warnings: normalized.warnings,
      errors: normalized.errors
    }
  } catch (error) {
    return {
      payload,
      warnings: [],
      errors: [{ id: 'validate-network', text: 'DXCP could not review this governance change right now. Refresh to try again.' }]
    }
  }
}

export async function saveAdminGroupDraft(api, groupId, payload) {
  try {
    const result = groupId
      ? await api.put(`/delivery-groups/${encodeURIComponent(groupId)}`, payload)
      : await api.post('/delivery-groups', payload)
    if (result?.code) {
      return {
        ok: false,
        errorMessage: formatApiError(result, 'DXCP could not save this Deployment Group right now.'),
        code: result?.code || '',
        details: result?.details || null
      }
    }
    return { ok: true, group: result }
  } catch (error) {
    return {
      ok: false,
      errorMessage: 'DXCP could not save this Deployment Group right now. Refresh to try again.'
    }
  }
}

export function createEmptyAdminGroupDraft(adminDefaults = {}) {
  return buildDraft({
    id: '',
    name: '',
    owner: '',
    description: '',
    services: [],
    allowedRecipes: [],
    allowedEnvironments: [],
    guardrails: {
      dailyDeployQuota: adminDefaults.dailyDeployQuota ?? 25,
      dailyRollbackQuota: adminDefaults.dailyRollbackQuota ?? 10,
      maxConcurrentDeployments: 1
    }
  })
}

export function buildAdminViewModel(state, selectedGroupId, mode, draft, review, warningAcknowledged) {
  const recipesById = new Map((state.viewModel?.recipes || []).map((recipe) => [recipe.id, recipe]))
  const baseGroup =
    state.viewModel?.groups.find((group) => group.id === selectedGroupId) ||
    state.viewModel?.groups[0] ||
    null
  if (!baseGroup) return null

  const pendingDraft = draft || buildDraft(baseGroup)
  const changeSummary = buildChangeSummary(baseGroup, pendingDraft, recipesById)
  const hasChanges = changeSummary.length > 0
  const warnings = review?.warnings || []
  const errors = review?.errors || []
  const saveBlockedBySettings =
    state.viewModel?.mutationsDisabled === true || state.viewModel?.mutationAvailability === 'unknown'
  const saveRequiresWarningAcknowledgement = warnings.length > 0
  const canSave =
    mode === 'review' &&
    hasChanges &&
    errors.length === 0 &&
    !saveBlockedBySettings &&
    (!saveRequiresWarningAcknowledgement || warningAcknowledged)

  return {
    baseGroup,
    draft: pendingDraft,
    recipesById,
    changeSummary,
    impactPreview: buildImpactPreview(baseGroup, pendingDraft, recipesById, { warnings, errors }),
    warnings,
    errors,
    auditSummary: buildAuditSummary(state.viewModel?.auditEvents, baseGroup),
    hasChanges,
    saveBlockedBySettings,
    canSave,
    saveRequiresWarningAcknowledgement,
    availableRecipes: state.viewModel?.recipes || [],
    services: state.viewModel?.services || []
  }
}

export function createAdminDraft(group) {
  return buildDraft(group)
}

function normalizeEnvironmentRow(environment) {
  const lifecycleState = String(
    environment?.lifecycle_state || (environment?.is_enabled === false ? 'disabled' : 'active')
  ).toLowerCase()
  return {
    id: environment?.id || environment?.environment_id || environment?.name || '',
    displayName: environment?.display_name || environment?.displayName || environment?.name || '',
    type: environment?.type === 'prod' ? 'prod' : 'non_prod',
    lifecycleState,
    isEnabled: environment?.is_enabled !== false,
    createdAt: environment?.created_at || '',
    updatedAt: environment?.updated_at || ''
  }
}

function normalizeRouteRow(route) {
  return {
    serviceId: route?.service_id || '',
    environmentId: route?.environment_id || '',
    displayName: route?.display_name || route?.environment_id || '',
    type: route?.type === 'prod' ? 'prod' : 'non_prod',
    lifecycleState: String(route?.lifecycle_state || 'active').toLowerCase(),
    isEnabled: route?.is_enabled !== false,
    recipeId: route?.recipe_id || ''
  }
}

function createEmptyRecipeUsage() {
  return {
    routes: [],
    deliveryGroups: [],
    totalReferences: 0,
    routedReferenceCount: 0,
    deliveryGroupReferenceCount: 0
  }
}

function buildRecipeUsageMap(recipes, deliveryGroups, routesByService) {
  const usageByRecipeId = new Map()

  const ensureUsage = (recipeId) => {
    if (!usageByRecipeId.has(recipeId)) {
      usageByRecipeId.set(recipeId, createEmptyRecipeUsage())
    }
    return usageByRecipeId.get(recipeId)
  }

  ;(Array.isArray(recipes) ? recipes : []).forEach((recipe) => {
    if (recipe?.id) ensureUsage(recipe.id)
  })

  ;(Array.isArray(deliveryGroups) ? deliveryGroups : []).forEach((group) => {
    ;(Array.isArray(group?.allowed_recipes) ? group.allowed_recipes : []).forEach((recipeId) => {
      if (!recipeId) return
      const usage = ensureUsage(recipeId)
      usage.deliveryGroups.push({
        deliveryGroupId: group.id || '',
        deliveryGroupName: group.name || group.id || ''
      })
    })
  })

  Array.from(routesByService.entries()).forEach(([serviceId, routes]) => {
    ;(Array.isArray(routes) ? routes : []).forEach((route) => {
      if (!route?.recipeId) return
      const usage = ensureUsage(route.recipeId)
      usage.routes.push({
        serviceId,
        environmentId: route.environmentId || '',
        environmentName: route.displayName || route.environmentId || ''
      })
    })
  })

  usageByRecipeId.forEach((usage) => {
    usage.routes.sort((left, right) => {
      const serviceCompare = String(left.serviceId || '').localeCompare(String(right.serviceId || ''))
      if (serviceCompare !== 0) return serviceCompare
      return String(left.environmentId || '').localeCompare(String(right.environmentId || ''))
    })
    usage.deliveryGroups.sort((left, right) =>
      String(left.deliveryGroupId || '').localeCompare(String(right.deliveryGroupId || ''))
    )
    usage.routedReferenceCount = usage.routes.length
    usage.deliveryGroupReferenceCount = usage.deliveryGroups.length
    usage.totalReferences = usage.routedReferenceCount + usage.deliveryGroupReferenceCount
  })

  return usageByRecipeId
}

function decorateRecipesWithUsage(recipes, usageByRecipeId) {
  return (Array.isArray(recipes) ? recipes : []).map((recipe) => {
    const usage = usageByRecipeId.get(recipe.id) || createEmptyRecipeUsage()
    return {
      ...recipe,
      usage
    }
  })
}

export async function loadAdminRecipeWorkspace(api, options = {}) {
  const requestOptions = { ...options }
  const [recipesResult, deliveryGroupsResult, servicesResult] = await Promise.allSettled([
    api.get('/recipes', requestOptions),
    api.get('/delivery-groups', requestOptions),
    api.get('/services', requestOptions)
  ])

  if (recipesResult.status === 'rejected' || !Array.isArray(recipesResult.value)) {
    return {
      kind: 'failure',
      errorMessage: formatApiError(
        recipesResult.value,
        'DXCP could not load recipe administration data right now. Refresh to try again.'
      ),
      viewModel: null
    }
  }

  const degradedReasons = []
  const recipes = recipesResult.value
    .map(normalizeRecipe)
    .filter((recipe) => recipe.id)
    .sort((left, right) => left.name.localeCompare(right.name))

  const deliveryGroups =
    deliveryGroupsResult.status === 'fulfilled' && Array.isArray(deliveryGroupsResult.value)
      ? deliveryGroupsResult.value
      : []
  if (
    deliveryGroupsResult.status === 'rejected' ||
    (deliveryGroupsResult.status === 'fulfilled' && !Array.isArray(deliveryGroupsResult.value))
  ) {
    degradedReasons.push('Delivery-group authorization context could not be refreshed.')
  }

  const services =
    servicesResult.status === 'fulfilled' && Array.isArray(servicesResult.value)
      ? servicesResult.value
          .map((service) => service?.service_name || service?.name || '')
          .filter(Boolean)
          .sort((left, right) => left.localeCompare(right))
      : []
  if (servicesResult.status === 'rejected' || (servicesResult.status === 'fulfilled' && !Array.isArray(servicesResult.value))) {
    degradedReasons.push('Service routing context could not be refreshed.')
  }

  const routesByService = new Map()
  if (services.length > 0) {
    const routeResults = await Promise.allSettled(
      services.map(async (serviceId) => ({
        serviceId,
        rows: await api.get(`/admin/services/${encodeURIComponent(serviceId)}/environments`, requestOptions)
      }))
    )

    routeResults.forEach((result) => {
      if (result.status !== 'fulfilled') {
        degradedReasons.push('Some service-environment routing reads could not be refreshed.')
        return
      }
      if (!Array.isArray(result.value?.rows)) {
        degradedReasons.push('Some service-environment routing reads could not be refreshed.')
        return
      }
      routesByService.set(
        result.value.serviceId,
        result.value.rows.map(normalizeRouteRow).filter((row) => row.environmentId)
      )
    })
  }

  const usageByRecipeId = buildRecipeUsageMap(recipes, deliveryGroups, routesByService)

  return {
    kind: degradedReasons.length > 0 ? 'degraded' : 'ready',
    errorMessage: '',
    viewModel: {
      recipes: decorateRecipesWithUsage(recipes, usageByRecipeId),
      services,
      deliveryGroups,
      degradedReasons
    }
  }
}

export async function createAdminRecipe(api, payload) {
  try {
    const result = await api.post('/recipes', payload)
    if (result?.code) {
      return {
        ok: false,
        errorMessage: formatApiError(result, 'DXCP could not create this recipe.'),
        details: result?.details || null,
        code: result?.code || ''
      }
    }
    return { ok: true, recipe: normalizeRecipe(result) }
  } catch (error) {
    return { ok: false, errorMessage: 'DXCP could not create this recipe right now. Refresh to try again.' }
  }
}

export async function updateAdminRecipe(api, recipeId, payload) {
  try {
    const result = await api.put(`/recipes/${encodeURIComponent(recipeId)}`, payload)
    if (result?.code) {
      return {
        ok: false,
        errorMessage: formatApiError(result, 'DXCP could not update this recipe.'),
        details: result?.details || null,
        code: result?.code || ''
      }
    }
    return { ok: true, recipe: normalizeRecipe(result) }
  } catch (error) {
    return { ok: false, errorMessage: 'DXCP could not update this recipe right now. Refresh to try again.' }
  }
}

export async function deleteAdminRecipe(api, recipeId) {
  try {
    const result = await api.delete(`/admin/recipes/${encodeURIComponent(recipeId)}`)
    if (result?.code) {
      return {
        ok: false,
        errorMessage: formatApiError(result, 'DXCP could not delete this recipe.'),
        details: result?.details || null,
        code: result?.code || ''
      }
    }
    return { ok: true }
  } catch (error) {
    return { ok: false, errorMessage: 'DXCP could not delete this recipe right now. Refresh to try again.' }
  }
}

export async function loadAdminEnvironmentWorkspace(api, options = {}) {
  const requestOptions = { ...options }
  const [environmentsResult, servicesResult, recipesResult, groupsResult] = await Promise.allSettled([
    api.get('/environments', requestOptions),
    api.get('/services', requestOptions),
    api.get('/recipes', requestOptions),
    api.get('/delivery-groups', requestOptions)
  ])

  if (environmentsResult.status === 'rejected' || !Array.isArray(environmentsResult.value)) {
    return {
      kind: 'failure',
      errorMessage: formatApiError(
        environmentsResult.value,
        'DXCP could not load environment administration data right now. Refresh to try again.'
      ),
      viewModel: null
    }
  }

  const degradedReasons = []
  const environments = environmentsResult.value
    .map(normalizeEnvironmentRow)
    .filter((environment) => environment.id)
    .sort((left, right) => left.id.localeCompare(right.id))

  const services =
    servicesResult.status === 'fulfilled' && Array.isArray(servicesResult.value)
      ? servicesResult.value
          .map((service) => service?.service_name || service?.name || '')
          .filter(Boolean)
          .sort((left, right) => left.localeCompare(right))
      : []
  if (servicesResult.status === 'rejected' || (servicesResult.status === 'fulfilled' && !Array.isArray(servicesResult.value))) {
    degradedReasons.push('Service routing context could not be refreshed.')
  }

  const recipes =
    recipesResult.status === 'fulfilled' && Array.isArray(recipesResult.value)
      ? recipesResult.value.map(normalizeRecipe).filter((recipe) => recipe.id)
      : []
  if (recipesResult.status === 'rejected' || (recipesResult.status === 'fulfilled' && !Array.isArray(recipesResult.value))) {
    degradedReasons.push('Recipe context could not be refreshed.')
  }

  const deliveryGroups =
    groupsResult.status === 'fulfilled' && Array.isArray(groupsResult.value)
      ? groupsResult.value
      : []
  if (groupsResult.status === 'rejected' || (groupsResult.status === 'fulfilled' && !Array.isArray(groupsResult.value))) {
    degradedReasons.push('Delivery-group policy context could not be refreshed.')
  }

  return {
    kind: degradedReasons.length > 0 ? 'degraded' : 'ready',
    errorMessage: '',
    viewModel: {
      environments,
      services,
      recipes,
      deliveryGroups,
      degradedReasons
    }
  }
}

export async function createAdminEnvironment(api, payload) {
  try {
    const result = await api.post('/environments', payload)
    if (result?.code) {
      return { ok: false, errorMessage: formatApiError(result, 'DXCP could not create this environment.') }
    }
    return { ok: true, environment: result }
  } catch (error) {
    return { ok: false, errorMessage: 'DXCP could not create this environment right now. Refresh to try again.' }
  }
}

export async function updateAdminEnvironment(api, environmentId, payload) {
  try {
    const result = await api.patch(`/environments/${encodeURIComponent(environmentId)}`, payload)
    if (result?.code) {
      return {
        ok: false,
        errorMessage: formatApiError(result, 'DXCP could not update this environment.'),
        details: result?.details || null
      }
    }
    return { ok: true, environment: result }
  } catch (error) {
    return { ok: false, errorMessage: 'DXCP could not update this environment right now. Refresh to try again.' }
  }
}

export async function deleteAdminEnvironment(api, environmentId) {
  try {
    const result = await api.delete(`/environments/${encodeURIComponent(environmentId)}`)
    if (result?.code) {
      return {
        ok: false,
        errorMessage: formatApiError(result, 'DXCP could not delete this environment.'),
        details: result?.details || null,
        code: result?.code || ''
      }
    }
    return { ok: true }
  } catch (error) {
    return { ok: false, errorMessage: 'DXCP could not delete this environment right now. Refresh to try again.' }
  }
}

export async function loadAdminServiceEnvironmentRouting(api, serviceId, options = {}) {
  if (!serviceId) {
    return { kind: 'empty', rows: [], errorMessage: '' }
  }
  try {
    const result = await api.get(`/admin/services/${encodeURIComponent(serviceId)}/environments`, options)
    if (!Array.isArray(result)) {
      return {
        kind: 'failure',
        rows: [],
        errorMessage: formatApiError(result, 'DXCP could not load service-environment routing.')
      }
    }
    return {
      kind: result.length > 0 ? 'ready' : 'empty',
      rows: result.map(normalizeRouteRow),
      errorMessage: ''
    }
  } catch (error) {
    return { kind: 'failure', rows: [], errorMessage: 'DXCP could not load service-environment routing right now.' }
  }
}

export async function saveAdminServiceEnvironmentRouting(api, serviceId, environmentId, recipeId) {
  try {
    const result = await api.put(
      `/admin/services/${encodeURIComponent(serviceId)}/environments/${encodeURIComponent(environmentId)}`,
      { recipe_id: recipeId }
    )
    if (result?.code) {
      return {
        ok: false,
        errorMessage: formatApiError(result, 'DXCP could not save service-environment routing.'),
        details: result?.details || null
      }
    }
    return { ok: true, route: result }
  } catch (error) {
    return { ok: false, errorMessage: 'DXCP could not save service-environment routing right now.' }
  }
}

export async function loadAdminEngineAdapterWorkspace(api, options = {}) {
  try {
    const result = await api.get('/admin/system/engine-adapters/main', options)
    if (result?.code) {
      return {
        kind: 'failure',
        errorMessage: formatApiError(result, 'DXCP could not load engine adapter settings right now.'),
        viewModel: null
      }
    }
    return {
      kind: 'ready',
      errorMessage: '',
      viewModel: {
        adapter: normalizeEngineAdapter(result)
      }
    }
  } catch (error) {
    return {
      kind: 'failure',
      errorMessage: 'DXCP could not load engine adapter settings right now. Refresh to try again.',
      viewModel: null
    }
  }
}

export async function saveAdminEngineAdapter(api, payload) {
  try {
    const result = await api.put('/admin/system/engine-adapters/main', payload)
    if (result?.code) {
      return {
        ok: false,
        errorMessage: formatApiError(result, 'DXCP could not save engine adapter settings.'),
        details: result?.details || null
      }
    }
    return { ok: true, adapter: normalizeEngineAdapter(result) }
  } catch (error) {
    return {
      ok: false,
      errorMessage: 'DXCP could not save engine adapter settings right now. Refresh to try again.'
    }
  }
}

export async function validateAdminEngineAdapter(api, payload) {
  try {
    const result = await api.post('/admin/system/engine-adapters/main/validate', payload)
    if (result?.code) {
      return {
        ok: false,
        errorMessage: formatApiError(result, 'DXCP could not validate the engine adapter configuration.'),
        details: result?.details || null
      }
    }
    return {
      ok: true,
      result: {
        status: result?.status || 'INVALID',
        summary: result?.summary || '',
        warnings: Array.isArray(result?.warnings) ? result.warnings : [],
        errors: Array.isArray(result?.errors) ? result.errors : []
      }
    }
  } catch (error) {
    return {
      ok: false,
      errorMessage: 'DXCP could not validate the engine adapter configuration right now.'
    }
  }
}
