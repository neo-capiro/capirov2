import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, Select, Statistic, Tabs, Typography } from 'antd';
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
import type { LdaClient, LdaDashboard, LobbyOverview, PagedResult } from './types.js';
import { formatMoney, formatNum } from './utils.js';

const { Text } = Typography;
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

  // Executive KPI row — populated from existing endpoints so no API change required.
  const ldaDashboard = useQuery<LdaDashboard>({
    queryKey: ['lda-dashboard-kpis'],
    queryFn: async () => (await api.get<LdaDashboard>('/api/lda-intel/dashboard')).data,
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });
  const lobbyOverview = useQuery<LobbyOverview>({
    queryKey: ['lobby-intel-overview-kpis'],
    queryFn: async () => (await api.get<LobbyOverview>('/api/lobby-intel/overview')).data,
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });
  const totalLobbySpend = (lobbyOverview.data?.topSpenders ?? [])
    .reduce((sum, s) => sum + (s.totalSpending ?? 0), 0);

  function navigateTo(tab: string, client?: string) {
    if (client !== undefined) setClientFilter(client);
    setActiveTab(tab);
  }

  const clientOptions = [
    { label: 'All Data', value: '' },
    ...(clientsQuery.data?.data ?? []).map((c) => ({ label: c.name, value: c.name })),
  ];

  return (
    <div
      className="redesign"
      style={{
        padding: '24px 32px',
        overflow: 'auto',
        height: '100%',
        background: 'var(--bg-canvas)',
      }}
    >
      <InsightsBanner />

      {/* Executive KPI row — gives the user a one-glance read on the breadth of
          intelligence Capiro is tracking, derived entirely from LDA + lobby-intel
          endpoints that are already live. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginBottom: 16 }}>
        <Card size="small">
          <Statistic
            title="Total LDA Filings"
            value={ldaDashboard.data?.totalFilings ?? 0}
            loading={ldaDashboard.isLoading}
            formatter={(v) => formatNum(v as number)}
            valueStyle={{ fontSize: 20 }}
            prefix={<FileTextOutlined />}
          />
        </Card>
        <Card size="small">
          <Statistic
            title="Lobbying Clients"
            value={ldaDashboard.data?.totalClients ?? 0}
            loading={ldaDashboard.isLoading}
            formatter={(v) => formatNum(v as number)}
            valueStyle={{ fontSize: 20 }}
            prefix={<UserSwitchOutlined />}
          />
        </Card>
        <Card size="small">
          <Statistic
            title="Registered Lobbyists"
            value={ldaDashboard.data?.totalLobbyists ?? 0}
            loading={ldaDashboard.isLoading}
            formatter={(v) => formatNum(v as number)}
            valueStyle={{ fontSize: 20 }}
            prefix={<UserOutlined />}
          />
        </Card>
        <Card size="small">
          <Statistic
            title="Lobbying Firms"
            value={ldaDashboard.data?.totalRegistrants ?? 0}
            loading={ldaDashboard.isLoading}
            formatter={(v) => formatNum(v as number)}
            valueStyle={{ fontSize: 20 }}
            prefix={<ShopOutlined />}
          />
        </Card>
        <Card size="small">
          <Statistic
            title="$ Tracked (top 5K)"
            value={totalLobbySpend}
            loading={lobbyOverview.isLoading}
            formatter={(v) => formatMoney(v as number)}
            valueStyle={{ fontSize: 20, color: '#2563eb' }}
            prefix={<DollarOutlined />}
          />
          <Text type="secondary" style={{ fontSize: 11 }}>federal lobbying disclosure</Text>
        </Card>
      </div>

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
