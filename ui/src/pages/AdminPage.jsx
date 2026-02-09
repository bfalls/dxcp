import React from 'react'
import PageHeader from '../components/PageHeader.jsx'

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
  auditEvents
}) {
  return (
    <div className="shell">
      <div className="card" style={{ gridColumn: '1 / -1' }}>
        <PageHeader
          title="Admin"
          actions={adminReadOnly ? <div className="helper">Only Platform Admins can modify this.</div> : null}
        />
        <div className="tabs" style={{ marginTop: '12px' }}>
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
        </div>
      </div>
      {adminTab === 'delivery-groups' && (
        <>
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2>Delivery groups</h2>
              <button className="button secondary" onClick={startAdminGroupCreate} disabled={adminReadOnly}>
                Create group
              </button>
            </div>
            {deliveryGroups.length === 0 && <div className="helper">No delivery groups available.</div>}
            {deliveryGroups.length > 0 && (
              <div className="list" style={{ marginTop: '12px' }}>
                {deliveryGroups.map((group) => (
                  <div className="list-item admin-group" key={group.id}>
                    <div>
                      <strong>{group.name}</strong>
                      <div className="helper">{group.id}</div>
                    </div>
                    <div>{group.owner || 'Unassigned owner'}</div>
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
          </div>
          <div className="card">
            {adminGroupMode === 'view' && activeAdminGroup && (
              <>
                <h2>Group detail</h2>
                <div className="helper">Delivery group details and policy context.</div>
                <div className="list" style={{ marginTop: '12px' }}>
                  <div className="list-item admin-detail">
                    <div>Name</div>
                    <div>{activeAdminGroup.name}</div>
                  </div>
                  <div className="list-item admin-detail">
                    <div>Owner</div>
                    <div>{activeAdminGroup.owner || 'Unassigned'}</div>
                  </div>
                  <div className="list-item admin-detail">
                    <div>Description</div>
                    <div>{activeAdminGroup.description || 'No description'}</div>
                  </div>
                </div>
                <div className="helper" style={{ marginTop: '12px' }}>Audit</div>
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
                <div className="helper" style={{ marginTop: '12px' }}>Services</div>
                <div className="list">
                  {(activeAdminGroup.services || []).length === 0 && <div className="helper">No services assigned.</div>}
                  {(activeAdminGroup.services || []).map((svc) => (
                    <div key={svc} className="list-item admin-detail">
                      <div>{svc}</div>
                    </div>
                  ))}
                </div>
                <div className="helper" style={{ marginTop: '12px' }}>Allowed recipes</div>
                <div className="list">
                  {(activeAdminGroup.allowed_recipes || []).length === 0 && <div className="helper">No recipes assigned.</div>}
                  {(activeAdminGroup.allowed_recipes || []).map((recipeIdValue) => (
                    <div key={recipeIdValue} className="list-item admin-detail">
                      <div>{getRecipeLabel(recipeIdValue)}</div>
                      <div className="helper">{recipeIdValue}</div>
                    </div>
                  ))}
                </div>
                <div className="helper" style={{ marginTop: '12px' }}>Guardrails</div>
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
                  className="button secondary"
                  style={{ marginTop: '12px' }}
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
                    <div className="helper" style={{ marginTop: '4px' }}>Audit</div>
                    <div className="list" style={{ marginTop: '12px' }}>
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
                  className="button secondary"
                  style={{ marginTop: '12px' }}
                  onClick={validateAdminGroupDraft}
                  disabled={adminGroupSaving || adminReadOnly}
                >
                  Preview changes
                </button>
                {adminGroupValidation && (
                  <div className="helper" style={{ marginTop: '8px' }}>
                    Validation: {adminGroupValidation.validation_status}
                  </div>
                )}
                {adminGroupValidation?.messages?.length > 0 && (
                  <div className="list" style={{ marginTop: '8px' }}>
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
                  <label className="check-item" style={{ marginTop: '8px' }}>
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
                  <label htmlFor="admin-group-owner">Owner</label>
                  <input
                    id="admin-group-owner"
                    value={adminGroupDraft.owner}
                    onChange={(e) => handleAdminGroupDraftChange('owner', e.target.value)}
                    onInput={(e) => handleAdminGroupDraftChange('owner', e.target.value)}
                    disabled={adminReadOnly}
                  />
                </div>
                <div className="helper">Admin-only configuration. Affects Delivery Owners and Observers.</div>
                <div className="helper" style={{ marginTop: '12px' }}>Services</div>
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
                <div className="helper" style={{ marginTop: '12px' }}>Allowed recipes</div>
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
                <div className="helper" style={{ marginTop: '12px' }}>Guardrails</div>
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
                <div className="helper" style={{ marginTop: '12px' }}>Impact preview</div>
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
                  <div className="helper" style={{ marginTop: '8px' }}>
                    Service {adminServiceConflicts[0].service} already belongs to {adminServiceConflicts[0].groupName}.
                  </div>
                )}
                {adminGroupError && <div className="helper" style={{ marginTop: '8px' }}>{adminGroupError}</div>}
                {adminGroupNote && <div className="helper" style={{ marginTop: '8px' }}>{adminGroupNote}</div>}
                <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
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
          </div>
        </>
      )}
      {adminTab === 'recipes' && (
        <>
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2>Recipes</h2>
              <button className="button secondary" onClick={startAdminRecipeCreate} disabled={adminReadOnly}>
                Create recipe
              </button>
            </div>
            {recipes.length === 0 && <div className="helper">No recipes available.</div>}
            {recipes.length > 0 && (
              <div className="list" style={{ marginTop: '12px' }}>
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
          </div>
          <div className="card">
            {adminRecipeMode === 'view' && activeAdminRecipe && (
              <>
                <h2>Recipe detail</h2>
                <div className="helper">Recipe metadata and engine mapping.</div>
                <div className="list" style={{ marginTop: '12px' }}>
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
                <div className="helper" style={{ marginTop: '12px' }}>Audit</div>
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
                    <div className="helper" style={{ marginTop: '12px' }}>Engine mapping</div>
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
                  <div className="helper" style={{ marginTop: '12px' }}>
                    Engine mapping is visible to Platform Admins only.
                  </div>
                )}
                <button
                  className="button secondary"
                  style={{ marginTop: '12px' }}
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
                    <div className="helper" style={{ marginTop: '4px' }}>Audit</div>
                    <div className="list" style={{ marginTop: '12px' }}>
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
                  className="button secondary"
                  style={{ marginTop: '12px' }}
                  onClick={validateAdminRecipeDraft}
                  disabled={adminRecipeSaving || adminReadOnly}
                >
                  Preview changes
                </button>
                {adminRecipeValidation && (
                  <div className="helper" style={{ marginTop: '8px' }}>
                    Validation: {adminRecipeValidation.validation_status}
                  </div>
                )}
                {adminRecipeValidation?.messages?.length > 0 && (
                  <div className="list" style={{ marginTop: '8px' }}>
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
                  <label className="check-item" style={{ marginTop: '8px' }}>
                    <input
                      type="checkbox"
                      checked={adminRecipeConfirmWarning}
                      onChange={(e) => setAdminRecipeConfirmWarning(e.target.checked)}
                      disabled={adminReadOnly}
                    />
                    <span>Confirm warnings and proceed to save.</span>
                  </label>
                )}
                <div className="helper" style={{ marginTop: '12px' }}>
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
                    <div className="helper" style={{ marginTop: '12px' }}>Engine mapping</div>
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
                  <div className="helper" style={{ marginTop: '12px' }}>
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
                {adminRecipeError && <div className="helper" style={{ marginTop: '8px' }}>{adminRecipeError}</div>}
                {adminRecipeNote && <div className="helper" style={{ marginTop: '8px' }}>{adminRecipeNote}</div>}
                <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
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
          </div>
        </>
      )}
      {adminTab === 'audit' && isPlatformAdmin && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2>Audit events</h2>
            <button className="button secondary" onClick={loadAuditEvents} disabled={auditLoading}>
              {auditLoading ? 'Loading...' : 'Refresh'}
            </button>
          </div>
          {auditError && <div className="helper" style={{ marginTop: '8px' }}>{auditError}</div>}
          {!auditError && auditEvents.length === 0 && (
            <div className="helper" style={{ marginTop: '8px' }}>No audit events found.</div>
          )}
          {auditEvents.length > 0 && (
            <div className="list" style={{ marginTop: '12px' }}>
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
        </div>
      )}
    </div>
  )
}
