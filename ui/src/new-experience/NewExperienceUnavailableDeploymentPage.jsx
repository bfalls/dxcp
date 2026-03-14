import React from 'react'
import { useParams } from 'react-router-dom'
import NewExperiencePageHeader from './NewExperiencePageHeader.jsx'
import { NewStateBlock } from './NewExperienceStatePrimitives.jsx'

export default function NewExperienceUnavailableDeploymentPage() {
  const { deploymentId = 'unknown' } = useParams()

  return (
    <>
      <NewExperiencePageHeader
        title="Deployment"
        objectIdentity={`Deployment: ${deploymentId}`}
        stateSummaryItems={[{ label: 'Route state', value: 'Unavailable' }]}
        primaryAction={{ label: 'Rollback', state: 'unavailable' }}
      />
      <NewStateBlock
        eyebrow="Unavailable route"
        title="Deployment detail is not available on this route"
        tone="danger"
        actions={[
          { label: 'Open Applications', to: '/new/applications', secondary: true },
          { label: 'Open Legacy Deployment', to: '/deployments/dep-1' }
        ]}
      >
        Open one of the visible deployment routes in this experience, or continue in the legacy deployment route for the full record and timeline.
      </NewStateBlock>
    </>
  )
}
