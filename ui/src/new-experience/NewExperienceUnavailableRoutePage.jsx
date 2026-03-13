import React from 'react'
import NewExperiencePageHeader from './NewExperiencePageHeader.jsx'
import { NewStateBlock } from './NewExperienceStatePrimitives.jsx'

export default function NewExperienceUnavailableRoutePage() {
  return (
    <>
      <NewExperiencePageHeader
        title="Admin"
        objectIdentity="Admin workspace"
        stateSummaryItems={[{ label: 'Route state', value: 'Unavailable' }]}
        primaryAction={{ label: 'Admin', state: 'unavailable' }}
      />
      <NewStateBlock
        eyebrow="Unavailable route"
        title="Admin is not available on this route"
        tone="danger"
        actions={[
          { label: 'Open Applications', to: '/new/applications/payments-api', secondary: true },
          { label: 'Open Legacy Admin', to: '/admin' }
        ]}
      >
        Continue in the current Admin workspace for governance tasks.
      </NewStateBlock>
    </>
  )
}
