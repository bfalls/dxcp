import React from 'react'
import { Link } from 'react-router-dom'

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
