import { Input, Select, Typography } from 'antd';
import type { Client } from '../../../clients/clientTypes.js';

interface CampaignSetupProps {
  clients: Client[];
  clientId: string | null;
  campaignName: string;
  onChange: (patch: { clientId?: string | null; campaignName?: string }) => void;
}

export function CampaignSetup({ clients, clientId, campaignName, onChange }: CampaignSetupProps) {
  const activeClients = clients
    .filter((c) => c.status !== 'archived')
    .sort((a, b) => a.name.localeCompare(b.name));

  const selectedClient = activeClients.find((c) => c.id === clientId) ?? null;

  const handleClientChange = (id: string) => {
    const client = activeClients.find((c) => c.id === id) ?? null;
    onChange({
      clientId: id,
      campaignName: client ? `${client.name} campaign` : '',
    });
  };

  return (
    <div className="outreach-flow-stack outreach-campaign-select-client">
      <Typography.Title level={4}>Set up your campaign</Typography.Title>
      <Typography.Paragraph type="secondary">
        Select the client this campaign is for and give it a name. Meri will use client context to
        personalize each email.
      </Typography.Paragraph>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 480 }}>
        <div>
          <Typography.Text strong>Client</Typography.Text>
          {activeClients.length ? (
            <Select
              style={{ display: 'block', marginTop: 4 }}
              value={clientId ?? undefined}
              showSearch={activeClients.length > 8}
              optionFilterProp="label"
              placeholder="Select a client..."
              options={activeClients.map((c) => ({ value: c.id, label: c.name }))}
              onChange={handleClientChange}
            />
          ) : (
            <Typography.Text type="secondary" style={{ display: 'block', marginTop: 4 }}>
              No clients yet.{' '}
              <a href="/clients" rel="noopener noreferrer">
                Add a client
              </a>{' '}
              first.
            </Typography.Text>
          )}
        </div>

        {selectedClient && (
          <div>
            <Typography.Text strong>Campaign name</Typography.Text>
            <Input
              style={{ marginTop: 4 }}
              value={campaignName}
              placeholder={`${selectedClient.name} campaign`}
              maxLength={120}
              onChange={(e) => onChange({ campaignName: e.target.value })}
            />
          </div>
        )}
      </div>
    </div>
  );
}
