import { useNavigate } from 'react-router-dom';
import { PlusOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Button, Skeleton, Typography } from 'antd';
import { useApi } from '../lib/use-api.js';
import { useClientFilter } from '../state/client-filter.js';
import type { Client } from '../pages/clients/clientTypes.js';

export function GlobalClientPicker() {
  const api = useApi();
  const navigate = useNavigate();
  const { selectedClientId, setSelectedClientId, clearClientFilter } = useClientFilter();
  const clients = useQuery<Client[]>({
    queryKey: ['clients'],
    queryFn: async () => (await api.get<Client[]>('/api/clients')).data,
  });

  const visibleClients = (clients.data ?? []).filter((client) => client.status !== 'archived');
  const selectedClient = visibleClients.find((client) => client.id === selectedClientId);

  return (
    <section className="global-client-picker" aria-label="Client filter">
      <div className="global-client-picker-top">
        <div>
          <Typography.Text className="global-client-picker-label">Client View</Typography.Text>
          <Typography.Title level={4}>
            {selectedClient ? selectedClient.name : 'All clients'}
          </Typography.Title>
        </div>
        <Button icon={<PlusOutlined />} onClick={() => navigate('/clients')}>
          Add client
        </Button>
      </div>

      {clients.isLoading ? (
        <Skeleton active paragraph={{ rows: 1 }} />
      ) : (
        <div className="global-client-picker-scroll" role="list" aria-label="Client filter options">
          <button
            type="button"
            className={
              selectedClientId
                ? 'global-client-pill'
                : 'global-client-pill global-client-pill--active'
            }
            onClick={clearClientFilter}
            aria-pressed={!selectedClientId}
          >
            <span className="global-client-pill-dot" aria-hidden="true" />
            <span>All</span>
          </button>

          {visibleClients.map((client) => {
            const active = selectedClientId === client.id;
            return (
              <button
                key={client.id}
                type="button"
                className={
                  active ? 'global-client-pill global-client-pill--active' : 'global-client-pill'
                }
                onClick={() => (active ? clearClientFilter() : setSelectedClientId(client.id))}
                aria-pressed={active}
              >
                <span className="global-client-pill-avatar" aria-hidden="true">
                  {initials(client.name)}
                </span>
                <span>{client.name}</span>
              </button>
            );
          })}

          {visibleClients.length === 0 ? (
            <Typography.Text type="secondary">No clients have been added yet.</Typography.Text>
          ) : null}
        </div>
      )}
    </section>
  );
}

function initials(name: string): string {
  const parts = name
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  return (parts[0]?.[0] ?? 'C').concat(parts[1]?.[0] ?? '').toUpperCase();
}
