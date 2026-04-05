import React from 'react'

export default function LoadingText({ children = 'Loading...', className = '' }) {
  const text = typeof children === 'string' ? children : 'Loading...'

  return (
    <span className={`loading-text ${className}`.trim()} aria-label={text}>
      {Array.from(text).map((character, index) => (
        <span
          key={`${character}-${index}`}
          className="loading-text-char"
          style={{ '--loading-char-index': index, '--loading-char-count': text.length }}
          aria-hidden="true"
        >
          {character === ' ' ? '\u00A0' : character}
        </span>
      ))}
    </span>
  )
}
