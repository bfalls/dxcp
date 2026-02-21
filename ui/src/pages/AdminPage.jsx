import React from 'react'
import PageHeader from '../components/PageHeader.jsx'
import SectionCard from '../components/SectionCard.jsx'

function parseOwnerEmails(ownerValue) {
  if (!ownerValue) return []
  return String(ownerValue)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function summarizeOwners(ownerValue) {
  const owners = parseOwnerEmails(ownerValue)
  if (owners.length === 0) return 'Owners: 0'
  if (owners.length <= 2) return `Owners: ${owners.join(', ')}`
  return `Owners: ${owners[0]}, ${owners[1]} +${owners.length - 2}`
}

function normalizedOwnersPreview(ownerValue) {
  const owners = parseOwnerEmails(ownerValue)
  if (owners.length === 0) return ''
  return owners.join(', ')
}

export default function AdminPage({
  adminReadOnly,
  adminTab,
  setAdminTab,
  isPlatformAdmin,
  startAdminGroupCreate,
  deliveryGroups,
  summarizeGuardrails,
  setAdminGroupMode,
  setAdminGroupId,
  setAdminGroupError,
  setAdminGroupNote,
  startAdminGroupEdit,
  adminGroupMode,
  activeAdminGroup,
  formatAuditValue,
  getRecipeLabel,
  adminGroupDraft,
  handleAdminGroupDraftChange,
  adminGroupSaving,
  validateAdminGroupDraft,
  adminGroupValidation,
  adminGroupConfirmWarning,
  setAdminGroupConfirmWarning,
  sortedServiceNames,
  toggleAdminGroupService,
  sortedRecipes,
  toggleAdminGroupRecipe,
  handleAdminGuardrailChange,
  adminSettings,
  adminServiceDiff,
  adminRecipeDiff,
  adminServiceConflicts,
  adminGroupError,
  adminGroupNote,
  saveAdminGroup,
  setAdminGroupDraft,
  buildGroupDraft,
  adminGuardrailDefaults,
  startAdminRecipeCreate,
  recipes,
  recipeUsageCounts,
  recipeStatusLabel,
  setAdminRecipeMode,
  setAdminRecipeId,
  setAdminRecipeError,
  setAdminRecipeNote,
  startAdminRecipeEdit,
  adminRecipeMode,
  activeAdminRecipe,
  activeAdminRecipeUsage,
  adminRecipeDraft,
  handleAdminRecipeDraftChange,
  adminRecipeSaving,
  validateAdminRecipeDraft,
  adminRecipeValidation,
  adminRecipeConfirmWarning,
  setAdminRecipeConfirmWarning,
  adminRecipeError,
  adminRecipeNote,
  saveAdminRecipe,
  setAdminRecipeDraft,
  buildRecipeDraft,
  loadAuditEvents,
  auditLoading,
  auditError,
  auditEvents,
  systemRateLimitDraft,
  handleSystemRateLimitDraftChange,
  saveSystemRateLimits,
  loadSystemRateLimits,
  systemRateLimitLoading,
  systemRateLimitSaving,
  systemRateLimitDirty,
  systemRateLimitError,
  systemRateLimitNote,
  systemCiPublishersDraft,
  handleSystemCiPublishersDraftChange,
  saveSystemCiPublishers,
  loadSystemCiPublishers,
  systemCiPublishersList,
  systemCiPublishersLoading,
  systemCiPublishersSaving,
  systemCiPublishersDirty,
  systemCiPublishersError,
  systemCiPublishersNote,
  systemUiExposurePolicyDraft,
  handleSystemUiExposurePolicyToggle,
  saveSystemUiExposurePolicy,
  loadSystemUiExposurePolicy,
  systemUiExposurePolicyLoading,
  systemUiExposurePolicySaving,
  systemUiExposurePolicyDirty,
  systemUiExposurePolicyError,
  systemUiExposurePolicyNote,
  mutationsDisabled,
  systemMutationsDisabled,
  systemMutationsDisabledLoading,
  systemMutationsDisabledSaving,
  systemMutationsDisabledError,
  systemMutationsDisabledNote,
  loadSystemMutationsDisabled,
  saveSystemMutationsDisabled,
  whoamiData,
  whoamiLoading,
  whoamiError,
  loadWhoAmI,
  copyAccessTokenToClipboard
}) {
  const [copyTokenBusy, setCopyTokenBusy] = React.useState(false)
  const [copyTokenNote, setCopyTokenNote] = React.useState('')
  const [copyTokenError, setCopyTokenError] = React.useState('')
  const [killSwitchDialogOpen, setKillSwitchDialogOpen] = React.useState(false)
  const [killSwitchPhrase, setKillSwitchPhrase] = React.useState('')
  const [killSwitchReason, setKillSwitchReason] = React.useState('')
  const [killSwitchStepConfirmed, setKillSwitchStepConfirmed] = React.useState(false)

  const handleCopyAccessToken = async () => {
    setCopyTokenBusy(true)
    setCopyTokenNote('')
    setCopyTokenError('')
    const result = await copyAccessTokenToClipboard()
    if (result?.ok) {
      setCopyTokenNote(result.message || 'Copied.')
    } else {
      setCopyTokenError(result?.message || 'Copy failed. Use DevTools header copy instead.')
    }
    setCopyTokenBusy(false)
  }

  const openKillSwitchDialog = () => {
    if (adminReadOnly || systemMutationsDisabledLoading || systemMutationsDisabledSaving) return
    setKillSwitchDialogOpen(true)
    setKillSwitchPhrase('')
    setKillSwitchReason('')
    setKillSwitchStepConfirmed(false)
  }

  const closeKillSwitchDialog = () => {
    if (systemMutationsDisabledSaving) return
    setKillSwitchDialogOpen(false)
    setKillSwitchPhrase('')
    setKillSwitchReason('')
    setKillSwitchStepConfirmed(false)
  }

  const currentlyDisabled = systemMutationsDisabled === true
  const disablingMutations = !currentlyDisabled
  const disablePhraseRequired = 'DISABLE MUTATIONS'
  const phraseAccepted = !disablingMutations || killSwitchPhrase === disablePhraseRequired
  const canAcknowledgeStepOne = phraseAccepted && !systemMutationsDisabledSaving
  const canConfirmKillSwitchChange =
    killSwitchStepConfirmed &&
    phraseAccepted &&
    !systemMutationsDisabledSaving &&
    !systemMutationsDisabledLoading

  const confirmKillSwitchChange = async () => {
    if (!canConfirmKillSwitchChange) return
    const ok = await saveSystemMutationsDisabled(disablingMutations, killSwitchReason)
    if (ok) {
      setKillSwitchDialogOpen(false)
      setKillSwitchPhrase('')
      setKillSwitchReason('')
      setKillSwitchStepConfirmed(false)
    }
  }

  const headerAction =
    adminTab === 'delivery-groups'
      ? (
          <button className="button secondary" onClick={startAdminGroupCreate} disabled={adminReadOnly}>
            Create group
          </button>
        )
      : adminTab === 'recipes'
        ? (
            <button className="button secondary" onClick={startAdminRecipeCreate} disabled={adminReadOnly}>
              Create recipe
            </button>
          )
        : adminTab === 'audit' && isPlatformAdmin
          ? (
              <button className="button secondary" onClick={loadAuditEvents} disabled={auditLoading}>
                {auditLoading ? 'Loading...' : 'Refresh'}
              </button>
            )
          : adminTab === 'system-settings' && isPlatformAdmin
            ? (
                <button
                  className="button secondary"
                  onClick={() => {
                    loadSystemRateLimits({ force: true })
                    loadSystemCiPublishers({ force: true })
                    loadSystemUiExposurePolicy({ force: true })
                    loadSystemMutationsDisabled({ force: true })
                    loadWhoAmI({ force: true })
                  }}
                  disabled={
                    systemRateLimitLoading ||
                    systemRateLimitSaving ||
                    systemCiPublishersLoading ||
                    systemCiPublishersSaving ||
                    systemUiExposurePolicyLoading ||
                    systemUiExposurePolicySaving ||
                    systemMutationsDisabledLoading ||
                    systemMutationsDisabledSaving ||
                    whoamiLoading
                  }
                >
                  {systemRateLimitLoading ||
                  systemCiPublishersLoading ||
                  systemUiExposurePolicyLoading ||
                  systemMutationsDisabledLoading ||
                  whoamiLoading
                    ? 'Loading...'
                    : 'Refresh'}
                </button>
              )
          : null

  const summarizePublisherRules = (publisher) => {
    const counts = [
      ['iss', Array.isArray(publisher?.issuers) ? publisher.issuers.length : 0],
      ['aud', Array.isArray(publisher?.audiences) ? publisher.audiences.length : 0],
      ['azp', Array.isArray(publisher?.authorized_party_azp) ? publisher.authorized_party_azp.length : 0],
      ['sub', Array.isArray(publisher?.subjects) ? publisher.subjects.length : 0],
      ['sub_prefix', Array.isArray(publisher?.subject_prefixes) ? publisher.subject_prefixes.length : 0],
      ['email', Array.isArray(publisher?.emails) ? publisher.emails.length : 0]
    ]
    return counts.map(([label, count]) => `${label}:${count}`).join(' ')
  }

  return (
    <div className="shell two-column">
      <div className="page-header-zone">
        <PageHeader title="Admin" actions={headerAction} />
        {adminReadOnly && <div className="helper">Only Platform Admins can modify this.</div>}
        <div className="helper">
          Mutations: <strong>{mutationsDisabled ? 'DISABLED' : 'ENABLED'}</strong>
        </div>
        <div className="tabs">
          <button
            className={adminTab === 'delivery-groups' ? 'active' : ''}
            onClick={() => setAdminTab('delivery-groups')}
          >
            Delivery Groups
          </button>
          <button
            className={adminTab === 'recipes' ? 'active' : ''}
            onClick={() => setAdminTab('recipes')}
          >
            Recipes
          </button>
          {isPlatformAdmin && (
            <button
              className={adminTab === 'audit' ? 'active' : ''}
              onClick={() => setAdminTab('audit')}
            >
              Audit
            </button>
          )}
          {isPlatformAdmin && (
            <button
              className={adminTab === 'system-settings' ? 'active' : ''}
              onClick={() => setAdminTab('system-settings')}
            >
              System Settings
            </button>
          )}
        </div>
      </div>
      {adminTab === 'delivery-groups' && (
        <>
          <SectionCard>
            <h2>Delivery groups</h2>
            {deliveryGroups.length === 0 && <div className="helper">No delivery groups available.</div>}
            {deliveryGroups.length > 0 && (
              <div className="list space-12">
                {deliveryGroups.map((group) => (
                  <div className="list-item admin-group" key={group.id}>
                    <div>
                      <strong>{group.name}</strong>
                      <div className="helper">{group.id}</div>
                    </div>
                    <div>{summarizeOwners(group.owner)}</div>
                    <div>{Array.isArray(group.services) ? `${group.services.length} services` : '0 services'}</div>
                    <div>{summarizeGuardrails(group.guardrails)}</div>
                    <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                      <button
                        className="button secondary"
                        onClick={() => {
                          setAdminGroupMode('view')
                          setAdminGroupId(group.id)
                          setAdminGroupError('')
                          setAdminGroupNote('')
                        }}
                      >
                        View
                      </button>
                      <button className="button secondary" onClick={() => startAdminGroupEdit(group)} disabled={adminReadOnly}>
                        Edit
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
          <SectionCard>
            {adminGroupMode === 'view' && activeAdminGroup && (
              <>
                <h2>Group detail</h2>
                <div className="helper">Delivery group details and policy context.</div>
                <div className="list space-12">
                  <div className="list-item admin-detail">
                    <div>Name</div>
                    <div>{activeAdminGroup.name}</div>
                  </div>
                  <div className="list-item admin-detail">
                    <div>Owner emails</div>
                    <div>{normalizedOwnersPreview(activeAdminGroup.owner) || 'Unassigned'}</div>
                  </div>
                  <div className="list-item admin-detail">
                    <div>Description</div>
                    <div>{activeAdminGroup.description || 'No description'}</div>
                  </div>
                </div>
                <div className="helper space-12">Audit</div>
                <div className="list">
                  <div className="list-item admin-detail">
                    <div>Created</div>
                    <div>{formatAuditValue(activeAdminGroup.created_by, activeAdminGroup.created_at)}</div>
                  </div>
                  <div className="list-item admin-detail">
                    <div>Last updated</div>
                    <div>{formatAuditValue(activeAdminGroup.updated_by, activeAdminGroup.updated_at)}</div>
                  </div>
                  <div className="list-item admin-detail">
                    <div>Last change reason</div>
                    <div>{activeAdminGroup.last_change_reason || 'None'}</div>
                  </div>
                </div>
                <div className="helper space-12">Services</div>
                <div className="list">
                  {(activeAdminGroup.services || []).length === 0 && <div className="helper">No services assigned.</div>}
                  {(activeAdminGroup.services || []).map((svc) => (
                    <div key={svc} className="list-item admin-detail">
                      <div>{svc}</div>
                    </div>
                  ))}
                </div>
                <div className="helper space-12">Allowed recipes</div>
                <div className="list">
                  {(activeAdminGroup.allowed_recipes || []).length === 0 && <div className="helper">No recipes assigned.</div>}
                  {(activeAdminGroup.allowed_recipes || []).map((recipeIdValue) => (
                    <div key={recipeIdValue} className="list-item admin-detail">
                      <div>{getRecipeLabel(recipeIdValue)}</div>
                      <div className="helper">{recipeIdValue}</div>
                    </div>
                  ))}
                </div>
                <div className="helper space-12">Guardrails</div>
                <div className="list">
                  <div className="list-item admin-detail">
                    <div>Max concurrent deployments</div>
                    <div>{activeAdminGroup.guardrails?.max_concurrent_deployments || '-'}</div>
                  </div>
                  <div className="list-item admin-detail">
                    <div>Daily deploy quota</div>
                    <div>{activeAdminGroup.guardrails?.daily_deploy_quota || '-'}</div>
                  </div>
                  <div className="list-item admin-detail">
                    <div>Daily rollback quota</div>
                    <div>{activeAdminGroup.guardrails?.daily_rollback_quota || '-'}</div>
                  </div>
                </div>
                <button
                  className="button secondary space-12"
                  onClick={() => startAdminGroupEdit(activeAdminGroup)}
                  disabled={adminReadOnly}
                >
                  Edit group
                </button>
              </>
            )}
            {(adminGroupMode === 'create' || adminGroupMode === 'edit') && (
              <>
                <h2>{adminGroupMode === 'create' ? 'Create delivery group' : 'Edit delivery group'}</h2>
                {adminGroupMode === 'edit' && activeAdminGroup && (
                  <>
                    <div className="helper space-4">Audit</div>
                    <div className="list space-12">
                      <div className="list-item admin-detail">
                        <div>Created</div>
                        <div>{formatAuditValue(activeAdminGroup.created_by, activeAdminGroup.created_at)}</div>
                      </div>
                      <div className="list-item admin-detail">
                        <div>Last updated</div>
                        <div>{formatAuditValue(activeAdminGroup.updated_by, activeAdminGroup.updated_at)}</div>
                      </div>
                      <div className="list-item admin-detail">
                        <div>Last change reason</div>
                        <div>{activeAdminGroup.last_change_reason || 'None'}</div>
                      </div>
                    </div>
                  </>
                )}
                {adminGroupMode === 'edit' && (
                  <div className="field">
                    <label htmlFor="admin-group-change-reason">Change reason (optional)</label>
                    <input
                      id="admin-group-change-reason"
                      value={adminGroupDraft.change_reason}
                      onChange={(e) => handleAdminGroupDraftChange('change_reason', e.target.value)}
                      onInput={(e) => handleAdminGroupDraftChange('change_reason', e.target.value)}
                      disabled={adminReadOnly}
                    />
                  </div>
                )}
                <button
                  className="button secondary space-12"
                  onClick={validateAdminGroupDraft}
                  disabled={adminGroupSaving || adminReadOnly}
                >
                  Preview changes
                </button>
                {adminGroupValidation && (
                  <div className="helper space-8">
                    Validation: {adminGroupValidation.validation_status}
                  </div>
                )}
                {adminGroupValidation?.messages?.length > 0 && (
                  <div className="list space-8">
                    {adminGroupValidation.messages.map((item, idx) => (
                      <div className="list-item admin-detail" key={`group-validate-${idx}`}>
                        <div>{item.type}</div>
                        <div>{item.field || 'general'}</div>
                        <div>{item.message}</div>
                      </div>
                    ))}
                  </div>
                )}
                {adminGroupValidation?.validation_status === 'WARNING' && (
                  <label className="check-item space-8">
                    <input
                      type="checkbox"
                      checked={adminGroupConfirmWarning}
                      onChange={(e) => setAdminGroupConfirmWarning(e.target.checked)}
                      disabled={adminReadOnly}
                    />
                    <span>Confirm warnings and proceed to save.</span>
                  </label>
                )}
                <div className="field">
                  <label htmlFor="admin-group-id">Group id</label>
                  <input
                    id="admin-group-id"
                    value={adminGroupDraft.id}
                    onChange={(e) => handleAdminGroupDraftChange('id', e.target.value)}
                    onInput={(e) => handleAdminGroupDraftChange('id', e.target.value)}
                    disabled={adminGroupMode === 'edit' || adminReadOnly}
                  />
                </div>
                <div className="field">
                  <label htmlFor="admin-group-name">Name</label>
                  <input
                    id="admin-group-name"
                    value={adminGroupDraft.name}
                    onChange={(e) => handleAdminGroupDraftChange('name', e.target.value)}
                    onInput={(e) => handleAdminGroupDraftChange('name', e.target.value)}
                    disabled={adminReadOnly}
                  />
                </div>
                <div className="field">
                  <label htmlFor="admin-group-description">Description</label>
                  <input
                    id="admin-group-description"
                    value={adminGroupDraft.description}
                    onChange={(e) => handleAdminGroupDraftChange('description', e.target.value)}
                    onInput={(e) => handleAdminGroupDraftChange('description', e.target.value)}
                    disabled={adminReadOnly}
                  />
                </div>
                <div className="field">
                  <label htmlFor="admin-group-owner">Owner emails (comma-separated)</label>
                  <input
                    id="admin-group-owner"
                    value={adminGroupDraft.owner}
                    onChange={(e) => handleAdminGroupDraftChange('owner', e.target.value)}
                    onInput={(e) => handleAdminGroupDraftChange('owner', e.target.value)}
                    disabled={adminReadOnly}
                  />
                  <div className="helper">
                    Owner list is matched case-insensitively for Delivery Owner access.
                  </div>
                  {normalizedOwnersPreview(adminGroupDraft.owner) && (
                    <div className="helper">Normalized: {normalizedOwnersPreview(adminGroupDraft.owner)}</div>
                  )}
                </div>
                <div className="helper">Admin-only configuration. Affects Delivery Owners and Observers.</div>
                <div className="helper space-12">Services</div>
                <div className="checklist">
                  {sortedServiceNames.length === 0 && <div className="helper">No allowlisted services found.</div>}
                  {sortedServiceNames.map((svc) => (
                    <label key={svc} className="check-item">
                      <input
                        type="checkbox"
                        checked={adminGroupDraft.services.includes(svc)}
                        onChange={() => toggleAdminGroupService(svc)}
                        disabled={adminReadOnly}
                      />
                      <span>{svc}</span>
                    </label>
                  ))}
                </div>
                <div className="helper space-12">Allowed recipes</div>
                <div className="checklist">
                  {sortedRecipes.length === 0 && <div className="helper">No recipes found.</div>}
                  {sortedRecipes.map((recipe) => (
                    <label key={recipe.id} className="check-item">
                      <input
                        type="checkbox"
                        checked={adminGroupDraft.allowed_recipes.includes(recipe.id)}
                        onChange={() => toggleAdminGroupRecipe(recipe.id)}
                        disabled={adminReadOnly}
                      />
                      <span>{recipe.name || recipe.id}</span>
                      <span className="helper">{recipe.id}</span>
                    </label>
                  ))}
                </div>
                <div className="helper space-12">Guardrails</div>
                <div className="row">
                  <div className="field">
                    <label htmlFor="admin-group-max-concurrent">Max concurrent deployments</label>
                    <input
                      id="admin-group-max-concurrent"
                      type="number"
                      min="1"
                      value={adminGroupDraft.guardrails.max_concurrent_deployments}
                      onChange={(e) => handleAdminGuardrailChange('max_concurrent_deployments', e.target.value)}
                      onInput={(e) => handleAdminGuardrailChange('max_concurrent_deployments', e.target.value)}
                      disabled={adminReadOnly}
                    />
                    <div className="helper">Minimum 1. Default 1.</div>
                  </div>
                  <div className="field">
                    <label htmlFor="admin-group-daily-deploy">Daily deploy quota</label>
                    <input
                      id="admin-group-daily-deploy"
                      type="number"
                      min="1"
                      value={adminGroupDraft.guardrails.daily_deploy_quota}
                      onChange={(e) => handleAdminGuardrailChange('daily_deploy_quota', e.target.value)}
                      onInput={(e) => handleAdminGuardrailChange('daily_deploy_quota', e.target.value)}
                      disabled={adminReadOnly}
                    />
                    <div className="helper">Minimum 1. Default {adminSettings?.daily_deploy_quota ?? 'system'}.</div>
                  </div>
                  <div className="field">
                    <label htmlFor="admin-group-daily-rollback">Daily rollback quota</label>
                    <input
                      id="admin-group-daily-rollback"
                      type="number"
                      min="1"
                      value={adminGroupDraft.guardrails.daily_rollback_quota}
                      onChange={(e) => handleAdminGuardrailChange('daily_rollback_quota', e.target.value)}
                      onInput={(e) => handleAdminGuardrailChange('daily_rollback_quota', e.target.value)}
                      disabled={adminReadOnly}
                    />
                    <div className="helper">Minimum 1. Default {adminSettings?.daily_rollback_quota ?? 'system'}.</div>
                  </div>
                </div>
                <div className="helper space-12">Impact preview</div>
                <div className="list">
                  <div className="list-item admin-detail">
                    <div>Services</div>
                    <div>{adminGroupDraft.services.length}</div>
                    <div>
                      {adminServiceDiff
                        ? `+${adminServiceDiff.added.length} / -${adminServiceDiff.removed.length}`
                        : 'New group'}
                    </div>
                  </div>
                  <div className="list-item admin-detail">
                    <div>Recipes</div>
                    <div>{adminGroupDraft.allowed_recipes.length}</div>
                    <div>
                      {adminRecipeDiff
                        ? `+${adminRecipeDiff.added.length} / -${adminRecipeDiff.removed.length}`
                        : 'New group'}
                    </div>
                  </div>
                </div>
                {adminServiceConflicts.length > 0 && (
                  <div className="helper space-8">
                    Service {adminServiceConflicts[0].service} already belongs to {adminServiceConflicts[0].groupName}.
                  </div>
                )}
                {adminGroupError && <div className="helper space-8">{adminGroupError}</div>}
                {adminGroupNote && <div className="helper space-8">{adminGroupNote}</div>}
                <div style={{ display: 'flex', gap: '8px' }} className="space-12">
                  <button
                    className="button"
                    onClick={saveAdminGroup}
                    disabled={adminGroupSaving || adminReadOnly || adminGroupValidation?.validation_status === 'ERROR'}
                  >
                    {adminGroupSaving ? 'Saving...' : 'Save group'}
                  </button>
                  <button
                    className="button secondary"
                    onClick={() => {
                      setAdminGroupMode('view')
                      setAdminGroupError('')
                      setAdminGroupNote('')
                      if (activeAdminGroup) {
                        setAdminGroupDraft(buildGroupDraft(activeAdminGroup, adminGuardrailDefaults))
                      } else {
                        setAdminGroupDraft(buildGroupDraft(null, adminGuardrailDefaults))
                      }
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}
            {adminGroupMode === 'view' && !activeAdminGroup && (
              <div className="helper">Select a delivery group to view details.</div>
            )}
          </SectionCard>
        </>
      )}
      {adminTab === 'recipes' && (
        <>
          <SectionCard>
            <h2>Recipes</h2>
            {recipes.length === 0 && <div className="helper">No recipes available.</div>}
            {recipes.length > 0 && (
              <div className="list space-12">
                {sortedRecipes.map((recipe) => {
                  const usage = recipeUsageCounts[recipe.id] || 0
                  const status = recipe.status || 'active'
                  return (
                    <div className="list-item admin-group" key={recipe.id}>
                      <div>
                        <strong>{recipe.name || recipe.id}</strong>
                        <div className="helper">{recipe.id}</div>
                      </div>
                      <div>
                        <span className={`status ${String(status).toUpperCase()}`}>{recipeStatusLabel(status)}</span>
                      </div>
                      <div>{usage} groups</div>
                      <div>
                        {isPlatformAdmin
                          ? recipe.spinnaker_application || 'No engine mapping'
                          : 'Diagnostics hidden'}
                      </div>
                      <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                        <button
                          className="button secondary"
                          onClick={() => {
                            setAdminRecipeMode('view')
                            setAdminRecipeId(recipe.id)
                            setAdminRecipeError('')
                            setAdminRecipeNote('')
                          }}
                        >
                          View
                        </button>
                        <button className="button secondary" onClick={() => startAdminRecipeEdit(recipe)} disabled={adminReadOnly}>
                          Edit
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </SectionCard>
          <SectionCard>
            {adminRecipeMode === 'view' && activeAdminRecipe && (
              <>
                <h2>Recipe detail</h2>
                <div className="helper">Recipe metadata and engine mapping.</div>
                <div className="list space-12">
                  <div className="list-item admin-detail">
                    <div>Name</div>
                    <div>{activeAdminRecipe.name}</div>
                  </div>
                  <div className="list-item admin-detail">
                    <div>Revision</div>
                    <div>v{activeAdminRecipe.recipe_revision ?? 1}</div>
                  </div>
                  <div className="list-item admin-detail">
                    <div>Status</div>
                    <div>{recipeStatusLabel(activeAdminRecipe.status)}</div>
                  </div>
                  <div className="list-item admin-detail">
                    <div>Description</div>
                    <div>{activeAdminRecipe.description || 'No description'}</div>
                  </div>
                  <div className="list-item admin-detail">
                    <div>Behavior summary</div>
                    <div>{activeAdminRecipe.effective_behavior_summary || 'No summary provided'}</div>
                  </div>
                  <div className="list-item admin-detail">
                    <div>Used by</div>
                    <div>{activeAdminRecipeUsage} delivery groups</div>
                  </div>
                </div>
                <div className="helper space-12">Audit</div>
                <div className="list">
                  <div className="list-item admin-detail">
                    <div>Created</div>
                    <div>{formatAuditValue(activeAdminRecipe.created_by, activeAdminRecipe.created_at)}</div>
                  </div>
                  <div className="list-item admin-detail">
                    <div>Last updated</div>
                    <div>{formatAuditValue(activeAdminRecipe.updated_by, activeAdminRecipe.updated_at)}</div>
                  </div>
                  <div className="list-item admin-detail">
                    <div>Last change reason</div>
                    <div>{activeAdminRecipe.last_change_reason || 'None'}</div>
                  </div>
                </div>
                {isPlatformAdmin ? (
                  <>
                    <div className="helper space-12">Engine mapping</div>
                    <div className="list">
                      <div className="list-item admin-detail">
                        <div>Application</div>
                        <div>{activeAdminRecipe.spinnaker_application || 'Not set'}</div>
                      </div>
                      <div className="list-item admin-detail">
                        <div>Deploy pipeline</div>
                        <div>{activeAdminRecipe.deploy_pipeline || 'Not set'}</div>
                      </div>
                      <div className="list-item admin-detail">
                        <div>Rollback pipeline</div>
                        <div>{activeAdminRecipe.rollback_pipeline || 'Not set'}</div>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="helper space-12">
                    Engine mapping is visible to Platform Admins only.
                  </div>
                )}
                <button
                  className="button secondary space-12"
                  onClick={() => startAdminRecipeEdit(activeAdminRecipe)}
                  disabled={adminReadOnly}
                >
                  Edit recipe
                </button>
              </>
            )}
            {(adminRecipeMode === 'create' || adminRecipeMode === 'edit') && (
              <>
                <h2>{adminRecipeMode === 'create' ? 'Create recipe' : 'Edit recipe'}</h2>
                {adminRecipeMode === 'edit' && activeAdminRecipe && (
                  <>
                    <div className="helper space-4">Audit</div>
                    <div className="list space-12">
                      <div className="list-item admin-detail">
                        <div>Created</div>
                        <div>{formatAuditValue(activeAdminRecipe.created_by, activeAdminRecipe.created_at)}</div>
                      </div>
                      <div className="list-item admin-detail">
                        <div>Last updated</div>
                        <div>{formatAuditValue(activeAdminRecipe.updated_by, activeAdminRecipe.updated_at)}</div>
                      </div>
                      <div className="list-item admin-detail">
                        <div>Last change reason</div>
                        <div>{activeAdminRecipe.last_change_reason || 'None'}</div>
                      </div>
                    </div>
                  </>
                )}
                {adminRecipeMode === 'edit' && (
                  <div className="field">
                    <label htmlFor="admin-recipe-change-reason">Change reason (optional)</label>
                    <input
                      id="admin-recipe-change-reason"
                      value={adminRecipeDraft.change_reason}
                      onChange={(e) => handleAdminRecipeDraftChange('change_reason', e.target.value)}
                      onInput={(e) => handleAdminRecipeDraftChange('change_reason', e.target.value)}
                      disabled={adminReadOnly}
                    />
                  </div>
                )}
                <button
                  className="button secondary space-12"
                  onClick={validateAdminRecipeDraft}
                  disabled={adminRecipeSaving || adminReadOnly}
                >
                  Preview changes
                </button>
                {adminRecipeValidation && (
                  <div className="helper space-8">
                    Validation: {adminRecipeValidation.validation_status}
                  </div>
                )}
                {adminRecipeValidation?.messages?.length > 0 && (
                  <div className="list space-8">
                    {adminRecipeValidation.messages.map((item, idx) => (
                      <div className="list-item admin-detail" key={`recipe-validate-${idx}`}>
                        <div>{item.type}</div>
                        <div>{item.field || 'general'}</div>
                        <div>{item.message}</div>
                      </div>
                    ))}
                  </div>
                )}
                {adminRecipeValidation?.validation_status === 'WARNING' && (
                  <label className="check-item space-8">
                    <input
                      type="checkbox"
                      checked={adminRecipeConfirmWarning}
                      onChange={(e) => setAdminRecipeConfirmWarning(e.target.checked)}
                      disabled={adminReadOnly}
                    />
                    <span>Confirm warnings and proceed to save.</span>
                  </label>
                )}
                <div className="helper space-12">
                  Admin-only configuration. Affects Delivery Owners and Observers.
                </div>
                <div className="field">
                  <label htmlFor="admin-recipe-id">Recipe id</label>
                  <input
                    id="admin-recipe-id"
                    value={adminRecipeDraft.id}
                    onChange={(e) => handleAdminRecipeDraftChange('id', e.target.value)}
                    onInput={(e) => handleAdminRecipeDraftChange('id', e.target.value)}
                    disabled={adminRecipeMode === 'edit' || adminReadOnly}
                  />
                </div>
                <div className="field">
                  <label htmlFor="admin-recipe-name">Name</label>
                  <input
                    id="admin-recipe-name"
                    value={adminRecipeDraft.name}
                    onChange={(e) => handleAdminRecipeDraftChange('name', e.target.value)}
                    onInput={(e) => handleAdminRecipeDraftChange('name', e.target.value)}
                    disabled={adminReadOnly}
                  />
                </div>
                <div className="field">
                  <label htmlFor="admin-recipe-description">Description</label>
                  <input
                    id="admin-recipe-description"
                    value={adminRecipeDraft.description}
                    onChange={(e) => handleAdminRecipeDraftChange('description', e.target.value)}
                    onInput={(e) => handleAdminRecipeDraftChange('description', e.target.value)}
                    disabled={adminReadOnly}
                  />
                </div>
                <div className="field">
                  <label htmlFor="admin-recipe-behavior">Effective behavior summary</label>
                  <textarea
                    id="admin-recipe-behavior"
                    rows={2}
                    value={adminRecipeDraft.effective_behavior_summary}
                    onChange={(e) => handleAdminRecipeDraftChange('effective_behavior_summary', e.target.value)}
                    onInput={(e) => handleAdminRecipeDraftChange('effective_behavior_summary', e.target.value)}
                    disabled={adminReadOnly}
                  />
                  <div className="helper">Short, user-facing summary of current recipe behavior.</div>
                </div>
                {isPlatformAdmin ? (
                  <>
                    <div className="helper space-12">Engine mapping</div>
                    {adminRecipeMode === 'edit' && activeAdminRecipeUsage > 0 && (
                      <div className="helper">Engine mapping is locked while recipe is in use.</div>
                    )}
                    <div className="field">
                      <label htmlFor="admin-recipe-app">Spinnaker application</label>
                      <input
                        id="admin-recipe-app"
                        value={adminRecipeDraft.spinnaker_application}
                        onChange={(e) => handleAdminRecipeDraftChange('spinnaker_application', e.target.value)}
                        onInput={(e) => handleAdminRecipeDraftChange('spinnaker_application', e.target.value)}
                        disabled={adminReadOnly || (adminRecipeMode === 'edit' && activeAdminRecipeUsage > 0)}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="admin-recipe-deploy">Deploy pipeline</label>
                      <input
                        id="admin-recipe-deploy"
                        value={adminRecipeDraft.deploy_pipeline}
                        onChange={(e) => handleAdminRecipeDraftChange('deploy_pipeline', e.target.value)}
                        onInput={(e) => handleAdminRecipeDraftChange('deploy_pipeline', e.target.value)}
                        disabled={adminReadOnly || (adminRecipeMode === 'edit' && activeAdminRecipeUsage > 0)}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="admin-recipe-rollback">Rollback pipeline</label>
                      <input
                        id="admin-recipe-rollback"
                        value={adminRecipeDraft.rollback_pipeline}
                        onChange={(e) => handleAdminRecipeDraftChange('rollback_pipeline', e.target.value)}
                        onInput={(e) => handleAdminRecipeDraftChange('rollback_pipeline', e.target.value)}
                        disabled={adminReadOnly || (adminRecipeMode === 'edit' && activeAdminRecipeUsage > 0)}
                      />
                    </div>
                  </>
                ) : (
                  <div className="helper space-12">
                    Engine mapping is visible to Platform Admins only.
                  </div>
                )}
                <div className="field">
                  <label htmlFor="admin-recipe-status">Deprecated</label>
                  <input
                    id="admin-recipe-status"
                    type="checkbox"
                    checked={adminRecipeDraft.status === 'deprecated'}
                    onChange={(e) =>
                      handleAdminRecipeDraftChange('status', e.target.checked ? 'deprecated' : 'active')
                    }
                    disabled={adminReadOnly}
                  />
                  {adminRecipeDraft.status === 'deprecated' && (
                    <div className="helper">Deprecated recipes cannot be used for new deployments.</div>
                  )}
                </div>
                {adminRecipeError && <div className="helper space-8">{adminRecipeError}</div>}
                {adminRecipeNote && <div className="helper space-8">{adminRecipeNote}</div>}
                <div style={{ display: 'flex', gap: '8px' }} className="space-12">
                  <button
                    className="button"
                    onClick={saveAdminRecipe}
                    disabled={adminRecipeSaving || adminReadOnly || adminRecipeValidation?.validation_status === 'ERROR'}
                  >
                    {adminRecipeSaving ? 'Saving...' : 'Save recipe'}
                  </button>
                  <button
                    className="button secondary"
                    onClick={() => {
                      setAdminRecipeMode('view')
                      setAdminRecipeError('')
                      setAdminRecipeNote('')
                      if (activeAdminRecipe) {
                        setAdminRecipeDraft(buildRecipeDraft(activeAdminRecipe))
                      } else {
                        setAdminRecipeDraft(buildRecipeDraft(null))
                      }
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}
            {adminRecipeMode === 'view' && !activeAdminRecipe && (
              <div className="helper">Select a recipe to view details.</div>
            )}
          </SectionCard>
        </>
      )}
      {adminTab === 'audit' && isPlatformAdmin && (
        <SectionCard>
          <h2>Audit events</h2>
          {auditError && <div className="helper space-8">{auditError}</div>}
          {!auditError && auditEvents.length === 0 && (
            <div className="helper space-8">No audit events found.</div>
          )}
          {auditEvents.length > 0 && (
            <div className="list space-12">
              {auditEvents.map((event) => (
                <div className="list-item admin-group" key={event.event_id}>
                  <div>
                    <strong>{event.event_type}</strong>
                    <div className="helper">{event.timestamp}</div>
                  </div>
                  <div>{event.actor_id}</div>
                  <div>{event.outcome}</div>
                  <div>{event.target_type}: {event.target_id}</div>
                  <div>{event.summary}</div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      )}
      {adminTab === 'system-settings' && isPlatformAdmin && (
        <SectionCard>
          <h2>Mutation Kill Switch</h2>
          <div className="list-item admin-detail two-col">
            <div>Status</div>
            <div>
              <strong>{currentlyDisabled ? 'Mutations: DISABLED' : 'Mutations: ENABLED'}</strong>
            </div>
          </div>
          <div className="helper space-8">When disabled, DXCP operates in read-only mode.</div>
          <div className="helper">Impact:</div>
          <div className="helper">- Deploys blocked</div>
          <div className="helper">- Rollbacks blocked</div>
          <div className="helper">- Build publishing blocked</div>
          <div className="helper">- Reads still available</div>
          {systemMutationsDisabledError && <div className="helper space-8">{systemMutationsDisabledError}</div>}
          {systemMutationsDisabledNote && <div className="helper space-8">{systemMutationsDisabledNote}</div>}
          <div className="space-12" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button
              className={`button ${currentlyDisabled ? '' : 'danger'}`}
              onClick={openKillSwitchDialog}
              disabled={systemMutationsDisabledSaving || systemMutationsDisabledLoading}
            >
              {currentlyDisabled ? 'Enable mutations' : 'Disable mutations'}
            </button>
          </div>
          {killSwitchDialogOpen && (
            <div className="card space-12">
              <h2>{currentlyDisabled ? 'Enable mutations' : 'Disable mutations'}</h2>
              <div className="helper">
                {currentlyDisabled
                  ? 'This will re-enable all mutating API endpoints immediately.'
                  : 'This will put DXCP into read-only mode immediately.'}
              </div>
              {!currentlyDisabled && (
                <div className="field space-8">
                  <label htmlFor="kill-switch-confirm-phrase">Type exact phrase to continue</label>
                  <input
                    id="kill-switch-confirm-phrase"
                    value={killSwitchPhrase}
                    onChange={(e) => setKillSwitchPhrase(e.target.value)}
                    onInput={(e) => setKillSwitchPhrase(e.target.value)}
                    placeholder={disablePhraseRequired}
                    autoComplete="off"
                  />
                  <div className="helper">Required phrase: {disablePhraseRequired}</div>
                </div>
              )}
              <div className="field">
                <label htmlFor="kill-switch-reason">Reason (optional)</label>
                <textarea
                  id="kill-switch-reason"
                  rows={3}
                  value={killSwitchReason}
                  onChange={(e) => setKillSwitchReason(e.target.value)}
                  onInput={(e) => setKillSwitchReason(e.target.value)}
                />
              </div>
              {!killSwitchStepConfirmed ? (
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <button
                    className="button secondary"
                    onClick={() => setKillSwitchStepConfirmed(true)}
                    disabled={!canAcknowledgeStepOne}
                  >
                    Continue
                  </button>
                  <button className="button secondary" onClick={closeKillSwitchDialog}>
                    Cancel
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <button
                    className={`button ${currentlyDisabled ? '' : 'danger'}`}
                    onClick={confirmKillSwitchChange}
                    disabled={!canConfirmKillSwitchChange}
                  >
                    {systemMutationsDisabledSaving
                      ? 'Saving...'
                      : currentlyDisabled
                        ? 'Confirm enable mutations'
                        : 'Confirm disable mutations'}
                  </button>
                  <button className="button secondary" onClick={closeKillSwitchDialog} disabled={systemMutationsDisabledSaving}>
                    Cancel
                  </button>
                </div>
              )}
            </div>
          )}
          <h2>Rate limits</h2>
          <div className="helper">Changing rate limits affects platform safety and cost controls.</div>
          <div className="row space-12">
            <div className="field">
              <label htmlFor="system-read-rpm">Read RPM</label>
              <input
                id="system-read-rpm"
                type="number"
                min="1"
                max="5000"
                step="1"
                value={systemRateLimitDraft.read_rpm}
                onChange={(e) => handleSystemRateLimitDraftChange('read_rpm', e.target.value)}
                onInput={(e) => handleSystemRateLimitDraftChange('read_rpm', e.target.value)}
                disabled={systemRateLimitLoading || systemRateLimitSaving}
              />
              <div className="helper">Integer between 1 and 5000.</div>
            </div>
            <div className="field">
              <label htmlFor="system-mutate-rpm">Mutate RPM</label>
              <input
                id="system-mutate-rpm"
                type="number"
                min="1"
                max="5000"
                step="1"
                value={systemRateLimitDraft.mutate_rpm}
                onChange={(e) => handleSystemRateLimitDraftChange('mutate_rpm', e.target.value)}
                onInput={(e) => handleSystemRateLimitDraftChange('mutate_rpm', e.target.value)}
                disabled={systemRateLimitLoading || systemRateLimitSaving}
              />
              <div className="helper">Integer between 1 and 5000.</div>
            </div>
            <div className="field">
              <label htmlFor="system-daily-build-register-quota">Daily build registration quota</label>
              <input
                id="system-daily-build-register-quota"
                type="number"
                min="0"
                max="5000"
                step="1"
                value={systemRateLimitDraft.daily_quota_build_register}
                onChange={(e) => handleSystemRateLimitDraftChange('daily_quota_build_register', e.target.value)}
                onInput={(e) => handleSystemRateLimitDraftChange('daily_quota_build_register', e.target.value)}
                disabled={systemRateLimitLoading || systemRateLimitSaving}
              />
              <div className="helper">
                Applies to CI build registration across the system (scoped per CI actor_id in counters).
              </div>
            </div>
          </div>
          {systemRateLimitError && <div className="helper space-8">{systemRateLimitError}</div>}
          {systemRateLimitNote && <div className="helper space-8">{systemRateLimitNote}</div>}
          <div className="space-12">
            <button
              className="button"
              onClick={saveSystemRateLimits}
              disabled={systemRateLimitSaving || systemRateLimitLoading || !systemRateLimitDirty}
            >
              {systemRateLimitSaving ? 'Saving...' : 'Save'}
            </button>
          </div>
          <h2 className="space-12">CI publishers</h2>
          <div className="helper">Manage named CI publishers and token match rules.</div>
          {Array.isArray(systemCiPublishersList) && systemCiPublishersList.length > 0 ? (
            <table className="space-12" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Name</th>
                  <th style={{ textAlign: 'left' }}>Provider</th>
                  <th style={{ textAlign: 'left' }}>Match rules</th>
                </tr>
              </thead>
              <tbody>
                {systemCiPublishersList.map((publisher) => (
                  <tr key={`${publisher?.name || 'publisher'}-${publisher?.provider || 'custom'}`}>
                    <td>{publisher?.name || '-'}</td>
                    <td>{publisher?.provider || '-'}</td>
                    <td>{summarizePublisherRules(publisher)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="helper space-8">No CI publishers configured.</div>
          )}
          <div className="field space-12">
            <label htmlFor="system-ci-publishers">Publishers JSON (View/Edit)</label>
            <textarea
              id="system-ci-publishers"
              rows={12}
              value={systemCiPublishersDraft}
              onChange={(e) => handleSystemCiPublishersDraftChange(e.target.value)}
              onInput={(e) => handleSystemCiPublishersDraftChange(e.target.value)}
              disabled={systemCiPublishersLoading || systemCiPublishersSaving}
            />
            <div className="helper">PUT payload format: {"{ \"publishers\": [ ... ] }"}.</div>
          </div>
          {systemCiPublishersError && <div className="helper space-8">{systemCiPublishersError}</div>}
          {systemCiPublishersNote && <div className="helper space-8">{systemCiPublishersNote}</div>}
          <div className="space-12">
            <button
              className="button"
              onClick={saveSystemCiPublishers}
              disabled={systemCiPublishersSaving || systemCiPublishersLoading || !systemCiPublishersDirty}
            >
              {systemCiPublishersSaving ? 'Saving...' : 'Save'}
            </button>
          </div>
          <h2 className="space-12">Build Provenance Exposure</h2>
          <div className="helper">Organization-wide controls for provenance visibility in DXCP.</div>
          <div className="checklist space-12">
            <label className="check-item">
              <input
                type="checkbox"
                checked={systemUiExposurePolicyDraft.artifactRef.display === true}
                onChange={(e) => handleSystemUiExposurePolicyToggle('artifactRef', e.target.checked)}
                disabled={systemUiExposurePolicyLoading || systemUiExposurePolicySaving}
              />
              <span>Show artifact references</span>
            </label>
            <label className="check-item">
              <input
                type="checkbox"
                checked={systemUiExposurePolicyDraft.externalLinks.display === true}
                onChange={(e) => handleSystemUiExposurePolicyToggle('externalLinks', e.target.checked)}
                disabled={systemUiExposurePolicyLoading || systemUiExposurePolicySaving}
              />
              <span>Show external links (commit and CI run)</span>
            </label>
          </div>
          <div className="helper">Controls whether DXCP displays outbound links derived from build metadata.</div>
          {systemUiExposurePolicyError && <div className="helper space-8">{systemUiExposurePolicyError}</div>}
          {systemUiExposurePolicyNote && <div className="helper space-8">{systemUiExposurePolicyNote}</div>}
          <div className="space-12">
            <button
              className="button"
              onClick={saveSystemUiExposurePolicy}
              disabled={systemUiExposurePolicySaving || systemUiExposurePolicyLoading || !systemUiExposurePolicyDirty}
            >
              {systemUiExposurePolicySaving ? 'Saving...' : 'Save exposure policy'}
            </button>
          </div>
          <h2 className="space-12">Who am I</h2>
          <div className="helper">Identity fields seen by DXCP for CI publisher matching.</div>
          <div className="space-8">
            <button className="button secondary" onClick={handleCopyAccessToken} disabled={copyTokenBusy}>
              {copyTokenBusy ? 'Copying...' : 'Copy access token'}
            </button>
          </div>
          <div className="helper">Copies your current Auth0 access token for API debugging.</div>
          <div className="helper">Treat as a secret; expires quickly.</div>
          {copyTokenError && <div className="helper space-8">{copyTokenError}</div>}
          {copyTokenNote && <div className="helper space-8">{copyTokenNote}</div>}
          {whoamiError && <div className="helper space-8">{whoamiError}</div>}
          <div className="space-8">
            <button className="button secondary" onClick={() => loadWhoAmI({ force: true })} disabled={whoamiLoading}>
              {whoamiLoading ? 'Loading...' : 'Refresh identity'}
            </button>
          </div>
          {whoamiData && (
            <div className="list space-12">
              <div className="list-item admin-detail">
                <div>actor_id</div>
                <div>{whoamiData.actor_id || '-'}</div>
              </div>
              <div className="list-item admin-detail">
                <div>sub</div>
                <div>{whoamiData.sub || '-'}</div>
              </div>
              <div className="list-item admin-detail">
                <div>email</div>
                <div>{whoamiData.email || '-'}</div>
              </div>
              <div className="list-item admin-detail">
                <div>iss</div>
                <div>{whoamiData.iss || '-'}</div>
              </div>
              <div className="list-item admin-detail">
                <div>aud</div>
                <div>
                  {Array.isArray(whoamiData.aud)
                    ? whoamiData.aud.join(', ')
                    : (whoamiData.aud || '-')}
                </div>
              </div>
              <div className="list-item admin-detail">
                <div>azp</div>
                <div>{whoamiData.azp || '-'}</div>
              </div>
            </div>
          )}
        </SectionCard>
      )}
    </div>
  )
}
