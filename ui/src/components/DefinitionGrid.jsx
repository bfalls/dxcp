import React from 'react'

export function DefinitionRow({ label, value, valueClassName = '' }) {
  return (
    <>
      <dt className="definition-label" title={label}>
        {label}
      </dt>
      <dd className={`definition-value ${valueClassName}`.trim()}>{value}</dd>
    </>
  )
}

export default function DefinitionGrid({ children, className = '' }) {
  return (
    <dl className={`definition-grid ${className}`.trim()}>
      {children}
    </dl>
  )
}
