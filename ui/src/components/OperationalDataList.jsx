import React from 'react'

export default function OperationalDataList({
  columns = [],
  rows = [],
  getRowKey,
  renderCell,
  renderSecondaryRow,
  ariaLabel = 'Operational list'
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
            {rows.map((row, index) => {
              const secondaryRow = renderSecondaryRow ? renderSecondaryRow(row, index) : null
              return (
                <div key={getRowKey(row, index)} className="operational-list-item">
                  <div className="operational-list-row" role="row">
                    {columns.map((column) => (
                      <div
                        key={column.key}
                        className={`operational-list-cell${column.cellClassName ? ` ${column.cellClassName}` : ''}`}
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
        </div>
      </div>
    </div>
  )
}
