import React from 'react'
import { useLocation } from 'react-router-dom'
import NewExperiencePageHeader from './NewExperiencePageHeader.jsx'
import { NewStateBlock } from './NewExperienceStatePrimitives.jsx'
import { useNewExperienceAlertRail } from './NewExperienceShell.jsx'

export default function NewExperienceUnavailableRoutePage({ role = 'UNKNOWN' }) {
  const location = useLocation()

  useNewExperienceAlertRail([
    {
      id: 'new-route-unavailable',
      tone: 'danger',
      title: 'Route unavailable',
      body: `${location.pathname} is not available in the new experience yet.`
    }
  ])

  return (
    <>
      <NewExperiencePageHeader
        title="Unavailable route"
        objectIdentity={location.pathname}
        role={role}
        stateSummaryItems={[{ label: 'Route state', value: 'Unavailable' }]}
        primaryAction={{ label: 'Route', state: 'unavailable' }}
        secondaryActions={[
          { label: 'Open Applications', to: '/new/applications/payments-api' },
          { label: 'Open Legacy', to: '/services' }
        ]}
      />
      <NewStateBlock
        eyebrow="Unavailable route"
        title="This route is not available in the new experience"
        tone="danger"
        actions={[
          { label: 'Open Applications', to: '/new/applications/payments-api' },
          { label: 'Open Legacy', to: '/services', secondary: true }
        ]}
      >
        Open an available `/new/*` route, or continue in the legacy UI while rollout remains opt-in.
      </NewStateBlock>
    </>
  )
}
