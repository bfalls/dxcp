import React from 'react'
import NewExperiencePageHeader from './NewExperiencePageHeader.jsx'
import { NewStateBlock } from './NewExperienceStatePrimitives.jsx'

export default function NewExperienceUnavailableRoutePage() {
  return (
    <>
      <NewExperiencePageHeader
        title="Admin"
        objectIdentity="Admin workspace"
        stateSummaryItems={[{ label: 'Preview state', value: 'Unavailable' }]}
        primaryAction={{ label: 'Admin', state: 'unavailable' }}
      />
      <NewStateBlock
        eyebrow="Unavailable route"
        title="Admin is not available in the new experience preview"
        tone="danger"
        actions={[
          { label: 'Open Applications', to: '/new/applications/payments-api', secondary: true },
          { label: 'Open Legacy Admin', to: '/admin' }
        ]}
      >
        This route stays out of scope until the Admin slice is implemented. Continue in the legacy workspace for
        governance tasks.
      </NewStateBlock>
    </>
  )
}
