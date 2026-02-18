import React from 'react'
import PageHeader from '../components/PageHeader.jsx'
import SectionCard from '../components/SectionCard.jsx'
import TwoColumn from '../components/TwoColumn.jsx'

export default function DeployPage({
  refreshData,
  refreshing,
  deployStep,
  service,
  services,
  loadServices,
  setService,
  setDeployStep,
  currentDeliveryGroup,
  filteredRecipes,
  recipeId,
  setRecipeId,
  setRecipeAutoApplied,
  selectedRecipe,
  recipeAutoApplied,
  selectedRecipeDeprecated,
  versionMode,
  version,
  setVersion,
  setVersionMode,
  setVersionSelection,
  setVersionAutoApplied,
  versions,
  versionsLoading,
  versionsRefreshing,
  versionsError,
  selectedBuildDetails,
  selectedBuildDetailsLoading,
  selectedBuildDetailsError,
  formatTime,
  validVersion,
  versionAutoApplied,
  versionUnverifiable,
  changeSummary,
  setChangeSummary,
  preflightResult,
  preflightStatus,
  preflightError,
  preflightErrorHeadline,
  policySummary,
  policySummaryStatus,
  policySummaryError,
  debugDeployGatesEnabled,
  canDeploy,
  canRunPreflight,
  deployDisabledReason,
  canReviewDeploy,
  handleReviewDeploy,
  deployInlineMessage,
  deployInlineHeadline,
  selectedRecipeNarrative,
  policyQuotaStats,
  handleDeploy,
  policyDeploymentsLoading,
  policyDeploymentsError,
  deployResult,
  latestPolicyDeployment,
  statusClass,
  isPlatformAdmin,
  openDeployment,
  versionVerified,
  trimmedChangeSummary,
  environmentLabel,
  environmentNotice,
  headerMeta
}) {
  const [artifactCopyState, setArtifactCopyState] = React.useState('')
  const policySnapshot = preflightResult?.policy || policySummary?.policy || null
  const deploysRemaining =
    policySnapshot?.deployments_remaining ??
    (currentDeliveryGroup?.guardrails?.daily_deploy_quota
      ? Math.max(currentDeliveryGroup.guardrails.daily_deploy_quota - policyQuotaStats.deployUsed, 0)
      : '-')
  const rollbacksRemaining = currentDeliveryGroup?.guardrails?.daily_rollback_quota
    ? Math.max(currentDeliveryGroup.guardrails.daily_rollback_quota - policyQuotaStats.rollbackUsed, 0)
    : '-'
  const latestDeployment = deployResult || latestPolicyDeployment
  const recipeCompatibility = selectedRecipe
    ? filteredRecipes.some((recipe) => recipe.id === selectedRecipe.id)
      ? 'Compatible'
      : 'Incompatible'
    : '-'
  const shortGitSha = selectedBuildDetails?.git_sha ? String(selectedBuildDetails.git_sha).slice(0, 10) : '-'
  const artifactRef = selectedBuildDetails?.artifactRef || ''
  const artifactName = artifactRef ? artifactRef.split('/').filter(Boolean).pop() || artifactRef : '-'
  const selectedRecipeForPanel = selectedRecipe || (filteredRecipes.length > 0 ? filteredRecipes[0] : null)

  React.useEffect(() => {
    setArtifactCopyState('')
  }, [artifactRef])

  const handleCopyArtifactRef = async () => {
    if (!artifactRef) return
    try {
      const clipboardApi =
        typeof window !== 'undefined' && window.navigator ? window.navigator.clipboard : null
      if (clipboardApi?.writeText) {
        await clipboardApi.writeText(artifactRef)
        setArtifactCopyState('Copied full artifact reference.')
        return
      }
    } catch (err) {
      // Fall through to legacy fallback.
    }
    try {
      if (typeof document === 'undefined') {
        setArtifactCopyState('Copy unavailable in this browser.')
        return
      }
      const input = document.createElement('input')
      input.value = artifactRef
      input.setAttribute('readonly', '')
      input.style.position = 'absolute'
      input.style.left = '-9999px'
      document.body.appendChild(input)
      input.select()
      const copied = Boolean(document.execCommand && document.execCommand('copy'))
      document.body.removeChild(input)
      setArtifactCopyState(copied ? 'Copied full artifact reference.' : 'Copy unavailable in this browser.')
    } catch (err) {
      setArtifactCopyState('Copy unavailable in this browser.')
    }
  }

  return (
    <TwoColumn
      header={
        <PageHeader
          title="Deploy intent"
          meta={headerMeta}
          actions={
            <button className="button secondary" onClick={refreshData} disabled={refreshing}>
              {refreshing ? 'Refreshing...' : 'Refresh data'}
            </button>
          }
        />
      }
      primary={
        <SectionCard>
        {deployStep === 'form' && (
          <>
            {/* Stable E2E selectors for deploy flow inputs */}
            <div className="field">
              <label>Deployable service</label>
              <select
                data-testid="deploy-service-select"
                value={service}
                onFocus={() => {
                  if (services.length === 0) loadServices()
                }}
                onChange={(e) => {
                  setService(e.target.value)
                  setDeployStep('form')
                }}
              >
                {services.length === 0 && <option value="">No deployable services</option>}
                {services.map((svc) => (
                  <option key={svc.service_name} value={svc.service_name}>
                    {svc.service_name}
                  </option>
                ))}
              </select>
              <div className="helper">Services are allowlisted and scoped by delivery group policy.</div>
              {environmentNotice && <div className="helper">{environmentNotice}</div>}
            </div>
            <div className="field" data-testid="deploy-recipe-select">
              <label>Strategy recipe</label>
              <div className="helper">Recipes must be compatible with the service and allowed by the delivery group.</div>
              {!currentDeliveryGroup && <div className="helper">No delivery group assigned.</div>}
              {currentDeliveryGroup && filteredRecipes.length === 0 && (
                <div className="helper">No compatible recipes are allowed for this service.</div>
              )}
              {filteredRecipes.length > 0 && (
                <div className="list space-8">
                  <div className="list-item recipe-selector">
                    <fieldset className="recipe-selector-options">
                      <legend className="helper">Available recipes</legend>
                      {filteredRecipes.map((recipe) => {
                        const revision = recipe.recipe_revision ?? 1
                        const isSelected = recipeId === recipe.id
                        return (
                          <label className="recipe-option" key={recipe.id}>
                            <input
                              type="radio"
                              name="deploy-recipe"
                              value={recipe.id}
                              checked={isSelected}
                              onChange={(e) => {
                                setRecipeId(e.target.value)
                                setRecipeAutoApplied(false)
                                setDeployStep('form')
                              }}
                            />
                            <span>{recipe.name || recipe.id}</span>
                            <span className="helper">v{revision}</span>
                            {recipe.status === 'deprecated' && <span className="helper">Deprecated</span>}
                          </label>
                        )
                      })}
                    </fieldset>
                    <div className="recipe-selector-detail">
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'baseline', flexWrap: 'wrap' }}>
                        <strong>{selectedRecipeForPanel?.name || selectedRecipeForPanel?.id || '-'}</strong>
                        <span className="helper">
                          v{selectedRecipeForPanel?.recipe_revision ?? 1}
                        </span>
                        {selectedRecipeForPanel?.status === 'deprecated' && <span className="helper">Deprecated</span>}
                      </div>
                      <div className="helper space-4">
                        {selectedRecipeForPanel?.effective_behavior_summary || 'No behavior summary provided.'}
                      </div>
                      <div className="helper space-4">
                        {selectedRecipeForPanel?.description || 'Strategy recipe'}
                      </div>
                    </div>
                  </div>
                </div>
              )}
              {recipeAutoApplied && selectedRecipe && (
                <div className="helper">Default applied (only option): {selectedRecipe.name || selectedRecipe.id}</div>
              )}
              {filteredRecipes.length > 1 && !recipeId && (
                <div className="helper">Select a strategy to continue.</div>
              )}
              {selectedRecipeDeprecated && (
                <div className="helper">Selected recipe is deprecated and cannot be used for new deployments.</div>
              )}
            </div>
            <div className="field">
                <label htmlFor="deploy-version">Version</label>
                <select
                  id="deploy-version"
                  data-testid="deploy-version-select"
                  value={versionMode === 'auto' ? (version || '__select__') : '__custom__'}
                  onChange={(e) => {
                    if (e.target.value === '__custom__') {
                      setVersionMode('custom')
                      setVersionSelection('user')
                      setVersionAutoApplied(false)
                      setDeployStep('form')
                    } else if (e.target.value === '__select__') {
                      setVersionMode('auto')
                      setVersion('')
                      setVersionSelection('none')
                      setVersionAutoApplied(false)
                      setDeployStep('form')
                    } else {
                      setVersionMode('auto')
                      setVersion(e.target.value)
                      setVersionSelection('user')
                      setVersionAutoApplied(false)
                      setDeployStep('form')
                    }
                  }}
                >
                  <option value="__select__">Select discovered version</option>
                  {versions.map((item) => (
                    <option key={item.version} value={item.version}>
                      {item.version}
                    </option>
                  ))}
                  <option value="__custom__">Custom (registered)</option>
                </select>
                {versionMode === 'custom' && (
                  <input
                    className="space-8"
                    value={version}
                    onChange={(e) => {
                      setVersion(e.target.value)
                      setVersionSelection('user')
                      setVersionAutoApplied(false)
                      setDeployStep('form')
                    }}
                    placeholder="Enter a registered version"
                  />
                )}
                <div className="helper">
                  Format: 1.2.3 or 1.2.3-suffix. {validVersion ? 'Valid' : 'Invalid'}
                </div>
                {versionAutoApplied && version && <div className="helper">Default applied: {version}</div>}
                {versionsLoading && <div className="helper">Loading versions...</div>}
                {versionsRefreshing && <div className="helper">Refreshing versions...</div>}
                {versionsError && <div className="helper">{versionsError}</div>}
                {!versionsLoading && !versionsRefreshing && !versionsError && versions.length > 0 && (
                  <div className="helper">Latest discovered: {versions[0].version}</div>
                )}
                {versionMode === 'custom' && versionUnverifiable && (
                  <div className="helper">Custom versions must already be registered and discoverable.</div>
                )}
                {service && version && (
                  <>
                    <label className="space-12">Build Provenance</label>
                    {selectedBuildDetailsLoading && <div className="helper">Loading provenance...</div>}
                    {!selectedBuildDetailsLoading && selectedBuildDetailsError && (
                      <div className="helper">Build provenance unavailable for this version.</div>
                    )}
                    {!selectedBuildDetailsLoading && !selectedBuildDetailsError && selectedBuildDetails && (
                      <>
                        <div className="list space-8">
                          <div className="list-item provenance-block">
                            <div>
                              <dl className="definition-grid">
                                <dt>Publisher</dt>
                                <dd className="helper">{selectedBuildDetails.ci_publisher || '-'}</dd>
                                <dt>Git SHA</dt>
                                <dd className="helper" title={selectedBuildDetails.git_sha || undefined}>
                                  {shortGitSha || '-'}
                                </dd>
                                <dt>Registered</dt>
                                <dd className="helper">
                                  {selectedBuildDetails.registeredAt ? formatTime(selectedBuildDetails.registeredAt) : '-'}
                                </dd>
                                <dt>Artifact</dt>
                                <dd className="helper" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                  <span title={artifactRef || undefined}>{artifactName}</span>
                                  {artifactRef && (
                                    <button
                                      type="button"
                                      className="button secondary"
                                      style={{ padding: '4px 6px', fontSize: '11px', display: 'inline-flex', alignItems: 'center' }}
                                      onClick={handleCopyArtifactRef}
                                      aria-label="Copy full artifact reference"
                                      title="Copy full artifact reference"
                                    >
                                      <svg
                                        width="12"
                                        height="12"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        aria-hidden="true"
                                      >
                                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                                      </svg>
                                    </button>
                                  )}
                                </dd>
                              </dl>
                              {artifactCopyState && <div className="helper space-4">{artifactCopyState}</div>}
                              <dl className="definition-grid space-8">
                                <dt>CI Provider</dt>
                                <dd className="helper">{selectedBuildDetails.ci_provider || '-'}</dd>
                                <dt>Run ID</dt>
                                <dd className="helper">{selectedBuildDetails.ci_run_id || '-'}</dd>
                              </dl>
                            </div>
                          </div>
                        </div>
                      </>
                    )}
                  </>
                )}
            </div>
            <div className="field">
              <label htmlFor="change-summary">Change summary</label>
              <input
                id="change-summary"
                data-testid="deploy-change-summary"
                value={changeSummary}
                onChange={(e) => {
                  setChangeSummary(e.target.value)
                  setDeployStep('form')
                }}
                onInput={(e) => {
                  setChangeSummary(e.target.value)
                  setDeployStep('form')
                }}
              />
              {!changeSummary.trim() && <div className="helper">Required for audit trails.</div>}
            </div>
            <div className="helper space-12">Policy checks</div>
            <div className="list space-8">
              <div className="list-item two-col">
                <div>Deploys remaining today</div>
                <div>{deploysRemaining}</div>
              </div>
              <div className="list-item two-col">
                <div>Concurrent deployments</div>
                <div>
                  {policySnapshot
                    ? `${policySnapshot.current_concurrent_deployments} / ${policySnapshot.max_concurrent_deployments}`
                    : '-'}
                </div>
              </div>
              <div className="list-item two-col">
                <div>Recipe compatibility</div>
                <div>{recipeCompatibility}</div>
              </div>
              <div className="list-item two-col">
                <div>Version status</div>
                <div>
                  {preflightResult?.versionRegistered
                    ? 'Registered'
                    : versionVerified
                      ? 'Registered'
                      : version
                        ? 'Unverified'
                        : '-'}
                </div>
              </div>
            </div>
            {preflightStatus === 'checking' && (
              <div className="helper space-8">
                Checking policy and guardrails...
              </div>
            )}
            {policySummaryStatus === 'checking' && (
              <div className="helper space-8">
                Loading policy summary...
              </div>
            )}
            {policySummaryStatus === 'error' && policySummaryError && (
              <div className="helper space-8">
                {policySummaryError}
              </div>
            )}
            {preflightStatus === 'error' && preflightError && (
              <div className="helper space-8">
                {preflightErrorHeadline && <strong>{preflightErrorHeadline}. </strong>}
                {preflightError}
              </div>
            )}
            {debugDeployGatesEnabled && (
              <div className="helper space-8">
                Deploy gates:{' '}
                {[
                  `canDeploy=${String(canDeploy)}`,
                  `canRunPreflight=${String(canRunPreflight)}`,
                  `preflightStatus=${preflightStatus}`,
                  `validVersion=${String(validVersion)}`,
                  `versionVerified=${String(versionVerified)}`,
                  `recipeId=${recipeId || '-'}`,
                  `changeSummary=${trimmedChangeSummary ? 'set' : 'empty'}`
                ].join(', ')}
              </div>
            )}
            <button
              className="button"
              data-testid="deploy-review-button"
              onClick={handleReviewDeploy}
              disabled={!canReviewDeploy || preflightStatus === 'checking'}
              title={!canDeploy ? deployDisabledReason : ''}
            >
              {preflightStatus === 'checking' ? 'Checking policy...' : 'Review deploy'}
            </button>
            {!canDeploy && (
              <div className="helper space-8">
                Deploy disabled. {deployDisabledReason}
              </div>
            )}
            {canDeploy && !changeSummary.trim() && (
              <div className="helper space-8">
                Change summary is required.
              </div>
            )}
            {versionUnverifiable && (
              <div className="helper space-8">
                Custom versions must match a registered build before you can deploy.
              </div>
            )}
            {deployInlineMessage && (
              <div className="helper space-8">
                {deployInlineHeadline && <strong>{deployInlineHeadline}. </strong>}
                {deployInlineMessage}
              </div>
            )}
          </>
        )}
        {deployStep === 'confirm' && (
          <>
            <h3>Confirm deploy</h3>
            <div className="list space-12">
              <div className="list-item">
                <div>Service</div>
                <div>{service || '-'}</div>
              </div>
              <div className="list-item">
                <div>Recipe</div>
                <div>{selectedRecipe?.name || selectedRecipe?.id || '-'}</div>
              </div>
              <div className="list-item">
                <div>Recipe revision</div>
                <div>{selectedRecipe?.recipe_revision ? `v${selectedRecipe.recipe_revision}` : '-'}</div>
              </div>
              <div className="list-item">
                <div>Behavior summary</div>
                <div>{selectedRecipe?.effective_behavior_summary || '-'}</div>
              </div>
              <div className="list-item">
                <div>Success means</div>
                <div>{selectedRecipeNarrative.success}</div>
              </div>
              <div className="list-item">
                <div>Rollback means</div>
                <div>{selectedRecipeNarrative.rollback}</div>
              </div>
              <div className="list-item">
                <div>Version</div>
                <div>{version || '-'}</div>
              </div>
              <div className="list-item">
                <div>Environment</div>
                <div>{environmentLabel}</div>
              </div>
            </div>
            <div className="helper space-12">Guardrails</div>
            <div className="list">
              <div className="list-item">
                <div>Max concurrent deployments</div>
                <div>{currentDeliveryGroup?.guardrails?.max_concurrent_deployments || '-'}</div>
              </div>
              <div className="list-item">
                <div>Daily deploy quota</div>
                <div>{currentDeliveryGroup?.guardrails?.daily_deploy_quota || '-'}</div>
              </div>
              <div className="list-item">
                <div>Deploys remaining today</div>
                <div>
                  {deploysRemaining}
                </div>
              </div>
              <div className="list-item">
                <div>Daily rollback quota</div>
                <div>{currentDeliveryGroup?.guardrails?.daily_rollback_quota || '-'}</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px' }} className="space-12">
              <button
                className="button"
                data-testid="deploy-confirm-button"
                onClick={handleDeploy}
                disabled={!canReviewDeploy}
              >
                Confirm deploy
              </button>
              <button className="button secondary" onClick={() => setDeployStep('form')}>
                Back to edit
              </button>
            </div>
            {deployInlineMessage && (
              <div className="helper space-8">
                {deployInlineHeadline && <strong>{deployInlineHeadline}. </strong>}
                {deployInlineMessage}
              </div>
            )}
          </>
        )}
        </SectionCard>
      }
      secondary={
        <SectionCard>
        <h2>Policy context</h2>
        {!currentDeliveryGroup && <div className="helper">Service is not assigned to a delivery group.</div>}
        {currentDeliveryGroup && (
          <>
            <div className="list">
              <div className="list-item two-col">
                <div>Delivery group</div>
                <div>{currentDeliveryGroup.name}</div>
              </div>
              <div className="list-item two-col">
                <div>Owner</div>
                <div>{currentDeliveryGroup.owner || 'Unassigned'}</div>
              </div>
            </div>
          <div className="helper space-12">Guardrails</div>
          <div className="list">
            <div className="list-item two-col">
              <div>Max concurrent deployments</div>
              <div>{currentDeliveryGroup.guardrails?.max_concurrent_deployments || '-'}</div>
            </div>
            <div className="list-item two-col">
              <div>Daily deploy quota</div>
              <div>{currentDeliveryGroup.guardrails?.daily_deploy_quota || '-'}</div>
            </div>
            <div className="list-item two-col">
              <div>Deploys remaining today</div>
              <div>
                {deploysRemaining}
              </div>
            </div>
            <div className="list-item two-col">
              <div>Daily rollback quota</div>
              <div>{currentDeliveryGroup.guardrails?.daily_rollback_quota || '-'}</div>
            </div>
            <div className="list-item two-col">
              <div>Rollbacks remaining today</div>
              <div>
                {currentDeliveryGroup.guardrails?.daily_rollback_quota
                  ? rollbacksRemaining
                  : '-'}
              </div>
            </div>
          </div>
          {policyDeploymentsLoading && <div className="helper space-8">Loading quota usage...</div>}
          {policyDeploymentsError && <div className="helper space-8">{policyDeploymentsError}</div>}
          <div className="helper space-12">Recipe</div>
          <div className="list">
            <div className="list-item two-col">
              <div>Selected</div>
              <div>{selectedRecipe?.name || 'None'}</div>
            </div>
            <div className="list-item two-col">
              <div>Description</div>
              <div>{selectedRecipe?.description || 'No description'}</div>
            </div>
            </div>
          </>
        )}
        </SectionCard>
      }
      footer={
        <SectionCard>
        <h2>Latest deployment</h2>
        {latestDeployment ? (
          <div>
            <div className={statusClass(latestDeployment.state)}>{latestDeployment.state}</div>
            <p>Service: {latestDeployment.service}</p>
            <p>Version: {latestDeployment.version}</p>
            <p>Environment: {environmentLabel}</p>
            <p>Deployment id: {latestDeployment.id}</p>
            {isPlatformAdmin && latestDeployment.engineExecutionId && (
              <p>Execution id: {latestDeployment.engineExecutionId}</p>
            )}
            <button className="button secondary" onClick={() => openDeployment(latestDeployment)}>
              View detail
            </button>
          </div>
        ) : (
          <div className="helper">No deployment created yet.</div>
        )}
        </SectionCard>
      }
    />
  )
}
