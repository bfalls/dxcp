import React from 'react'

export function NewExperienceAdminSectionStrip({
  tabs,
  activeTab,
  onSelectTab
}) {
  return (
    <section className="new-admin-subsection-strip" aria-label="Admin sections">
      <div className="new-admin-subsection-strip-inner">
        <div className="new-admin-subsection-tab-row" role="tablist" aria-label="Admin sub-tabs">
          {tabs.map((tab) => {
            const isActive = tab.id === activeTab
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-controls="new-admin-workspace-panel"
                className={`new-admin-subsection-tab${isActive ? ' is-active' : ''}`}
                onClick={() => onSelectTab(tab.id)}
              >
                <span className="new-admin-subsection-tab-label">{tab.label}</span>
              </button>
            )
          })}
        </div>
      </div>
    </section>
  )
}

export default function NewExperienceAdminWorkspaceShell({
  children
}) {
  return (
    <div className="new-admin-workspace">
      <section id="new-admin-workspace-panel" className="new-admin-panel-region" aria-label="Admin workspace">
        {children}
      </section>
    </div>
  )
}
