import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import DefinitionGrid, { DefinitionRow } from '../components/DefinitionGrid.jsx'
import LoadingText from '../components/LoadingText.jsx'
import OperationalDataList from '../components/OperationalDataList.jsx'
import SectionCard from '../components/SectionCard.jsx'
import NewExperiencePageHeader from './NewExperiencePageHeader.jsx'
import NewRefreshButton from './NewRefreshButton.jsx'
import NewSegmentedTabs from './NewSegmentedTabs.jsx'
import { NewExplanation, NewStateBlock } from './NewExperienceStatePrimitives.jsx'
import {
  createEmptyAdminGroupDraft,
  loadAdminData,
  reviewAdminGroupDraft,
  saveAdminGroupDraft
} from './newExperienceAdminData.js'

const DELIVERY_GROUP_COLUMNS = [
  { key: 'name', label: 'Name', width: 'minmax(240px, 1.8fr)' },
  { key: 'owner', label: 'Owner', width: 'minmax(200px, 1.2fr)' },
  { key: 'applications', label: 'Applications', width: 'minmax(120px, 0.7fr)' },
  { key: 'recipes', label: 'Allowed recipes', width: 'minmax(140px, 0.8fr)' },
  { key: 'guardrails', label: 'Guardrails', width: 'minmax(240px, 1.6fr)' },
  { key: 'updated', label: 'Updated', width: 'minmax(180px, 0.9fr)' }
]

const MEMBERSHIP_COLUMNS = [{ key: 'service', label: 'Application', width: 'minmax(220px, 1fr)' }]

function formatTimestamp(value) {
  if (!value) return 'Not recorded'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

function summarizeOwner(ownerValue) {
  const owners = String(ownerValue || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  if (owners.length === 0) return 'Owners not provided'
  if (owners.length < 3) return owners.join(', ')
  return `${owners[0]}, ${owners[1]} +${owners.length - 2}`
}

function summarizeGuardrails(guardrails) {
  return [
    `Max ${guardrails?.maxConcurrentDeployments ?? '0'} concurrent`,
    `Deploy ${guardrails?.dailyDeployQuota ?? '0'}/day`,
    `Rollback ${guardrails?.dailyRollbackQuota ?? '0'}/day`
  ].join(' | ')
}

function summarizeEnvironmentScope(group) {
  const environments = Array.isArray(group?.allowedEnvironments) ? group.allowedEnvironments : []
  if (environments.length === 0) return 'No environment scope is set on this group.'
  return environments.join(', ')
}

function groupMatchesSearch(group, searchTerm) {
  return [
    group.id,
    group.name,
    group.owner,
    group.description,
    ...group.services,
    ...group.allowedRecipes,
    ...group.allowedEnvironments
  ]
    .join(' ')
    .toLowerCase()
    .includes(searchTerm)
}

function listDiff(currentItems, nextItems) {
  const current = new Set(currentItems)
  const next = new Set(nextItems)
  return {
    added: Array.from(next).filter((item) => !current.has(item)),
    removed: Array.from(current).filter((item) => !next.has(item))
  }
}

function draftsEqual(baseGroup, draft, isCreate) {
  const normalize = (list) => (Array.isArray(list) ? list.slice().sort().join('|') : '')
  if (isCreate) {
    return ![
      draft.id,
      draft.name,
      draft.owner,
      draft.description,
      draft.dailyDeployQuota,
      draft.dailyRollbackQuota,
      draft.maxConcurrentDeployments,
      draft.changeReason,
      normalize(draft.services),
      normalize(draft.allowedRecipes)
    ]
      .join('|')
      .trim()
  }
  if (!baseGroup) return true
  return (
    draft.id === baseGroup.id &&
    draft.name === baseGroup.name &&
    draft.owner === baseGroup.owner &&
    draft.description === baseGroup.description &&
    draft.dailyDeployQuota === String(baseGroup.guardrails.dailyDeployQuota ?? '') &&
    draft.dailyRollbackQuota === String(baseGroup.guardrails.dailyRollbackQuota ?? '') &&
    draft.maxConcurrentDeployments === String(baseGroup.guardrails.maxConcurrentDeployments ?? '') &&
    normalize(draft.services) === normalize(baseGroup.services) &&
    normalize(draft.allowedRecipes) === normalize(baseGroup.allowedRecipes) &&
    draft.changeReason.trim() === ''
  )
}

function SelectionList({ items, selectedItems, onToggle, disabled, ariaLabel }) {
  const selected = new Set(selectedItems)
  return (
    <div className="new-admin-checkbox-row" role="group" aria-label={ariaLabel}>
      {items.map((item) => (
        <label key={item.value} className="new-admin-checkbox">
          <input type="checkbox" checked={selected.has(item.value)} onChange={() => onToggle(item.value)} disabled={disabled} />
          <span>{item.label}</span>
        </label>
      ))}
    </div>
  )
}

export default function NewExperienceAdminDeliveryGroupsPage({ api, role = 'UNKNOWN', groupId = '', isCreateRoute = false }) {
  const navigate = useNavigate()
  const [workspaceState, setWorkspaceState] = useState({ kind: 'loading', viewModel: null, errorMessage: '' })
  const [searchTerm, setSearchTerm] = useState('')
  const [detailTab, setDetailTab] = useState('details')
  const [mode, setMode] = useState(isCreateRoute ? 'edit' : 'view')
  const [draft, setDraft] = useState(null)
  const [review, setReview] = useState({ payload: null, warnings: [], errors: [] })
  const [warningAcknowledged, setWarningAcknowledged] = useState(false)
  const [message, setMessage] = useState({ tone: '', title: '', body: '' })
  const [isSaving, setIsSaving] = useState(false)

  const collectionRoute = '/new/admin?tab=delivery-groups'
  const canEdit = role === 'PLATFORM_ADMIN'

  const loadWorkspace = useCallback(async (options = {}) => {
    setWorkspaceState((current) => ({
      kind: current.kind === 'ready' || current.kind === 'degraded' || current.kind === 'empty' ? 'refreshing' : 'loading',
      viewModel: current.viewModel,
      errorMessage: ''
    }))
    const result = await loadAdminData(api, options)
    setWorkspaceState(result)
  }, [api])

  useEffect(() => {
    loadWorkspace()
  }, [loadWorkspace])

  const groups = useMemo(() => workspaceState.viewModel?.groups || [], [workspaceState.viewModel?.groups])
  const recipes = useMemo(() => workspaceState.viewModel?.recipes || [], [workspaceState.viewModel?.recipes])
  const services = useMemo(() => workspaceState.viewModel?.services || [], [workspaceState.viewModel?.services])
  const selectedGroup = useMemo(() => groups.find((group) => group.id === groupId) || null, [groupId, groups])
  const filteredGroups = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase()
    if (!normalizedSearch) return groups
    return groups.filter((group) => groupMatchesSearch(group, normalizedSearch))
  }, [groups, searchTerm])

  useEffect(() => {
    if (workspaceState.kind === 'loading') return
    if (isCreateRoute) {
      setMode('edit')
      setDetailTab('details')
      setDraft(createEmptyAdminGroupDraft(workspaceState.viewModel?.adminDefaults))
      setReview({ payload: null, warnings: [], errors: [] })
      setWarningAcknowledged(false)
      return
    }
    if (!selectedGroup) return
    setMode('view')
    setDetailTab('details')
    setDraft({
      id: selectedGroup.id,
      name: selectedGroup.name,
      owner: selectedGroup.owner,
      description: selectedGroup.description,
      services: selectedGroup.services.slice(),
      allowedRecipes: selectedGroup.allowedRecipes.slice(),
      allowedEnvironments: selectedGroup.allowedEnvironments.slice(),
      dailyDeployQuota: String(selectedGroup.guardrails.dailyDeployQuota ?? ''),
      dailyRollbackQuota: String(selectedGroup.guardrails.dailyRollbackQuota ?? ''),
      maxConcurrentDeployments: String(selectedGroup.guardrails.maxConcurrentDeployments ?? ''),
      changeReason: ''
    })
    setReview({ payload: null, warnings: [], errors: [] })
    setWarningAcknowledged(false)
  }, [isCreateRoute, selectedGroup, workspaceState.kind, workspaceState.viewModel?.adminDefaults])

  const summaryGroup = selectedGroup || {
    id: draft?.id || '',
    name: draft?.name || '',
    owner: draft?.owner || '',
    description: draft?.description || '',
    services: draft?.services || [],
    allowedRecipes: draft?.allowedRecipes || [],
    allowedEnvironments: draft?.allowedEnvironments || [],
    guardrails: {
      maxConcurrentDeployments: draft?.maxConcurrentDeployments || '0',
      dailyDeployQuota: draft?.dailyDeployQuota || '0',
      dailyRollbackQuota: draft?.dailyRollbackQuota || '0'
    },
    createdAt: '',
    createdBy: '',
    updatedAt: '',
    updatedBy: '',
    lastChangeReason: ''
  }

  const hasChanges = useMemo(
    () => !draftsEqual(selectedGroup, draft || createEmptyAdminGroupDraft(workspaceState.viewModel?.adminDefaults), isCreateRoute),
    [draft, isCreateRoute, selectedGroup, workspaceState.viewModel?.adminDefaults]
  )

  const localReview = useMemo(() => {
    const serviceConflicts = (draft?.services || [])
      .map((serviceId) => {
        const conflictGroup = groups.find((group) => group.id !== selectedGroup?.id && group.services.includes(serviceId))
        if (!conflictGroup) return null
        return {
          id: `service-conflict-${serviceId}`,
          text: `${serviceId} already belongs to ${conflictGroup.name || conflictGroup.id}. Remove it there before saving this Delivery Group.`
        }
      })
      .filter(Boolean)
    return {
      ...review,
      errors: [...(review.errors || []), ...serviceConflicts]
    }
  }, [draft?.services, groups, review, selectedGroup?.id])

  const recipeOptions = recipes.map((recipe) => ({ value: recipe.id, label: recipe.name || recipe.id }))
  const serviceOptions = services.map((service) => ({ value: service, label: service }))
  const membershipChange = useMemo(() => listDiff(selectedGroup?.services || [], draft?.services || []), [draft?.services, selectedGroup?.services])

  const backToCollection = () => navigate(collectionRoute)
  const openGroup = (nextGroupId) => navigate(`/new/admin/delivery-groups/${encodeURIComponent(nextGroupId)}`)
  const beginCreate = () => navigate('/new/admin/delivery-groups/create')
  const beginEdit = () => {
    setMode('edit')
    setDetailTab('details')
    setMessage({ tone: '', title: '', body: '' })
  }
  const cancelEditing = () => {
    if (isCreateRoute) {
      backToCollection()
      return
    }
    setMode('view')
    setDetailTab('details')
  }
  const toggleDraftItem = (field, value) => {
    setDraft((current) => {
      const nextItems = new Set(current?.[field] || [])
      if (nextItems.has(value)) nextItems.delete(value)
      else nextItems.add(value)
      return { ...current, [field]: Array.from(nextItems).sort() }
    })
  }

  const saveDraft = async () => {
    if (!draft) return
    const nextReview = await reviewAdminGroupDraft(api, selectedGroup, draft)
    setReview(nextReview)
    if (
      localReview.errors.length > 0 ||
      nextReview.errors.length > 0 ||
      workspaceState.viewModel?.mutationsDisabled === true ||
      workspaceState.viewModel?.mutationAvailability === 'unknown' ||
      (nextReview.warnings.length > 0 && !warningAcknowledged)
    ) {
      setMessage({
        tone: nextReview.errors.length > 0 ? 'danger' : 'warning',
        title: nextReview.errors.length > 0 ? 'Delivery Group changes need attention' : 'Warnings require confirmation before saving.',
        body: nextReview.errors.length > 0
          ? 'Resolve the highlighted Delivery Group issues before saving.'
          : 'Review the warning details, acknowledge them, then save again if this governance change should proceed.'
      })
      return
    }
    setIsSaving(true)
    const result = await saveAdminGroupDraft(api, isCreateRoute ? '' : selectedGroup?.id, nextReview.payload)
    setIsSaving(false)
    if (!result.ok) {
      setMessage({
        tone: 'danger',
        title: 'Delivery Group could not be saved.',
        body:
          result.code === 'SERVICE_ALREADY_ASSIGNED'
            ? 'DXCP could not save this Delivery Group because one or more selected applications already belong to another Delivery Group.'
            : result.errorMessage
      })
      return
    }
    await loadWorkspace({ bypassCache: true })
    setMessage({
      tone: 'neutral',
      title: isCreateRoute ? 'Delivery Group created.' : 'Delivery Group saved.',
      body: isCreateRoute
        ? 'DXCP created the governance object and kept environment policy scope separate from this edit flow.'
        : 'DXCP saved the governance change after review.'
    })
    navigate(`/new/admin/delivery-groups/${encodeURIComponent(result.group?.id || nextReview.payload.id)}`)
  }

  if (workspaceState.kind === 'loading') {
    return (
      <SectionCard className="new-admin-card">
        <div className="new-card-loading" aria-label="Loading delivery groups" aria-live="polite" aria-busy="true">
          <LoadingText>Loading...</LoadingText>
          <div className="new-card-loading-lines" aria-hidden="true">
            <div className="new-card-loading-line new-card-loading-line-1" />
            <div className="new-card-loading-line new-card-loading-line-2" />
            <div className="new-card-loading-line new-card-loading-line-3" />
          </div>
        </div>
      </SectionCard>
    )
  }

  if (workspaceState.kind === 'failure') {
    return (
      <SectionCard className="new-admin-card">
        <NewStateBlock eyebrow="Failure" title="Delivery Groups could not be loaded" tone="danger" actions={[{ label: 'Retry', onClick: () => loadWorkspace({ bypassCache: true }) }]}>
          {workspaceState.errorMessage || 'DXCP could not load Delivery Group administration data right now.'}
        </NewStateBlock>
      </SectionCard>
    )
  }

  if (!groupId && !isCreateRoute) {
    const hasNoResults = groups.length > 0 && filteredGroups.length === 0
    return (
      <div className="new-admin-stack">
        <SectionCard className="new-admin-card">
          <div className="new-admin-panel-header">
            <div>
              <h3>Delivery Groups</h3>
              <p>Review governance boundaries for service membership, recipe authorization, and guardrails.</p>
            </div>
            <div className="new-admin-toolbar-actions">
              <NewRefreshButton onClick={() => loadWorkspace({ bypassCache: true })} busy={workspaceState.kind === 'refreshing'} />
              {canEdit ? <button className="button" type="button" onClick={beginCreate}>Create group</button> : null}
            </div>
          </div>
          <div className="new-admin-inline-summary" aria-label="Delivery group summary">
            <div className="new-admin-inline-summary-item"><span>Configured</span><strong>{groups.length}</strong></div>
            <div className="new-admin-inline-summary-item"><span>Applications</span><strong>{groups.reduce((total, group) => total + group.services.length, 0)}</strong></div>
            <div className="new-admin-inline-summary-item"><span>Allowed recipes</span><strong>{groups.reduce((total, group) => total + group.allowedRecipes.length, 0)}</strong></div>
            <div className="new-admin-inline-summary-item"><span>View</span><strong>{canEdit ? 'Admin' : 'Read-only'}</strong></div>
          </div>
          {workspaceState.viewModel?.degradedReasons?.length > 0 ? (
            <NewExplanation title="Supporting admin reads are degraded" tone="warning">{workspaceState.viewModel.degradedReasons.join(' ')}</NewExplanation>
          ) : null}
          {!canEdit ? (
            <NewExplanation title="Read-only governance posture">Delivery Group details remain readable here. Platform Admin access is required for create and update actions.</NewExplanation>
          ) : null}
          {message.title ? <NewExplanation title={message.title} tone={message.tone || 'neutral'}>{message.body}</NewExplanation> : null}
          <div className="new-admin-surface-card">
            <div className="new-applications-chooser-toolbar">
              <label className="new-applications-search" htmlFor="admin-delivery-group-search">
                <span>Search</span>
                <input id="admin-delivery-group-search" type="search" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Search delivery groups" aria-label="Search delivery groups" />
              </label>
            </div>
            {groups.length === 0 ? (
              <NewStateBlock eyebrow="Empty" title="No Delivery Groups are configured" actions={canEdit ? [{ label: 'Create group', onClick: beginCreate }] : []}>
                Delivery Groups define who can deploy and when. Create one to establish service membership, recipe authorization, and guardrails.
              </NewStateBlock>
            ) : hasNoResults ? (
              <NewStateBlock eyebrow="No results" title="No Delivery Groups match this search" tone="warning" actions={[{ label: 'Clear search', onClick: () => setSearchTerm('') }]}>
                Try a different name, owner, application, or recipe identifier.
              </NewStateBlock>
            ) : (
              <OperationalDataList
                ariaLabel="Delivery Groups collection"
                columns={DELIVERY_GROUP_COLUMNS}
                rows={filteredGroups}
                footerSummary={`${filteredGroups.length} delivery group${filteredGroups.length === 1 ? '' : 's'}`}
                getRowKey={(group) => group.id}
                getRowAction={(group) => ({ label: `Open ${group.name || group.id}`, onClick: () => openGroup(group.id) })}
                renderCell={(group, column) => {
                  if (column.key === 'name') return <div className="new-application-name-cell"><span className="new-application-name">{group.name || group.id}</span><span className="new-operational-text">{group.id}</span></div>
                  if (column.key === 'owner') return <span className="new-operational-text">{summarizeOwner(group.owner)}</span>
                  if (column.key === 'applications') return <span className="new-operational-text">{group.services.length}</span>
                  if (column.key === 'recipes') return <span className="new-operational-text">{group.allowedRecipes.length}</span>
                  if (column.key === 'guardrails') return <span className="new-operational-text">{summarizeGuardrails(group.guardrails)}</span>
                  if (column.key === 'updated') return <span className="new-operational-text">{formatTimestamp(group.updatedAt)}</span>
                  return null
                }}
                renderSecondaryRow={(group) => <p className="operational-list-note">{group.description || 'No description provided.'}</p>}
              />
            )}
          </div>
        </SectionCard>
      </div>
    )
  }

  if (!isCreateRoute && !selectedGroup) {
    return (
      <SectionCard className="new-admin-card">
        <NewStateBlock eyebrow="Unavailable" title="Delivery Group not found" tone="warning" actions={[{ label: 'Back to Delivery Groups', onClick: backToCollection }]}>
          DXCP could not find that Delivery Group. Return to the collection to choose a current governance object.
        </NewStateBlock>
      </SectionCard>
    )
  }

  const actionNote =
    !canEdit
      ? 'Platform Admin access is required to change Delivery Group membership, allowed recipes, or guardrails.'
      : mode === 'edit' && workspaceState.viewModel?.mutationsDisabled === true
        ? 'DXCP mutations are currently disabled. Save remains blocked until mutations are re-enabled.'
        : mode === 'edit' && workspaceState.viewModel?.mutationAvailability === 'unknown'
          ? 'DXCP could not confirm mutation availability. Refresh before saving this governance change.'
          : ''

  const primaryAction = !canEdit
    ? { label: 'Edit group', state: 'read-only' }
    : mode === 'view'
      ? { label: 'Edit group', onClick: beginEdit }
      : {
          label: isSaving ? 'Saving...' : isCreateRoute ? 'Save group' : 'Save changes',
          onClick: saveDraft,
          disabled:
            isSaving ||
            (!hasChanges && !isCreateRoute) ||
            workspaceState.viewModel?.mutationsDisabled === true ||
            workspaceState.viewModel?.mutationAvailability === 'unknown'
        }

  const secondaryActions = []
  if (canEdit && mode === 'edit') secondaryActions.push({ label: 'Cancel', onClick: cancelEditing })

  return (
    <div className="new-admin-stack">
      <NewExperiencePageHeader
        title="DELIVERY GROUP"
        objectIdentity={summaryGroup.name || (isCreateRoute ? 'Create delivery group' : summaryGroup.id)}
        backToCollection={{ label: 'Back to Delivery Groups', onClick: backToCollection }}
        primaryAction={primaryAction}
        secondaryActions={secondaryActions}
        actionNote={actionNote}
        role={role}
      />
      {workspaceState.viewModel?.degradedReasons?.length > 0 ? (
        <NewExplanation title="Supporting admin reads are degraded" tone="warning">{workspaceState.viewModel.degradedReasons.join(' ')}</NewExplanation>
      ) : null}
      {message.title ? <NewExplanation title={message.title} tone={message.tone || 'neutral'}>{message.body}</NewExplanation> : null}

      <SectionCard className="new-admin-surface-card">
        <div className="new-section-header"><div><h3>Summary</h3></div></div>
        <DefinitionGrid className="new-object-summary-grid">
          <DefinitionRow label="Group ID" value={summaryGroup.id || 'Assigned on save'} />
          <DefinitionRow label="Owner" value={summarizeOwner(summaryGroup.owner)} />
          <DefinitionRow label="Applications count" value={String(summaryGroup.services.length)} />
          <DefinitionRow label="Allowed recipes count" value={String(summaryGroup.allowedRecipes.length)} />
          <DefinitionRow label="Guardrails summary" value={summarizeGuardrails(summaryGroup.guardrails)} />
          <DefinitionRow label="Environment scope" value={summarizeEnvironmentScope(summaryGroup)} />
        </DefinitionGrid>
      </SectionCard>

      <NewSegmentedTabs
        ariaLabel="Delivery Group detail tabs"
        activeTab={detailTab}
        onChange={setDetailTab}
        tabs={[
          { id: 'details', label: 'Details' },
          { id: 'membership', label: 'Applications' },
          { id: 'guardrails', label: 'Guardrails' }
        ]}
      />

      <SectionCard className="new-admin-surface-card">
        {mode === 'edit' && localReview.errors.length > 0 ? (
          <NewExplanation title="Resolve these Delivery Group issues" tone="danger">{localReview.errors.map((item) => item.text).join(' ')}</NewExplanation>
        ) : null}
        {mode === 'edit' && localReview.warnings.length > 0 ? (
          <div className="new-admin-stack">
            <NewExplanation title="Warnings need confirmation" tone="warning">{localReview.warnings.map((item) => item.text).join(' ')}</NewExplanation>
            {canEdit ? <label className="new-admin-checkbox"><input type="checkbox" checked={warningAcknowledged} onChange={(event) => setWarningAcknowledged(event.target.checked)} /><span>Acknowledge warnings before save</span></label> : null}
          </div>
        ) : null}
        {detailTab === 'details' ? (
          <div className="new-admin-stack">
            <div className="new-section-header"><div><h3>Details</h3></div></div>
            {(summaryGroup.allowedEnvironments || []).length > 0 ? (
              <NewExplanation title="Environment policy scope is read-only here">{`${summarizeEnvironmentScope(summaryGroup)}. Manage environment scope from the Delivery Group Environment Policy tab.`}</NewExplanation>
            ) : null}
            {mode === 'view' || !canEdit ? (
              <DefinitionGrid>
                <DefinitionRow label="Group ID" value={summaryGroup.id || 'Not set'} />
                <DefinitionRow label="Name" value={summaryGroup.name || 'Not set'} />
                <DefinitionRow label="Description" value={summaryGroup.description || 'No description provided.'} />
                <DefinitionRow label="Owner emails" value={summaryGroup.owner || 'Owners not provided'} />
                <DefinitionRow label="Allowed environments" value={summarizeEnvironmentScope(summaryGroup)} />
                <DefinitionRow label="Created at" value={formatTimestamp(summaryGroup.createdAt)} />
                <DefinitionRow label="Created by" value={summaryGroup.createdBy || 'Not recorded'} />
                <DefinitionRow label="Updated at" value={formatTimestamp(summaryGroup.updatedAt)} />
                <DefinitionRow label="Updated by" value={summaryGroup.updatedBy || 'Not recorded'} />
                <DefinitionRow label="Last change reason" value={summaryGroup.lastChangeReason || 'Not recorded'} />
              </DefinitionGrid>
            ) : (
              <>
                <div className="new-admin-editor-note">
                  <strong>{isCreateRoute ? 'Choose a stable group ID' : 'Group ID is locked'}</strong>
                  <p>{isCreateRoute ? 'Delivery Groups are governance objects. Choose an ID that can remain stable as services, recipes, and guardrails evolve.' : 'DXCP keeps the Delivery Group ID stable so membership, policy scope, and audit history remain coherent.'}</p>
                </div>
                <div className="new-intent-entry-grid">
                  <label className="new-field" htmlFor="admin-dg-id"><span>Group ID</span><input id="admin-dg-id" value={draft?.id || ''} disabled={!isCreateRoute} onChange={(event) => setDraft((current) => ({ ...current, id: event.target.value }))} /></label>
                  <label className="new-field" htmlFor="admin-dg-name"><span>Name</span><input id="admin-dg-name" value={draft?.name || ''} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} /></label>
                  <label className="new-field" htmlFor="admin-dg-description" style={{ gridColumn: '1 / -1' }}><span>Description</span><textarea id="admin-dg-description" rows={3} value={draft?.description || ''} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} /></label>
                  <label className="new-field" htmlFor="admin-dg-owner" style={{ gridColumn: '1 / -1' }}><span>Owner emails</span><input id="admin-dg-owner" value={draft?.owner || ''} onChange={(event) => setDraft((current) => ({ ...current, owner: event.target.value }))} placeholder="team@example.com, owner@example.com" /></label>
                </div>
                <div className="new-section-header"><div><h3>Allowed recipes</h3></div></div>
                <SelectionList items={recipeOptions} selectedItems={draft?.allowedRecipes || []} onToggle={(value) => toggleDraftItem('allowedRecipes', value)} disabled={!canEdit} ariaLabel="Allowed recipes" />
                <label className="new-field" htmlFor="admin-dg-change-reason"><span>Change reason</span><textarea id="admin-dg-change-reason" rows={3} value={draft?.changeReason || ''} onChange={(event) => setDraft((current) => ({ ...current, changeReason: event.target.value }))} placeholder="Optional note for why this Delivery Group changed" /></label>
              </>
            )}
          </div>
        ) : detailTab === 'membership' ? (
          <div className="new-admin-stack">
            <div className="new-section-header"><div><h3>Applications</h3></div></div>
            {membershipChange.added.length > 0 || membershipChange.removed.length > 0 ? (
              <NewExplanation title="Application changes">{[membershipChange.added.length > 0 ? `Added: ${membershipChange.added.join(', ')}.` : '', membershipChange.removed.length > 0 ? `Removed: ${membershipChange.removed.join(', ')}.` : ''].filter(Boolean).join(' ')}</NewExplanation>
            ) : null}
            {localReview.errors.filter((item) => item.id?.startsWith('service-conflict-')).length > 0 ? (
              <NewExplanation title="Some applications already belong to another Delivery Group" tone="danger">{localReview.errors.filter((item) => item.id?.startsWith('service-conflict-')).map((item) => item.text).join(' ')}</NewExplanation>
            ) : null}
            {mode === 'view' || !canEdit ? (
              summaryGroup.services.length === 0 ? <p className="new-operational-text">No applications are assigned to this Delivery Group.</p> : (
                <OperationalDataList ariaLabel="Delivery Group applications" columns={MEMBERSHIP_COLUMNS} rows={summaryGroup.services.map((service) => ({ service }))} footerSummary={`${summaryGroup.services.length} application${summaryGroup.services.length === 1 ? '' : 's'}`} getRowKey={(row) => row.service} renderCell={(row) => <span className="new-operational-text">{row.service}</span>} />
              )
            ) : (
              <SelectionList items={serviceOptions} selectedItems={draft?.services || []} onToggle={(value) => toggleDraftItem('services', value)} disabled={!canEdit} ariaLabel="Delivery Group applications" />
            )}
          </div>
        ) : detailTab === 'guardrails' ? (
          <div className="new-admin-stack">
            <div className="new-section-header"><div><h3>Guardrails</h3></div></div>
            {(workspaceState.viewModel?.mutationsDisabled === true || workspaceState.viewModel?.mutationAvailability === 'unknown') && mode === 'edit' ? (
              <NewExplanation title={workspaceState.viewModel?.mutationsDisabled === true ? 'Save is blocked' : 'Save availability is unknown'} tone="warning">
                {workspaceState.viewModel?.mutationsDisabled === true ? 'DXCP mutations are disabled. This Delivery Group cannot be saved until mutations are re-enabled.' : 'DXCP could not confirm mutation availability. Refresh before saving this Delivery Group.'}
              </NewExplanation>
            ) : null}
            {mode === 'view' || !canEdit ? (
              <DefinitionGrid>
                <DefinitionRow label="Max concurrent deployments" value={String(summaryGroup.guardrails.maxConcurrentDeployments)} />
                <DefinitionRow label="Daily deploy quota" value={String(summaryGroup.guardrails.dailyDeployQuota)} />
                <DefinitionRow label="Daily rollback quota" value={String(summaryGroup.guardrails.dailyRollbackQuota)} />
              </DefinitionGrid>
            ) : (
              <div className="new-intent-entry-grid">
                <label className="new-field" htmlFor="admin-dg-max-concurrent"><span>Max concurrent deployments</span><input id="admin-dg-max-concurrent" type="number" min="1" value={draft?.maxConcurrentDeployments || ''} onChange={(event) => setDraft((current) => ({ ...current, maxConcurrentDeployments: event.target.value }))} /></label>
                <label className="new-field" htmlFor="admin-dg-daily-deploy"><span>Daily deploy quota</span><input id="admin-dg-daily-deploy" type="number" min="1" value={draft?.dailyDeployQuota || ''} onChange={(event) => setDraft((current) => ({ ...current, dailyDeployQuota: event.target.value }))} /></label>
                <label className="new-field" htmlFor="admin-dg-daily-rollback"><span>Daily rollback quota</span><input id="admin-dg-daily-rollback" type="number" min="1" value={draft?.dailyRollbackQuota || ''} onChange={(event) => setDraft((current) => ({ ...current, dailyRollbackQuota: event.target.value }))} /></label>
              </div>
            )}
          </div>
        ) : null}
      </SectionCard>
    </div>
  )
}
