import React from 'react'

export default function NewExperienceAdminWorkspaceShell({
  tabs,
  activeTab,
  onSelectTab,
  children
}) {
  return (
    <div className="new-admin-workspace">
      <section className="new-admin-tab-shell" aria-label="Admin sections">
        <div className="new-admin-tab-shell-copy">
          <span className="new-admin-tab-shell-eyebrow">Governance workspace</span>
          <h2>Administration</h2>
          <p>Choose one governance object at a time. Each tab keeps Admin scoped, reviewable, and deep-linkable.</p>
        </div>
        <div className="new-admin-tab-row" role="tablist" aria-label="Admin sub-tabs">
          {tabs.map((tab) => {
            const isActive = tab.id === activeTab
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                className={`new-admin-tab-pill${isActive ? ' is-active' : ''}`}
                onClick={() => onSelectTab(tab.id)}
              >
                <span className="new-admin-tab-pill-label">{tab.label}</span>
                <span className="new-admin-tab-pill-description">{tab.shortLabel || tab.description}</span>
              </button>
            )
          })}
        </div>
      </section>
      <div className="new-admin-panel-region">{children}</div>
    </div>
  )
}
