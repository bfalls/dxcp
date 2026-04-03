import React from 'react'

export default function NewSegmentedTabs({
  tabs = [],
  activeTab,
  onChange,
  ariaLabel = 'Segmented tabs',
  className = ''
}) {
  return (
    <div className={`new-segmented-tabs${className ? ` ${className}` : ''}`} role="tablist" aria-label={ariaLabel}>
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            className={`new-segmented-tab${isActive ? ' is-active' : ''}`}
            onClick={() => {
              if (tab.disabled) return
              onChange?.(tab.id)
            }}
            disabled={tab.disabled}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}
