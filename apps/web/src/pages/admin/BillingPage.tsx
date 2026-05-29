import { Alert, Card, Descriptions } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '../../lib/use-api.js';

interface BillingResponse {
  placeholder: boolean;
  message: string;
  plan: string;
}

export function BillingPage() {
  const api = useApi();
  const billing = useQuery<BillingResponse>({
    queryKey: ['billing'],
    queryFn: async () => (await api.get('/api/tenant-admin/billing')).data,
  });
  return (
    <Card title="Billing">
      <Alert
        type="info"
        showIcon
        message="Billing is a placeholder for now."
        description={billing.data?.message}
        style={{ marginBottom: 16 }}
      />
      <Descriptions column={1} size="small">
        <Descriptions.Item label="Plan">{billing.data?.plan ?? '-'}</Descriptions.Item>
      </Descriptions>
    </Card>
  );
}
