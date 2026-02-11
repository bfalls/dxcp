import React from 'react'
import PageHeader from '../components/PageHeader.jsx'
import SectionCard from '../components/SectionCard.jsx'

export default function SettingsPage({
  minRefreshSeconds,
  maxRefreshSeconds,
  refreshMinutesInput,
  handleRefreshMinutesChange,
  userSettingsKey,
  defaultRefreshSeconds,
  refreshInputError,
  refreshClampNote,
  refreshIntervalMinutes,
  isPlatformAdmin,
  adminSettings
}) {
  return (
    <div className="shell">
      <div className="page-header-zone">
        <PageHeader
          title="Settings"
          subtitle="Control auto-refresh behavior for the UI."
        />
      </div>
      <SectionCard>
        <h2>User settings</h2>
        <div className="field">
          <label htmlFor="refresh-interval-minutes">Auto-refresh interval (minutes)</label>
          <input
            id="refresh-interval-minutes"
            type="number"
            min={Math.ceil(minRefreshSeconds / 60)}
            max={Math.floor(maxRefreshSeconds / 60)}
            step="1"
            value={refreshMinutesInput}
            onChange={(e) => handleRefreshMinutesChange(e.target.value)}
            onInput={(e) => handleRefreshMinutesChange(e.target.value)}
            disabled={!userSettingsKey}
          />
          <div className="helper">Default is {Math.round(defaultRefreshSeconds / 60)} minutes.</div>
          <div className="helper">Applies to versions and deployment detail refresh.</div>
          {refreshInputError && <div className="helper">{refreshInputError}</div>}
          {refreshClampNote && <div className="helper">{refreshClampNote}</div>}
          <div className="helper">Resolved refresh interval: {refreshIntervalMinutes} minutes.</div>
        </div>
      </SectionCard>
      {isPlatformAdmin && (
        <SectionCard>
          <h2>Admin defaults</h2>
          <div className="helper">Config-driven defaults and guardrails.</div>
          <div className="list space-8">
            <div className="list-item">
              <div>Default</div>
              <div>{Math.round((adminSettings?.default_refresh_interval_seconds ?? defaultRefreshSeconds) / 60)} minutes</div>
            </div>
            <div className="list-item">
              <div>Minimum</div>
              <div>{Math.round((adminSettings?.min_refresh_interval_seconds ?? minRefreshSeconds) / 60)} minutes</div>
            </div>
            <div className="list-item">
              <div>Maximum</div>
              <div>{Math.round((adminSettings?.max_refresh_interval_seconds ?? maxRefreshSeconds) / 60)} minutes</div>
            </div>
          </div>
        </SectionCard>
      )}
    </div>
  )
}
