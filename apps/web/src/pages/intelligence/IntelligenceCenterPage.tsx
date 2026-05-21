import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Select, Tabs } from 'antd';
import {
  AuditOutlined,
  BankOutlined,
  BookOutlined,
  CalendarOutlined,
  DollarOutlined,
  FileTextOutlined,
  FireOutlined,
  GlobalOutlined,
  ShopOutlined,
  UserOutlined,
  UserSwitchOutlined,
} from '@ant-design/icons';
import { useApi } from '../../lib/use-api.js';
import type { LdaClient, PagedResult } from './types.js';
import { InsightsBanner } from './InsightsBanner.js';
import { LdaOverviewPanel } from './panels/LdaOverviewPanel.js';
import { FilingsPanel } from './panels/FilingsPanel.js';
import { FirmsPanel } from './panels/FirmsPanel.js';
import { LobbyistsPanel } from './panels/LobbyistsPanel.js';
import { CongressPanel } from './panels/CongressPanel.js';
import { PacsPanel } from './panels/PacsPanel.js';
import { ContractingPanel } from './panels/ContractingPanel.js';
import { AgenciesPanel } from './panels/AgenciesPanel.js';
import { LobbyingPanel } from './panels/LobbyingPanel.js';
import { RegulationsPanel } from './panels/RegulationsPanel.js';
import { ClientProfilePanel } from './panels/ClientProfilePanel.js';

export function IntelligenceCenterPage() {
  const api = useApi();
  const [activeTab, setActiveTab] = useState('clients');
  const [clientFilter, setClientFilter] = useState('');

  const clientsQuery = useQuery<PagedResult<LdaClient>>({
    queryKey: ['lda-clients-dropdown'],
    queryFn: async () =>
      (await api.get<PagedResult<LdaClient>>('/api/lda-intel/clients', { params: { limit: 100 } })).data,
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });

  function navigateTo(tab: string, client?: string) {
    if (client !== undefined) setClientFilter(client);
    setActiveTab(tab);
  }

  const clientOptions = [
    { label: 'All Data', value: '' },
    ...(clientsQuery.data?.data ?? []).map((c) => ({ label: c.name, value: c.name })),
  ];

  return (
    <div style={{ padding: '24px 32px', overflow: 'auto', height: '100%' }}>
      <InsightsBanner />
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        size="large"
        tabBarExtraContent={{
          right: (
            <Select
              value={clientFilter || undefined}
              placeholder="All Data"
              allowClear
              style={{ width: 220 }}
              options={clientOptions}
              onChange={(v) => setClientFilter(v ?? '')}
              loading={clientsQuery.isLoading}
              showSearch
              filterOption={(input, opt) =>
                (opt?.label as string ?? '').toLowerCase().includes(input.toLowerCase())
              }
            />
          ),
        }}
        items={[
          { key: 'clients', label: <span><UserSwitchOutlined /> My Clients</span>, children: <ClientProfilePanel /> },
          { key: 'lda', label: <span><AuditOutlined /> LDA Overview</span>, children: <LdaOverviewPanel clientFilter={clientFilter} onNavigate={navigateTo} /> },
          { key: 'filings', label: <span><FileTextOutlined /> Filings</span>, children: <FilingsPanel key={clientFilter} defaultClient={clientFilter} /> },
          { key: 'firms', label: <span><ShopOutlined /> Firms</span>, children: <FirmsPanel onNavigate={navigateTo} /> },
          { key: 'lobbyists', label: <span><UserOutlined /> Lobbyists</span>, children: <LobbyistsPanel /> },
          { key: 'congress', label: <span><BookOutlined /> Congress</span>, children: <CongressPanel key={clientFilter} defaultSearch={clientFilter} /> },
          { key: 'pacs', label: <span><DollarOutlined /> PACs</span>, children: <PacsPanel /> },
          { key: 'contracting', label: <span><GlobalOutlined /> Contracting</span>, children: <ContractingPanel /> },
          { key: 'agencies', label: <span><BankOutlined /> Agencies</span>, children: <AgenciesPanel /> },
          { key: 'lobbying', label: <span><FireOutlined /> Lobby Intel</span>, children: <LobbyingPanel /> },
          { key: 'regulations', label: <span><CalendarOutlined /> Regulations</span>, children: <RegulationsPanel /> },
        ]}
      />
    </div>
  );
}
