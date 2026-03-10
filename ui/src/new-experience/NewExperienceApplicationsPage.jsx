import React from 'react'
import { useParams } from 'react-router-dom'
import SectionCard from '../components/SectionCard.jsx'
import NewExperiencePageHeader from './NewExperiencePageHeader.jsx'

export default function NewExperienceApplicationsPage({ role = 'UNKNOWN' }) {
  const { applicationName = 'payments-api' } = useParams()
  const isReadOnly = role === 'OBSERVER'

  const secondaryActions = [
    { label: 'Open Deployments', disabled: false },
    { label: 'Refresh', disabled: false }
  ]

  const primaryAction = {
    label: 'Deploy',
    disabled: isReadOnly,
    description: isReadOnly ? 'Observers are read-only in the new experience.' : ''
  }

  return (
    <>
      <NewExperiencePageHeader
        title="Applications"
        objectIdentity={`Application: ${applicationName}`}
        role={role}
        stateSummaryItems={[
          { label: 'Running Version', value: 'v1.32.1' },
          { label: 'Environment', value: 'sandbox' },
          { label: 'State', value: 'Succeeded' }
        ]}
        primaryAction={primaryAction}
        secondaryActions={secondaryActions}
        readOnlyNote={isReadOnly ? 'Deploy unavailable in read-only mode.' : ''}
      />
      <SectionCard>
        <p className="helper">
          Slice 2 proof surface: page header contract, object identity, action slots, state adjacency, and compression.
        </p>
      </SectionCard>
    </>
  )
}
