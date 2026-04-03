import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import SectionCard from '../components/SectionCard.jsx'
import NewExperiencePageHeader from './NewExperiencePageHeader.jsx'
import { NewExplanation, NewPageContextRail, NewStateBlock } from './NewExperienceStatePrimitives.jsx'
import {
  loadDeployBaseData,
  loadDeployEnvironmentContext,
  validateDeployIntent
} from './newExperienceDeployData.js'

function readinessLabel(status) {
  if (status === 'blocked') return 'Blocked'
  if (status === 'view-only') return 'Read-only'
  if (status === 'pending') return 'Needs input'
  if (status === 'checking') return 'Checking'
  return 'Ready'
}

function readinessClass(status) {
  if (status === 'blocked') return 'new-readiness-item blocked'
  if (status === 'view-only') return 'new-readiness-item view-only'
  if (status === 'pending') return 'new-readiness-item pending'
  if (status === 'checking') return 'new-readiness-item checking'
  return 'new-readiness-item ready'
}

function buildReturnTo(location, applicationName) {
  return location.state?.returnTo || {
    kind: 'application',
    to: `/new/applications/${applicationName}`,
    label: 'Back to Application',
    scopeSummary: 'Return to the application record without losing application-level context.'
  }
}

function mapValidationBlock(result, context, applicationName, selectedEnvironmentLabel) {
  const groupName = context?.deliveryGroupName || 'this Deployment Group'
  const activeDeploymentId = context?.activeDeployment?.id || ''
  const activeDeploymentEnvironment = context?.activeDeployment?.environment || selectedEnvironmentLabel
  const defaultActions = [{ label: 'Open Application', to: `/new/applications/${applicationName}` }]

  switch (result?.code) {
    case 'CONCURRENCY_LIMIT_REACHED':
    case 'DEPLOYMENT_LOCKED':
      return {
        title: 'Deploy blocked',
        tone: 'danger',
        body: activeDeploymentId
          ? `DXCP already has Deployment ${activeDeploymentId} in progress for ${activeDeploymentEnvironment}. Wait for that deployment to finish, or open it before starting another deploy.`
          : `DXCP already has an active deployment in progress for ${activeDeploymentEnvironment}. Wait for that deployment to finish before starting another deploy.`,
        actions: activeDeploymentId
          ? [
              { label: 'Open Active Deployment', to: `/new/deployments/${activeDeploymentId}` },
              { label: 'Open Application', to: `/new/applications/${applicationName}`, secondary: true }
            ]
          : defaultActions,
        blockedReadinessLabel: `No active deployment is already running for ${activeDeploymentEnvironment}.`
      }
    case 'QUOTA_EXCEEDED':
      return {
        title: 'Deploy blocked',
        tone: 'danger',
        body: `DXCP has already reached the daily deploy quota for ${groupName}. Review recent deployments or wait for quota to reset before deploying again.`,
        actions: [
          { label: 'Open Deployments', to: '/new/deployments' },
          { label: 'Open Application', to: `/new/applications/${applicationName}`, secondary: true }
        ],
        blockedReadinessLabel: 'Deployments remain within the daily deploy quota.'
      }
    case 'ENVIRONMENT_NOT_ALLOWED':
      return {
        title: 'Permission-limited deploy',
        tone: 'warning',
        body: `Your access does not allow deploys for ${selectedEnvironmentLabel} from this workflow. Review the deploy plan here, then hand off to an authorized operator if deployment still needs to proceed.`,
        actions: defaultActions,
        blockedReadinessLabel: `Your access allows deploys for ${selectedEnvironmentLabel}.`
      }
    case 'RECIPE_NOT_ALLOWED':
      return {
        title: 'Deploy blocked',
        tone: 'danger',
        body: `The routed delivery behavior is not allowed for ${groupName}. Review service-environment routing or policy before you deploy.`,
        actions: defaultActions,
        blockedReadinessLabel: 'The routed delivery behavior is allowed for this Deployment Group.'
      }
    case 'RECIPE_INCOMPATIBLE':
      return {
        title: 'Deploy blocked',
        tone: 'danger',
        body: 'The routed delivery behavior is not compatible with this Application. Review routing or recipe compatibility before you deploy.',
        actions: defaultActions,
        blockedReadinessLabel: 'The routed delivery behavior is compatible with this Application.'
      }
    case 'RECIPE_DEPRECATED':
      return {
        title: 'Deploy blocked',
        tone: 'danger',
        body: 'The routed delivery behavior is deprecated and cannot be used for new deployments. Review routing before you deploy.',
        actions: defaultActions,
        blockedReadinessLabel: 'The routed delivery behavior is current and available for new deployments.'
      }
    default:
      return {
        title: 'Deploy blocked',
        tone: 'danger',
        body: result?.message || 'DXCP could not validate this deploy intent.',
        actions: defaultActions,
        blockedReadinessLabel:
          result?.code === 'VERSION_NOT_FOUND'
            ? 'The selected version is registered and deployable.'
            : result?.code === 'INVALID_VERSION'
              ? 'The selected version is in a deployable format.'
              : result?.code === 'SERVICE_NOT_IN_DELIVERY_GROUP'
                ? 'Deployment Group context is resolved for this Application.'
                : result?.code === 'SERVICE_NOT_ALLOWLISTED'
                  ? 'This Application remains deployable from this route.'
                  : result?.code === 'MUTATIONS_DISABLED'
                    ? 'Mutations are available for this workflow.'
                    : result?.code === 'RATE_LIMITED'
                      ? 'DXCP is currently accepting deploy requests for this workflow.'
                      : 'DXCP has confirmed that guardrails allow this deploy now.'
      }
  }
}

function deriveDeployPosture({
  role,
  base,
  selectedEnvironment,
  version,
  changeSummary,
  validationState,
  environmentContext,
  applicationName,
  submitting
}) {
  const selectedEnvironmentLabel = selectedEnvironment?.label || selectedEnvironment?.name || 'the selected environment'

  if (role === 'OBSERVER') {
    return {
      primaryActionState: 'read-only',
      headerNote: 'Observers can review deploy intent and readiness, but deploy remains read-only on this workflow.',
      local: {
        title: 'Read-only workflow',
        tone: 'warning',
        body: 'This workflow remains visible so you can understand deploy requirements, current policy, and the next handoff without being invited into a blocked mutation path.',
        actions: [{ label: 'Open Application', to: `/new/applications/${applicationName}` }]
      },
      blockedReadinessLabel: 'Mutation access is available for this workflow.'
    }
  }

  if (base?.mutationsDisabled === true) {
    return {
      primaryActionState: 'read-only',
      headerNote: 'DXCP is currently in read-only mode. Deploy intent remains visible here, but deploy cannot proceed until mutations are re-enabled.',
      local: {
        title: 'Read-only workflow',
        tone: 'warning',
        body: 'DXCP is currently in read-only mode. You can still review deploy intent, readiness, and guardrails here without starting a failed mutation.',
        actions: [{ label: 'Open Application', to: `/new/applications/${applicationName}` }]
      },
      blockedReadinessLabel: 'Mutations are available for this workflow.'
    }
  }

  if (base?.allowedActionsKnown === false) {
    return {
      primaryActionState: 'disabled',
      headerNote: 'Deploy access could not be refreshed for this route. Review the visible deploy plan, then refresh before you deploy.',
      local: {
        title: 'Deploy access could not be confirmed',
        tone: 'warning',
        body: 'DXCP could not refresh deploy access for this Application right now. Deploy stays unavailable until access checks return, so the route does not invent a permission answer.',
        actions: [{ label: 'Open Application', to: `/new/applications/${applicationName}` }]
      },
      blockedReadinessLabel: 'DXCP has refreshed deploy access for this workflow.'
    }
  }

  if (base?.allowedActions?.actions?.deploy !== true) {
    return {
      primaryActionState: 'blocked',
      headerNote: 'Deploy is permission-limited for this Application on this route.',
      local: {
        title: 'Permission-limited deploy',
        tone: 'warning',
        body: `Your access does not include Deploy for ${applicationName}. You can review deploy intent and readiness here, then hand off to an authorized operator if deployment still needs to proceed.`,
        actions: [{ label: 'Open Application', to: `/new/applications/${applicationName}` }]
      },
      blockedReadinessLabel: `Your access allows Deploy for ${applicationName}.`
    }
  }

  if (!base?.deliveryGroup?.id) {
    return {
      primaryActionState: 'blocked',
      headerNote: 'Deploy is blocked because Deployment Group context is missing on this route.',
      local: {
        title: 'Deploy blocked',
        tone: 'danger',
        body: 'DXCP could not resolve Deployment Group context for this Application. Open the Application record while policy context is repaired.',
        actions: [{ label: 'Open Application', to: `/new/applications/${applicationName}` }]
      },
      blockedReadinessLabel: 'Deployment Group context is resolved for this Application.'
    }
  }

  if ((base?.environments || []).length === 0) {
    return {
      primaryActionState: 'blocked',
      headerNote: 'Deploy is blocked because no enabled environment is available for this Application on this route.',
      local: {
        title: 'Deploy blocked',
        tone: 'danger',
        body: 'DXCP did not return an enabled environment for this Application. Deploy intent remains visible here, but deploy requires an enabled target first.',
        actions: [{ label: 'Open Application', to: `/new/applications/${applicationName}` }]
      },
      blockedReadinessLabel: 'An enabled environment is available for this workflow.'
    }
  }

  if (!selectedEnvironment?.name) {
    return {
      primaryActionState: 'disabled',
      headerNote: 'Choose an enabled environment before DXCP can validate this deploy intent.',
      local: {
        title: 'Complete deploy intent',
        tone: 'warning',
        body: 'Choose an enabled environment, select a deployable version, and add a change summary before DXCP can validate this deploy intent.',
        actions: []
      },
      blockedReadinessLabel: 'An enabled environment is selected.'
    }
  }

  if (selectedEnvironment?.isEnabled === false) {
    return {
      primaryActionState: 'blocked',
      headerNote: `Deploy is blocked because ${selectedEnvironmentLabel} is not enabled on this route.`,
      local: {
        title: 'Deploy blocked',
        tone: 'danger',
        body: `${selectedEnvironmentLabel} is not currently enabled for deploy on this route. Choose an enabled environment before you deploy.`,
        actions: []
      },
      blockedReadinessLabel: `${selectedEnvironmentLabel} is enabled for deploy on this route.`
    }
  }

  if (!version || !changeSummary.trim()) {
    return {
      primaryActionState: 'disabled',
      headerNote: 'Deploy becomes available after all required deploy intent inputs are complete and validated.',
      local: {
        title: 'Complete deploy intent',
        tone: 'warning',
        body: 'Select the deploy target, choose a deployable version, and add a change summary before DXCP can validate this deploy intent.',
        actions: []
      },
      blockedReadinessLabel: ''
    }
  }

  if (validationState.kind === 'checking') {
    return {
      primaryActionState: 'disabled',
      headerNote: 'DXCP is validating deploy readiness against current policy and guardrails.',
      local: {
        title: 'Checking readiness',
        tone: 'warning',
        body: 'DXCP is checking policy and readiness for this exact deploy intent before enabling Deploy.',
        actions: []
      },
      blockedReadinessLabel: 'DXCP has confirmed that guardrails allow this deploy now.'
    }
  }

  if (validationState.kind === 'blocked') {
    const mappedBlock = mapValidationBlock(validationState.result, {
      deliveryGroupName: base?.deliveryGroup?.name || 'this Deployment Group',
      activeDeployment: environmentContext?.activeDeployment
    }, applicationName, selectedEnvironmentLabel)
    return {
      primaryActionState: 'blocked',
      headerNote: mappedBlock.body,
      local: mappedBlock,
      blockedReadinessLabel: mappedBlock.blockedReadinessLabel
    }
  }

  if (validationState.kind === 'error') {
    return {
      primaryActionState: 'disabled',
      headerNote: 'Readiness could not be fully refreshed right now. Review the visible deploy intent and retry validation.',
      local: {
        title: 'Readiness could not be refreshed',
        tone: 'warning',
        body: validationState.errorMessage || 'DXCP could not validate this deploy intent right now.',
        actions: [{ label: 'Open Application', to: `/new/applications/${applicationName}` }]
      },
      blockedReadinessLabel: 'DXCP has confirmed that guardrails allow this deploy now.'
    }
  }

  return {
    primaryActionState: submitting ? 'disabled' : 'available',
    headerNote: 'Deploy stays in the page header so the primary action remains stable while you review readiness below.',
    local: {
      title: 'Ready to deploy',
      tone: 'neutral',
      body: 'DXCP has validated this deploy intent against current policy and readiness conditions. Review the plan, then deploy when you are satisfied with the change.',
      actions: []
    },
    blockedReadinessLabel: 'DXCP has confirmed that guardrails allow this deploy now.'
  }
}

function buildReadinessItems({ base, selectedEnvironment, version, changeSummary, posture, validationState }) {
  const items = [
    {
      label: 'Application context is confirmed.',
      status: base?.service?.name ? 'met' : 'blocked'
    },
    {
      label: 'An enabled environment is selected.',
      status:
        !selectedEnvironment?.name
          ? 'pending'
          : selectedEnvironment.isEnabled === false || posture.blockedReadinessLabel === `${selectedEnvironment.label || selectedEnvironment.name} is enabled for deploy on this route.`
            ? 'blocked'
            : 'met'
    },
    {
      label: 'Version is registered and deployable.',
      status:
        !version
          ? 'pending'
          : posture.blockedReadinessLabel === 'The selected version is registered and deployable.' && posture.primaryActionState === 'blocked'
            ? 'blocked'
            : 'met'
    },
    {
      label: 'Change summary is provided.',
      status: changeSummary.trim() ? 'met' : 'pending'
    }
  ]

  if (posture.blockedReadinessLabel) {
    items.push({
      label: posture.blockedReadinessLabel,
      status:
        posture.primaryActionState === 'read-only'
          ? 'view-only'
          : posture.primaryActionState === 'blocked'
            ? 'blocked'
            : validationState.kind === 'checking'
              ? 'checking'
              : validationState.kind === 'ready'
                ? 'met'
                : 'pending'
    })
  }

  return items
}

function combineDegradedReasons(baseState, environmentState) {
  return [...(baseState.degradedReasons || []), ...(environmentState.degradedReasons || [])].filter(Boolean)
}

function buildDeployPageContextIssues(posture) {
  if (!posture?.local || posture.local.tone === 'neutral') return []
  if (posture.local.title === 'Complete deploy intent' || posture.local.title === 'Checking readiness') return []

  let summary = posture.local.summary || posture.local.title
  if (posture.local.title === 'Permission-limited deploy') summary = 'Deploy permission limited'
  if (posture.local.title === 'Deploy access could not be confirmed') summary = 'Deploy access check unavailable'
  if (posture.local.title === 'Read-only workflow') summary = 'Read-only deploy guidance'

  return [
    {
      id: 'deploy-page-context-issue',
      title: posture.local.title,
      summary,
      tone: posture.local.tone,
      body: posture.local.body,
      actions: posture.local.actions || []
    }
  ]
}

export default function NewExperienceDeployPage({ role = 'UNKNOWN', api }) {
  const { applicationName = 'payments-api' } = useParams()
  const location = useLocation()
  const returnTo = buildReturnTo(location, applicationName)
  const applicationIdentityLink = (
    <Link
      className="new-page-object-identity-link"
      to={returnTo.to || `/new/applications/${applicationName}`}
      title="Back to application"
      aria-label={`Back to application ${applicationName}`}
    >
      <span>{applicationName}</span>
      <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
        <path
          d="M6 14L14 6"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M8 6H14V12"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </Link>
  )
  const [baseState, setBaseState] = useState({
    kind: 'loading',
    base: null,
    degradedReasons: [],
    errorMessage: ''
  })
  const [environmentName, setEnvironmentName] = useState('')
  const [version, setVersion] = useState('')
  const [changeSummary, setChangeSummary] = useState('')
  const [environmentState, setEnvironmentState] = useState({
    kind: 'idle',
    context: { activeDeployment: null, policySummary: null, deliveryStatus: null },
    degradedReasons: [],
    errorMessage: ''
  })
  const [validationState, setValidationState] = useState({
    kind: 'idle',
    result: null,
    errorMessage: '',
    diagnostics: null
  })
  const [submitState, setSubmitState] = useState({
    kind: 'idle',
    deploymentId: '',
    errorMessage: ''
  })

  const refreshBase = useCallback(
    async (options = {}) => {
      setBaseState((current) => ({
        kind: current.kind === 'ready' || current.kind === 'degraded' ? 'refreshing' : 'loading',
        base: current.base,
        degradedReasons: [],
        errorMessage: ''
      }))
      const nextState = await loadDeployBaseData(api, applicationName, options)
      setBaseState(nextState)
    },
    [api, applicationName]
  )

  useEffect(() => {
    let active = true
    const load = async () => {
      const nextState = await loadDeployBaseData(api, applicationName)
      if (active) {
        setBaseState(nextState)
      }
    }
    load()
    return () => {
      active = false
    }
  }, [api, applicationName])

  useEffect(() => {
    const base = baseState.base
    if (!base) return
    if (!environmentName && base.defaultEnvironmentName) setEnvironmentName(base.defaultEnvironmentName)
    if (!version && base.defaultVersion) setVersion(base.defaultVersion)
  }, [baseState.base, environmentName, version])

  useEffect(() => {
    if (!baseState.base || !environmentName) {
      setEnvironmentState({
        kind: 'idle',
        context: { activeDeployment: null, policySummary: null, deliveryStatus: null },
        degradedReasons: [],
        errorMessage: ''
      })
      return
    }
    let active = true
    setEnvironmentState((current) => ({
      kind: current.kind === 'ready' || current.kind === 'degraded' ? 'refreshing' : 'loading',
      context: current.context,
      degradedReasons: [],
      errorMessage: ''
    }))
    loadDeployEnvironmentContext(api, applicationName, environmentName).then((nextState) => {
      if (active) setEnvironmentState(nextState)
    })
    return () => {
      active = false
    }
  }, [api, applicationName, baseState.base, environmentName])

  useEffect(() => {
    const base = baseState.base
    if (
      !base ||
      role === 'OBSERVER' ||
      base.mutationsDisabled === true ||
      base.allowedActions?.actions?.deploy !== true ||
      !environmentName ||
      !version ||
      !changeSummary.trim()
    ) {
      setValidationState({ kind: 'idle', result: null, errorMessage: '', diagnostics: null })
      return
    }

    let active = true
    setValidationState((current) => ({
      kind: 'checking',
      result: current.result,
      errorMessage: '',
      diagnostics: null
    }))
    const timeoutId = window.setTimeout(() => {
      validateDeployIntent(api, {
        service: applicationName,
        environment: environmentName,
        version,
        changeSummary: changeSummary.trim()
      }).then((nextState) => {
        if (active) setValidationState(nextState)
      })
    }, 150)

    return () => {
      active = false
      window.clearTimeout(timeoutId)
    }
  }, [api, applicationName, baseState.base, changeSummary, environmentName, role, version])

  const base = baseState.base
  const selectedEnvironment = useMemo(
    () => base?.environments?.find((item) => item.name === environmentName) || null,
    [base?.environments, environmentName]
  )
  const posture = useMemo(
    () =>
      deriveDeployPosture({
        role,
        base,
        selectedEnvironment,
        version,
        changeSummary,
        validationState,
        environmentContext: environmentState.context,
        applicationName,
        submitting: submitState.kind === 'submitting'
      }),
    [applicationName, base, changeSummary, environmentState.context, role, selectedEnvironment, submitState.kind, validationState, version]
  )
  const readinessItems = useMemo(
    () =>
      buildReadinessItems({
        base,
        selectedEnvironment,
        version,
        changeSummary,
        posture,
        validationState
      }),
    [base, changeSummary, posture, selectedEnvironment, validationState, version]
  )
  const degradedReasons = combineDegradedReasons(baseState, environmentState)
  const pageContextIssues = useMemo(() => {
    if (baseState.kind === 'loading' || baseState.kind === 'failure' || baseState.kind === 'unavailable') return []
    return buildDeployPageContextIssues(posture)
  }, [baseState.kind, posture])

  const handleDeploy = async () => {
    if (posture.primaryActionState !== 'available') return
    setSubmitState({ kind: 'submitting', deploymentId: '', errorMessage: '' })
    const result = await api.post('/deployments', {
      service: applicationName,
      environment: environmentName,
      version,
      changeSummary: changeSummary.trim()
    })
    if (result && result.code) {
      setSubmitState({
        kind: 'error',
        deploymentId: '',
        errorMessage: result.message || 'DXCP could not create the Deployment record.'
      })
      return
    }
    setSubmitState({
      kind: 'success',
      deploymentId: result?.id || '',
      errorMessage: ''
    })
  }

  const secondaryActions = [
    {
      label: baseState.kind === 'refreshing' ? 'Refreshing...' : 'Refresh',
      onClick: () => refreshBase({ bypassCache: true }),
      disabled: baseState.kind === 'loading' || baseState.kind === 'refreshing',
      description: 'Refresh deploy inputs and supporting policy context.'
    }
  ]

  if (baseState.kind === 'failure') {
    return (
      <div className="new-deploy-page">
        <NewExperiencePageHeader
          title="Deploy Application"
          objectIdentity={applicationIdentityLink}
          role={role}
          stateSummaryItems={[{ label: 'Workflow state', value: 'Unavailable' }]}
          primaryAction={{ label: 'Deploy', state: 'unavailable', description: 'Deploy is unavailable on this route.' }}
          secondaryActions={secondaryActions}
          actionNote="Deploy is unavailable until DXCP can load the deploy workflow."
        />
        <NewStateBlock
          eyebrow="Failure"
          title="Deploy workflow could not be loaded"
          tone="danger"
          actions={[
            { label: 'Refresh', onClick: () => refreshBase({ bypassCache: true }) },
            { label: 'Open Application', to: `/new/applications/${applicationName}`, secondary: true }
          ]}
        >
          {baseState.errorMessage || 'DXCP could not load this deploy workflow right now. Refresh to try again.'}
        </NewStateBlock>
      </div>
    )
  }

  if (baseState.kind === 'unavailable') {
    return (
      <div className="new-deploy-page">
        <NewExperiencePageHeader
          title="Deploy Application"
          objectIdentity={applicationIdentityLink}
          role={role}
          stateSummaryItems={[{ label: 'Workflow state', value: 'Unavailable' }]}
          primaryAction={{ label: 'Deploy', state: 'unavailable', description: 'Deploy is unavailable on this route.' }}
          secondaryActions={secondaryActions}
          actionNote="This Application is not available from the accessible DXCP application set on this route."
        />
        <NewStateBlock
          eyebrow="Unavailable route"
          title="Deploy workflow is not available on this route"
          tone="danger"
          actions={[
            { label: 'Open Application', to: `/new/applications/${applicationName}` },
            { label: 'Open Legacy', to: '/services', secondary: true }
          ]}
        >
          {baseState.errorMessage || 'This Application is not available from the accessible DXCP application set on this route.'}
        </NewStateBlock>
      </div>
    )
  }

  return (
    <div className="new-deploy-page">
      <NewExperiencePageHeader
        title="Deploy Application"
        objectIdentity={applicationIdentityLink}
        role={role}
        primaryAction={{
          label: submitState.kind === 'submitting' ? 'Deploying...' : 'Deploy',
          state: posture.primaryActionState,
          onClick: posture.primaryActionState === 'available' ? handleDeploy : undefined,
          description: posture.headerNote
        }}
        secondaryActions={secondaryActions}
        actionNote={posture.headerNote}
      />

      <NewPageContextRail items={pageContextIssues} />

      <div className="new-deploy-layout">
        <SectionCard className="new-deploy-intent-card">
          <div className="new-section-header">
            <div>
              <h3>Intent entry</h3>
              <p className="helper">Define the deployment intent in DXCP product language before any deploy is attempted.</p>
            </div>
          </div>

          {baseState.kind === 'loading' ? (
            <NewStateBlock eyebrow="Loading" title="Loading deploy intent">
              DXCP is loading deployable targets, registered versions, and current policy context for this Application.
            </NewStateBlock>
          ) : (
            <>
              <div className="new-intent-entry-grid">
                <label className="new-field" htmlFor="new-deploy-application">
                  <span>Application</span>
                  <input id="new-deploy-application" value={applicationName} readOnly />
                </label>
                <label className="new-field" htmlFor="new-deploy-environment">
                  <span>Environment</span>
                  <select
                    id="new-deploy-environment"
                    value={environmentName}
                    onChange={(event) => setEnvironmentName(event.target.value)}
                    disabled={posture.primaryActionState === 'read-only'}
                  >
                    <option value="">Choose an environment</option>
                    {(base?.environments || []).map((environment) => (
                      <option key={environment.name} value={environment.name}>
                        {environment.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="new-field" htmlFor="new-deploy-version">
                  <span>Version</span>
                  <select
                    id="new-deploy-version"
                    value={version}
                    onChange={(event) => setVersion(event.target.value)}
                    disabled={posture.primaryActionState === 'read-only'}
                  >
                    <option value="">{base?.versions?.length > 1 ? 'Choose a version' : 'No registered version'}</option>
                    {(base?.versions || []).map((item) => (
                      <option key={item.version} value={item.version}>
                        {item.version}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="new-field new-field-full" htmlFor="new-deploy-change-summary">
                  <span>Change summary</span>
                  <textarea
                    id="new-deploy-change-summary"
                    value={changeSummary}
                    onChange={(event) => setChangeSummary(event.target.value)}
                    onInput={(event) => setChangeSummary(event.currentTarget.value)}
                    readOnly={posture.primaryActionState === 'read-only'}
                    rows={4}
                    placeholder="Summarize the change this deploy will make."
                  />
                </label>
              </div>

              {environmentState.context?.policySummary?.resolvedRecipe ? (
                <div className="new-explanation-stack">
                  <NewExplanation title="Resolved delivery behavior" tone="neutral">
                    {environmentState.context.policySummary.resolvedRecipe.effectiveBehaviorSummary || 'DXCP resolved a delivery behavior for this service and environment.'}
                  </NewExplanation>
                </div>
              ) : null}

              {(base?.unavailableEnvironments || []).length > 0 ? (
                <div className="new-explanation-stack">
                  <NewExplanation title="Unavailable deploy targets" tone="warning">
                    {`${base.unavailableEnvironments.map((environment) => environment.label).join(', ')} ${base.unavailableEnvironments.length === 1 ? 'is' : 'are'} not available for new deploy targets on this route, so DXCP keeps ${base.unavailableEnvironments.length === 1 ? 'it' : 'them'} out of the environment picker.`}
                  </NewExplanation>
                </div>
              ) : null}

              <div className="new-deploy-action-review">
                <NewExplanation title={posture.local.title} tone={posture.local.tone} actions={posture.local.actions}>
                  {posture.local.body}
                </NewExplanation>
              </div>

              {submitState.kind === 'success' ? (
                <NewExplanation
                  title="Deployment created"
                  tone="neutral"
                  actions={[
                    { label: 'Open Deployment', to: `/new/deployments/${submitState.deploymentId}` },
                    { label: 'Open Legacy Deployment', to: `/deployments/${submitState.deploymentId}`, secondary: true },
                    { label: 'Open Application', to: `/new/applications/${applicationName}`, secondary: true }
                  ]}
                >
                  {submitState.deploymentId
                    ? `DXCP created Deployment ${submitState.deploymentId}. Use the deployment record to follow progress from the new deployment detail route.`
                    : 'DXCP created the Deployment record. Use the deployment record to follow progress from the new deployment detail route.'}
                </NewExplanation>
              ) : null}

              {submitState.kind === 'error' ? (
                <NewExplanation title="Deploy could not be created" tone="danger">
                  {submitState.errorMessage || 'DXCP could not create the Deployment record.'}
                </NewExplanation>
              ) : null}

              <div className="new-section-header">
                <div>
                  <h3>Readiness review</h3>
                  <p className="helper">Required readiness conditions stay visible before deploy so DXCP never relies on a generic failure after submit.</p>
                </div>
              </div>

              <div className="new-readiness-list" aria-label="Deploy readiness conditions">
                {readinessItems.map((item, index) => (
                  <div key={`${item.label}-${index}`} className={readinessClass(item.status)}>
                    <strong>{item.label}</strong>
                    <span>{readinessLabel(item.status)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </SectionCard>

        <div className="new-deploy-support-stack">
          <SectionCard>
            <h3>Policy and guardrails</h3>
            <p className="helper">Supporting policy context stays secondary to the intent entry and readiness review.</p>

            <dl className="new-application-support-grid">
              <dt>Deployment Group</dt>
              <dd>{base?.deliveryGroup?.name || 'Not assigned'}</dd>
              <dt>Deployable environments</dt>
              <dd>
                {(base?.environments || []).length > 0
                  ? base.environments.map((environment) => environment.label).join(', ')
                  : 'No enabled environment is currently available.'}
              </dd>
              <dt>Deployable versions</dt>
              <dd>
                {base?.versions?.length > 0
                  ? `${base.versions.length} registered version${base.versions.length === 1 ? '' : 's'} available`
                  : 'No registered version is currently available.'}
              </dd>
              <dt>Resolved delivery behavior</dt>
              <dd>
                {environmentState.context?.policySummary?.resolvedRecipe?.name || 'DXCP resolves delivery behavior after an environment is selected.'}
              </dd>
            </dl>

            {(base?.guardrails || []).length > 0 ? (
              <ul className="new-supporting-list">
                {base.guardrails.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : (
              <NewExplanation title="Guardrail context is limited" tone="warning">
                DXCP could not fully resolve guardrail context for this Application on this route.
              </NewExplanation>
            )}

            {environmentState.context?.policySummary?.policy ? (
              <div className="new-explanation-stack">
                <NewExplanation title="Current policy snapshot" tone="neutral">
                  {`DXCP currently sees ${environmentState.context.policySummary.policy.current_concurrent_deployments} active deployment${environmentState.context.policySummary.policy.current_concurrent_deployments === 1 ? '' : 's'} out of ${environmentState.context.policySummary.policy.max_concurrent_deployments}, with ${environmentState.context.policySummary.policy.deployments_remaining} deploy${environmentState.context.policySummary.policy.deployments_remaining === 1 ? '' : 's'} remaining in the daily quota.`}
                </NewExplanation>
              </div>
            ) : null}
          </SectionCard>

          <SectionCard>
            <h3>Workflow clarity</h3>
            <p className="helper">DXCP expresses deploy intent and the resulting deployment record without exposing execution-engine mechanics.</p>

            <div className="new-explanation-stack">
              <NewExplanation title="What Deploy creates" tone="neutral">
                Deploy creates a Deployment record for this Application, Environment, Version, and change summary. The resulting Deployment record also captures the resolved delivery behavior used for execution.
              </NewExplanation>
              <NewExplanation title="Current handoff posture" tone="neutral">
                Supporting policy context remains available here, but it stays subordinate to the action-first deploy task and readiness review.
              </NewExplanation>
              {degradedReasons.length > 0 ? (
                <NewExplanation title="Supporting reads are degraded" tone="warning">
                  {degradedReasons.join(' ')}
                </NewExplanation>
              ) : null}
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  )
}
