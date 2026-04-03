import React from 'react'
import { Link } from 'react-router-dom'

function ChevronLeftIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M9.5 3.5 5 8l4.5 4.5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.75"
      />
    </svg>
  )
}

export default function NewBackToCollectionButton({
  label = 'Back',
  to,
  onClick,
  className = ''
}) {
  const classes = `new-back-to-collection${className ? ` ${className}` : ''}`
  const content = (
    <>
      <ChevronLeftIcon />
      <span>{label}</span>
    </>
  )

  if (to) {
    return (
      <Link className={classes} to={to}>
        {content}
      </Link>
    )
  }

  return (
    <button className={classes} type="button" onClick={onClick}>
      {content}
    </button>
  )
}
