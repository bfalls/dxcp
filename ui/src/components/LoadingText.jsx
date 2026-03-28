import React from 'react'

export default function LoadingText({ children = 'Loading...', className = '' }) {
  return <span className={`loading-text ${className}`.trim()}>{children}</span>
}
