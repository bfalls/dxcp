import React from 'react'
import { Link } from 'react-router-dom'
import LoadingText from './LoadingText.jsx'

export default function OperationalDataList({
  columns = [],
  rows = [],
  getRowKey,
  renderCell,
  renderSecondaryRow,
  ariaLabel = 'Operational list',
  getRowAction,
  isLoading = false,
  loadingMessage = 'Loading...',
  footerSummary = ''
}) {
  const gridTemplateColumns = columns.map((column) => column.width || 'minmax(0, 1fr)').join(' ')

  return (
    <div className="operational-list" style={{ '--operational-list-columns': gridTemplateColumns }}>
      <div className="operational-list-scroll">
        <div className="operational-list-table" role="table" aria-label={ariaLabel}>
          <div className="operational-list-header-group" role="rowgroup">
            <div className="operational-list-row operational-list-row-header" role="row">
              {columns.map((column) => (
                <div
                  key={column.key}
                  className={`operational-list-cell operational-list-cell-header${column.headerClassName ? ` ${column.headerClassName}` : ''}`}
                  role="columnheader"
                >
                  {column.label}
                </div>
              ))}
            </div>
          </div>
          <div className="operational-list-body" role="rowgroup">
            {isLoading ? (
              <div className="operational-list-loading-row" role="row">
                <div className="operational-list-loading-cell" role="cell">
                  <LoadingText>{loadingMessage}</LoadingText>
                </div>
              </div>
            ) : null}
            {rows.map((row, index) => {
              const secondaryRow = renderSecondaryRow ? renderSecondaryRow(row, index) : null
              const rowAction = getRowAction ? getRowAction(row, index) : null
              return (
                <div
                  key={getRowKey(row, index)}
                  className={`operational-list-item${rowAction ? ' operational-list-item-interactive' : ''}`}
                >
                  {rowAction ? (
                    rowAction.to ? (
                      <Link
                        className="operational-list-row-action-surface"
                        to={rowAction.to}
                        state={rowAction.state}
                        aria-label={rowAction.label}
                      />
                    ) : (
                      <button
                        className="operational-list-row-action-surface"
                        type="button"
                        onClick={rowAction.onClick}
                        aria-label={rowAction.label}
                      />
                    )
                  ) : null}
                  <div className="operational-list-row" role="row">
                    {columns.map((column) => (
                      <div
                        key={column.key}
                        className={`operational-list-cell${column.cellClassName ? ` ${column.cellClassName}` : ''}${
                          column.isAction ? ' operational-list-cell-interactive-control' : ''
                        }`}
                        role="cell"
                      >
                        {renderCell(row, column, index)}
                      </div>
                    ))}
                  </div>
                  {secondaryRow ? (
                    <div className="operational-list-secondary" role="row">
                      <div className="operational-list-secondary-cell" role="cell">
                        {secondaryRow}
                      </div>
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
          {footerSummary && !isLoading ? (
            <div className="operational-list-footer-group" role="rowgroup">
              <div className="operational-list-footer-row" role="row">
                <div className="operational-list-footer-cell" role="cell">
                  <span className="operational-list-footer-summary">{footerSummary}</span>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
