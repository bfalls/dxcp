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
        stateSummaryItems={[{ label: 'Preview state', value: 'Unavailable' }]}
        primaryAction={{ label: 'Rollback', state: 'unavailable' }}
      />
      <NewStateBlock
        eyebrow="Unavailable route"
        title="Deployment detail is not available in the new experience preview"
        tone="danger"
        actions={[
          { label: 'Open Applications', to: '/new/applications/payments-api', secondary: true },
          { label: 'Open Legacy Deployment', to: '/deployments/dep-1' }
        ]}
      >
        This preview has not reached the deployment-detail slice yet. Use the legacy deployment route for the full
        record and timeline.
      </NewStateBlock>
    </>
  )
}
