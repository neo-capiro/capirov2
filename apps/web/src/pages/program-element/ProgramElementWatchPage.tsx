import { Suspense, lazy, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import {
  Alert,
  Button,
  Card,
  Col,
  Flex,
  Row,
  Skeleton,
  Space,
  Statistic,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  BellFilled,
  BellOutlined,
  EyeOutlined,
  FileSearchOutlined,
  NumberOutlined,
  ScheduleOutlined,
} from '@ant-design/icons';
import { useApi } from '../../lib/use-api.js';
import {
  getProgramElementBills,
  getProgramElementContractors,
  getProgramElementDetail,
  getProgramElementsList,
  setProgramElementWatching,
} from './api.js';
import { FyHistoryChart } from './FyHistoryChart.js';
import { BillsTouchingPePanel } from './BillsTouchingPePanel.js';
import { ContractorsPanel } from './ContractorsPanel.js';
import { FyDetailDrawer } from './FyDetailDrawer.js';
import type {
  ProgramElementBill,
  ProgramElementContractorsResponse,
  ProgramElementHistoryRow,
  ProgramElementYearPoint,
} from './types.js';
function numberOrNull(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sourceFromRaw(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object') return {};
  const candidate = raw as { sourceAttribution?: unknown };
  if (!candidate.sourceAttribution || typeof candidate.sourceAttribution !== 'object') return {};
  const src = candidate.sourceAttribution as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(src)) {
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}

function toHistoryRow(year: ProgramElementYearPoint): ProgramElementHistoryRow {
  return {
    id: year.id,
    fy: year.fy,
    request: numberOrNull(year.request),
    hascMark: numberOrNull(year.hascMark),
    sascMark: numberOrNull(year.sascMark),
    hacDMark: numberOrNull(year.hacDMark),
    sacDMark: numberOrNull(year.sacDMark),
    conference: numberOrNull(year.conference),
    enacted: numberOrNull(year.enacted),
    projectedEnacted: year.enacted == null,
    sourceAttribution: sourceFromRaw(year.raw),
  };
}

function toHistoryRows(years: ProgramElementYearPoint[]): ProgramElementHistoryRow[] {
  return [...years].sort((a, b) => a.fy - b.fy).map(toHistoryRow);
}

function latestYear(years: ProgramElementYearPoint[]): ProgramElementYearPoint | undefined {
  return [...years].sort((a, b) => b.fy - a.fy)[0];
}

const LazyFyHistoryChart = lazy(async () => ({ default: FyHistoryChart }));
const LazyBillsTouchingPePanel = lazy(async () => ({ default: BillsTouchingPePanel }));
const LazyContractorsPanel = lazy(async () => ({ default: ContractorsPanel }));

const { Title, Text } = Typography;

export function ProgramElementWatchPage() {
  const { peCode = '' } = useParams<{ peCode: string }>();
  const normalizedPeCode = peCode.toUpperCase();
  const api = useApi();
  const queryClient = useQueryClient();
  const [selectedFy, setSelectedFy] = useState<number | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const watchMutation = useMutation({
    mutationFn: (watching: boolean) => setProgramElementWatching(api, normalizedPeCode, watching),
    onMutate: async (watching) => {
      const detailKey = ['program-element-detail', normalizedPeCode] as const;
      await queryClient.cancelQueries({ queryKey: detailKey });
      const previous = queryClient.getQueryData(detailKey);
      queryClient.setQueryData(detailKey, (oldData: unknown) => {
        if (!oldData || typeof oldData !== 'object') return oldData;
        return {
          ...(oldData as Record<string, unknown>),
          currentUserIsWatching: watching,
        };
      });
      return { previous, detailKey };
    },
    onError: (_error, _watching, context) => {
      if (context?.detailKey) {
        queryClient.setQueryData(context.detailKey, context.previous);
      }
      message.error('Unable to update watch status. Please try again.');
    },
    onSuccess: (_result, watching) => {
      if (watching) {
        message.success("You'll be notified when this PE has updates");
      }
    },
    onSettled: (_result, _error, _watching, context) => {
      if (context?.detailKey) {
        queryClient.invalidateQueries({ queryKey: context.detailKey }).catch(() => undefined);
      }
    },
  });

  const detailQuery = useQuery({
    queryKey: ['program-element-detail', normalizedPeCode],
    queryFn: () => getProgramElementDetail(api, normalizedPeCode),
    staleTime: 5 * 60 * 1000,
    enabled: normalizedPeCode.length > 0,
  });

  useQuery({
    queryKey: ['program-element-list', normalizedPeCode],
    queryFn: () => getProgramElementsList(api, { q: normalizedPeCode, limit: 25, page: 1 }),
    staleTime: 60 * 1000,
    enabled: normalizedPeCode.length > 0,
  });

  const billsQuery = useQuery({
    queryKey: ['program-element-bills', normalizedPeCode],
    queryFn: () => getProgramElementBills(api, normalizedPeCode),
    staleTime: 60 * 1000,
    enabled: normalizedPeCode.length > 0,
  });

  const contractorsQuery = useQuery({
    queryKey: ['program-element-contractors', normalizedPeCode],
    queryFn: () => getProgramElementContractors(api, normalizedPeCode),
    staleTime: 60 * 1000,
    enabled: normalizedPeCode.length > 0,
  });

  if (!normalizedPeCode) {
    return <Alert type="warning" message="Missing PE code" showIcon />;
  }

  if (detailQuery.isLoading) {
    return (
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Skeleton active paragraph={{ rows: 3 }} />
        <Row gutter={[16, 16]}>
          {[0, 1, 2, 3].map((idx) => (
            <Col key={idx} xs={24} md={12} xl={6}>
              <Card>
                <Skeleton active paragraph={{ rows: 1 }} title={false} />
              </Card>
            </Col>
          ))}
        </Row>
      </Space>
    );
  }

  if (detailQuery.isError || !detailQuery.data) {
    return (
      <Alert
        type="error"
        showIcon
        message="Unable to load program element"
        description="Please retry in a moment."
      />
    );
  }

  const detail = detailQuery.data;
  const latest = latestYear(detail.years);
  const historyRows = toHistoryRows(detail.years);
  const bills: ProgramElementBill[] = billsQuery.data ?? [];
  const contractors: ProgramElementContractorsResponse = contractorsQuery.data ?? {
    data: [],
    todo: null,
  };

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card>
        <Flex vertical gap={8}>
          <Text type="secondary">Program Element Watch</Text>
          <Flex justify="space-between" align="flex-start" gap={16} wrap>
            <div>
              <Title level={2} style={{ margin: 0 }}>
                {detail.peCode} · {detail.title}
              </Title>
              <Text type="secondary">{detail.appropriationType ?? 'Appropriation N/A'}</Text>
            </div>
            <Flex vertical align="flex-end" gap={8}>
              <Button
                type={detail.currentUserIsWatching ? 'primary' : 'default'}
                icon={detail.currentUserIsWatching ? <BellFilled /> : <BellOutlined />}
                loading={watchMutation.isPending}
                onClick={() => watchMutation.mutate(!detail.currentUserIsWatching)}
              >
                {detail.currentUserIsWatching ? 'Watching' : 'Watch this PE'}
              </Button>
              <Tag color="blue" data-testid="pe-sector-tag">
                {detail.service ?? 'Service N/A'}
              </Tag>
            </Flex>
          </Flex>
        </Flex>
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} md={12} xl={6}>
          <Card>
            <Statistic
              title="Latest Request"
              value={latest?.request != null ? Number(latest.request) : 0}
              precision={2}
              prefix={<NumberOutlined />}
            />
          </Card>
        </Col>
        <Col xs={24} md={12} xl={6}>
          <Card>
            <Statistic
              title="Latest Conference"
              value={latest?.conference != null ? Number(latest.conference) : 0}
              precision={2}
              prefix={<FileSearchOutlined />}
            />
          </Card>
        </Col>
        <Col xs={24} md={12} xl={6}>
          <Card>
            <Statistic
              title="Latest Enacted"
              value={latest?.enacted != null ? Number(latest.enacted) : 0}
              precision={2}
              prefix={<ScheduleOutlined />}
            />
          </Card>
        </Col>
        <Col xs={24} md={12} xl={6}>
          <Card>
            <Statistic
              title="Watching"
              value={detail.currentUserIsWatching ? 1 : 0}
              valueRender={() => <Tag color={detail.currentUserIsWatching ? 'green' : 'default'}>{detail.currentUserIsWatching ? 'Watching' : 'Not Watching'}</Tag>}
              prefix={<EyeOutlined />}
            />
          </Card>
        </Col>
      </Row>

      <Suspense fallback={<Card title="Timeline"><Skeleton active paragraph={{ rows: 6 }} /></Card>}>
        <LazyFyHistoryChart
          rows={historyRows}
          loading={detailQuery.isLoading}
          onFyClick={(fy) => {
            setSelectedFy(fy);
            setDrawerOpen(true);
            message.info(`Selected FY ${fy}`);
          }}
        />
      </Suspense>

      <Row gutter={[16, 16]}>
        <Col xs={24} span={12}>
          <Suspense fallback={<Card title="Bills touching this PE"><Skeleton active paragraph={{ rows: 4 }} /></Card>}>
            <LazyBillsTouchingPePanel bills={bills} loading={billsQuery.isLoading} />
          </Suspense>
        </Col>
        <Col xs={24} span={12}>
          <Suspense
            fallback={<Card title="Top contractors touching this PE"><Skeleton active paragraph={{ rows: 4 }} /></Card>}
          >
            <LazyContractorsPanel contractors={contractors} loading={contractorsQuery.isLoading} />
          </Suspense>
        </Col>
      </Row>

      <FyDetailDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        peCode={detail.peCode}
        selectedFy={selectedFy}
        timeline={detail.years}
      />
    </Space>
  );
}

