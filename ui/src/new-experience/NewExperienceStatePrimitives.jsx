import React, { useEffect, useId, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

const DEFAULT_MAX_VISIBLE_CONTEXT_ISSUES = 2

function getIssueKey(item, index) {
  return item.id || `${item.title || 'issue'}-${index}`
}

function getIssueSummary(item) {
  return item.summary || item.title || 'Issue'
}

function getToneLabel(tone) {
  if (tone === 'danger') return 'Danger'
  if (tone === 'warning') return 'Warning'
  if (tone === 'success') return 'Success'
  return 'Note'
}

function normalizeIssue(item, index) {
  const actions = Array.isArray(item?.actions)
    ? item.actions
    : item?.action
      ? [item.action]
      : []

  return {
    ...item,
    id: getIssueKey(item, index),
    summary: getIssueSummary(item),
    title: item?.title || getIssueSummary(item),
    tone: item?.tone || 'neutral',
    actions
  }
}

function isOverflowSelection(items, selectedKey, maxVisibleItems) {
  return items
    .slice(maxVisibleItems)
    .some((item, index) => item.id === getIssueKey(item, index + maxVisibleItems) || item.id === selectedKey)
}

export function NewExplanation({ title, children, tone = 'neutral', actions = [] }) {
  return (
    <div className={`new-explanation new-explanation-${tone}`}>
      <div className="new-explanation-copy">
        <strong>{title}</strong>
        <div>{children}</div>
      </div>
      {actions.length > 0 ? (
        <div className="new-explanation-actions">
          {actions.map((action) => (
            <Link
              key={`${action.to}-${action.label}`}
              className={`link${action.secondary ? ' secondary' : ''}`}
              to={action.to}
            >
              {action.label}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function getContextRailSummary(items, summary) {
  if (summary) return summary
  if (!Array.isArray(items) || items.length === 0) return ''
  if (items.length === 1) return '1 page issue'
  return `${items.length} page issues`
}

export function NewPageContextRail({
  items = [],
  summary = '',
  defaultExpanded = false,
  defaultExpandedIssueId,
  sticky = false,
  ariaLabel = 'Page context issues',
  maxVisibleItems = DEFAULT_MAX_VISIBLE_CONTEXT_ISSUES
}) {
  const normalizedItems = useMemo(
    () => (Array.isArray(items) ? items : []).map((item, index) => normalizeIssue(item, index)),
    [items]
  )

  const [selectedIssueKey, setSelectedIssueKey] = useState(
    defaultExpandedIssueId || (defaultExpanded && normalizedItems.length > 0 ? normalizedItems[0].id : null)
  )
  const [showOverflow, setShowOverflow] = useState(defaultExpanded)
  const detailsId = useId()
  const overflowId = useId()
  const visibleItems = normalizedItems.slice(0, maxVisibleItems)
  const overflowItems = normalizedItems.slice(maxVisibleItems)
  const selectedIssue = normalizedItems.find((item) => item.id === selectedIssueKey) || null

  useEffect(() => {
    if (defaultExpandedIssueId && normalizedItems.some((item) => item.id === defaultExpandedIssueId)) {
      setSelectedIssueKey(defaultExpandedIssueId)
      return
    }
    if (selectedIssueKey && !normalizedItems.some((item) => item.id === selectedIssueKey)) {
      setSelectedIssueKey(defaultExpanded && normalizedItems[0] ? normalizedItems[0].id : null)
    }
  }, [defaultExpanded, defaultExpandedIssueId, normalizedItems, selectedIssueKey])

  useEffect(() => {
    if (!showOverflow && overflowItems.some((item) => item.id === selectedIssueKey)) {
      setSelectedIssueKey(null)
    }
  }, [overflowItems, selectedIssueKey, showOverflow])

  if (normalizedItems.length === 0) return null

  const toggleIssue = (issueKey) => {
    setSelectedIssueKey((current) => (current === issueKey ? null : issueKey))
  }

  const toggleOverflow = () => {
    setShowOverflow((current) => {
      const next = !current
      if (!next && isOverflowSelection(normalizedItems, selectedIssueKey, maxVisibleItems)) {
        setSelectedIssueKey(null)
      }
      return next
    })
  }

  return (
    <section
      className={`new-page-context-rail${sticky ? ' new-page-context-rail-sticky' : ''}`}
      aria-label={ariaLabel}
      data-expanded={selectedIssue ? 'true' : 'false'}
    >
      <div className="new-page-context-rail-bar">
        <span className="new-page-context-rail-summary">{getContextRailSummary(normalizedItems, summary)}</span>
        <div className="new-page-context-rail-button-group">
          {visibleItems.map((item) => {
            const issueKey = item.id
            const isSelected = selectedIssueKey === issueKey
            return (
              <button
                key={issueKey}
                className={`new-page-context-rail-issue-button new-page-context-rail-issue-button-${item.tone || 'neutral'}${isSelected ? ' is-selected' : ''}`}
                type="button"
                aria-expanded={isSelected}
                aria-controls={detailsId}
                aria-label={`${getToneLabel(item.tone)} issue: ${getIssueSummary(item)}`}
                onClick={() => toggleIssue(issueKey)}
              >
                <span className="new-page-context-rail-issue-severity">{getToneLabel(item.tone)}</span>
                <span className="new-page-context-rail-issue-summary">{getIssueSummary(item)}</span>
              </button>
            )
          })}

          {overflowItems.length > 0 ? (
            <button
              className={`new-page-context-rail-more-button${showOverflow ? ' is-expanded' : ''}`}
              type="button"
              aria-expanded={showOverflow}
              aria-controls={overflowId}
              onClick={toggleOverflow}
            >
              {showOverflow ? 'Hide more issues' : `${overflowItems.length} more issue${overflowItems.length === 1 ? '' : 's'}`}
            </button>
          ) : null}
        </div>
      </div>

          {showOverflow && overflowItems.length > 0 ? (
        <div className="new-page-context-rail-overflow" id={overflowId}>
          {overflowItems.map((item) => {
            const issueKey = item.id
            const isSelected = selectedIssueKey === issueKey
            return (
              <button
                key={issueKey}
                className={`new-page-context-rail-issue-button new-page-context-rail-issue-button-${item.tone || 'neutral'}${isSelected ? ' is-selected' : ''}`}
                type="button"
                aria-expanded={isSelected}
                aria-controls={detailsId}
                aria-label={`${getToneLabel(item.tone)} issue: ${getIssueSummary(item)}`}
                onClick={() => toggleIssue(issueKey)}
              >
                <span className="new-page-context-rail-issue-severity">{getToneLabel(item.tone)}</span>
                <span className="new-page-context-rail-issue-summary">{getIssueSummary(item)}</span>
              </button>
            )
          })}
        </div>
      ) : null}

      {selectedIssue ? (
        <div className="new-page-context-rail-details" id={detailsId}>
          <div className={`new-page-context-rail-item new-page-context-rail-item-${selectedIssue.tone || 'neutral'}`}>
            <div className="new-page-context-rail-item-copy">
              <div className="new-page-context-rail-item-heading">
                <span className={`new-page-context-rail-item-severity new-page-context-rail-item-severity-${selectedIssue.tone || 'neutral'}`}>
                  {getToneLabel(selectedIssue.tone)}
                </span>
                <strong>{selectedIssue.title || getIssueSummary(selectedIssue)}</strong>
              </div>
              <p>{selectedIssue.body}</p>
            </div>
            {selectedIssue.actions?.length ? (
              <div className="new-page-context-rail-item-actions">
                {selectedIssue.actions.map((action) => (
                  <Link
                    key={`${action.to}-${action.label}`}
                    className={`link${action.secondary ? ' secondary' : ''}`}
                    to={action.to}
                  >
                    {action.label}
                  </Link>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  )
}

export function NewStateBlock({ eyebrow, title, children, tone = 'neutral', actions = [] }) {
  return (
    <section className={`new-state-block new-state-block-${tone}`}>
      {eyebrow ? <div className="new-state-block-eyebrow">{eyebrow}</div> : null}
      <h3>{title}</h3>
      <div className="new-state-block-body">{children}</div>
      {actions.length > 0 ? (
        <div className="new-state-block-actions">
          {actions.map((action) =>
            action.to ? (
              <Link
                key={`${action.to}-${action.label}`}
                className={`button${action.secondary ? ' secondary' : ''}`}
                to={action.to}
              >
                {action.label}
              </Link>
            ) : (
              <button
                key={action.label}
                className={`button${action.secondary ? ' secondary' : ''}`}
                type="button"
                onClick={action.onClick}
              >
                {action.label}
              </button>
            )
          )}
        </div>
      ) : null}
    </section>
  )
}
