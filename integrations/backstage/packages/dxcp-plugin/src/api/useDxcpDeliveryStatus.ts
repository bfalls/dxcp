import { useApi, identityApiRef } from '@backstage/core-plugin-api';
import { useAsync } from 'react-use';
import { DxcpDeliveryStatus } from './types';

export const useDxcpDeliveryStatus = (serviceId?: string) => {
  const identityApi = useApi(identityApiRef);

  return useAsync(async (): Promise<DxcpDeliveryStatus | undefined> => {
    if (!serviceId) return undefined;

    const credentials = await identityApi.getCredentials();

    const response = await fetch(
      `/api/dxcp/services/${serviceId}/delivery-status`,
      {
        headers: {
          Authorization: `Bearer ${credentials.token}`,
        },
      },
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || 'DXCP request failed');
    }

    return response.json();
  }, [serviceId]);
};
