import React, { useId, useState } from 'react'
import { Link } from 'react-router-dom'

const MAX_VISIBLE_CONTEXT_ISSUES = 2

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

function isOverflowSelection(items, selectedKey) {
  return items.slice(MAX_VISIBLE_CONTEXT_ISSUES).some((item, index) => getIssueKey(item, index + MAX_VISIBLE_CONTEXT_ISSUES) === selectedKey)
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

function getContextRailSummary(items) {
  if (!Array.isArray(items) || items.length === 0) return ''
  if (items.length === 1) return items[0].summary || items[0].title || '1 issue'
  return `${items.length} page issues`
}

export function NewPageContextRail({ items = [], defaultExpanded = false, sticky = false }) {
  const normalizedItems = Array.isArray(items) ? items : []

  const [selectedIssueKey, setSelectedIssueKey] = useState(defaultExpanded && normalizedItems.length > 0 ? getIssueKey(normalizedItems[0], 0) : null)
  const [showOverflow, setShowOverflow] = useState(defaultExpanded)
  const detailsId = useId()
  const overflowId = useId()
  const visibleItems = normalizedItems.slice(0, MAX_VISIBLE_CONTEXT_ISSUES)
  const overflowItems = normalizedItems.slice(MAX_VISIBLE_CONTEXT_ISSUES)
  const selectedIssue = normalizedItems.find((item, index) => getIssueKey(item, index) === selectedIssueKey) || null

  if (normalizedItems.length === 0) return null

  const toggleIssue = (issueKey) => {
    setSelectedIssueKey((current) => (current === issueKey ? null : issueKey))
  }

  const toggleOverflow = () => {
    setShowOverflow((current) => {
      const next = !current
      if (!next && isOverflowSelection(items, selectedIssueKey)) {
        setSelectedIssueKey(null)
      }
      return next
    })
  }

  return (
    <section
      className={`new-page-context-rail${sticky ? ' new-page-context-rail-sticky' : ''}`}
      aria-label="Page context issues"
      data-expanded={selectedIssue ? 'true' : 'false'}
    >
      <div className="new-page-context-rail-bar">
        <span className="new-page-context-rail-summary">{getContextRailSummary(normalizedItems)}</span>
        <div className="new-page-context-rail-button-group">
          {visibleItems.map((item, index) => {
            const issueKey = getIssueKey(item, index)
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
          {overflowItems.map((item, index) => {
            const issueKey = getIssueKey(item, index + MAX_VISIBLE_CONTEXT_ISSUES)
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
