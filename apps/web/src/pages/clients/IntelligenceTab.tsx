import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Skeleton, Tabs, Empty } from 'antd';
import {
  BarChartOutlined,
  NodeIndexOutlined,
  SnippetsOutlined,
} from '@ant-design/icons';
import { useApi } from '../../lib/use-api.js';
import {
  ClientIntelOverview,
  ReportCardView,
  DistrictNexusTab,
} from '../intelligence/ClientIntelProfilePage.js';
import { KnowledgeGraphView } from '../intelligence/KnowledgeGraphPage.js';

interface IntelligenceTabProps {
  clientId: string;
  clientName: string;
}

type IntelMainTab = 'overview' | 'graph' | 'report-card' | 'district-nexus';

export function IntelligenceTab({ clientId, clientName }: IntelligenceTabProps) {
  const [active, setActive] = useState<IntelMainTab>('overview');

  return (
    <div className="intel-main-tabs">
      <Tabs
        activeKey={active}
        onChange={(k) => setActive(k as IntelMainTab)}
        destroyInactiveTabPane
        items={[
        {
          key: 'overview',
          label: (
            <span>
              <BarChartOutlined /> Overview
            </span>
          ),
          children: <ClientIntelOverview clientId={clientId} clientName={clientName} />,
        },
        {
          key: 'graph',
          label: (
            <span>
              <NodeIndexOutlined /> Knowledge Graph
            </span>
          ),
          children: <KnowledgeGraphView clientId={clientId} />,
        },
        {
          key: 'report-card',
          label: (
            <span>
              <SnippetsOutlined /> Report Card
            </span>
          ),
          children: <ReportCardPanel clientId={clientId} />,
        },
        {
          key: 'district-nexus',
          label: <span>District Nexus</span>,
          children: <DistrictNexusTab clientId={clientId} />,
        },
        ]}
      />
    </div>
  );
}

function ReportCardPanel({ clientId }: { clientId: string }) {
  const api = useApi();

  const reportCardQuery = useQuery<Record<string, unknown>>({
    queryKey: ['report-card', clientId],
    queryFn: async () =>
      (
        await api.get<Record<string, unknown>>(
          `/api/intelligence/clients/${clientId}/report-card`,
        )
      ).data,
    enabled: !!clientId,
    staleTime: 5 * 60 * 1000,
  });

  if (reportCardQuery.isLoading) {
    return <Skeleton active paragraph={{ rows: 12 }} />;
  }

  if (reportCardQuery.isError || !reportCardQuery.data) {
    return (
      <Empty
        description="Report card unavailable for this client"
        image={Empty.PRESENTED_IMAGE_SIMPLE}
      />
    );
  }

  return <ReportCardView data={reportCardQuery.data} />;
}
