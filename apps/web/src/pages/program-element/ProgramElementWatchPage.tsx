import { Suspense, lazy, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Flex,
  Row,
  Skeleton,
  Space,
  Statistic,
  Tag,
  Typography,
  message,
} from 'antd';
import { BellFilled, BellOutlined, FileSearchOutlined } from '@ant-design/icons';
import { useApi } from '../../lib/use-api.js';
import {
  getProgramElementBills,
  getProgramElementContractors,
  getProgramElementDetail,
  getProgramElementPersonnel,
  setProgramElementWatching,
} from './api.js';
import { FyHistoryChart } from './FyHistoryChart.js';
import { BillsTouchingPePanel } from './BillsTouchingPePanel.js';
import { ContractorsPanel } from './ContractorsPanel.js';
import { FyDetailDrawer } from './FyDetailDrawer.js';
import { LinkCrmContactModal } from './LinkCrmContactModal.js';
import { ProgramTeamPanel } from './ProgramTeamPanel.js';
import type {
  ProgramElementBill,
  ProgramElementContractorsResponse,
  ProgramElementHistoryRow,
  ProgramElementYearPoint,
  ProgramTeamPerson,
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

/**
 * Most recent FY where a given metric actually has a meaningful value (non-null
 * and non-zero). Many PEs carry only a single real FY of data with 0/null in
 * later years; keying stat cards off the highest FY alone shows "$0 / —" and
 * makes the page look empty. This finds the latest FY that actually has data for
 * the requested field so the cards surface the real number.
 */
function latestMeaningful(
  years: ProgramElementYearPoint[],
  field: 'request' | 'enacted' | 'conference',
): { fy: number; value: number } | undefined {
  for (const y of [...years].sort((a, b) => b.fy - a.fy)) {
    const raw = y[field];
    if (raw == null) continue;
    const num = Number(raw);
    if (Number.isFinite(num) && num !== 0) return { fy: y.fy, value: num };
  }
  return undefined;
}

const LazyFyHistoryChart = lazy(async () => ({ default: FyHistoryChart }));
const LazyBillsTouchingPePanel = lazy(async () => ({ default: BillsTouchingPePanel }));
const LazyContractorsPanel = lazy(async () => ({ default: ContractorsPanel }));
const LazyProgramTeamPanel = lazy(async () => ({ default: ProgramTeamPanel }));

function formatSyncedDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function statusColor(status: string): string {
  const normalized = status.toLowerCase();
  if (normalized.includes('active') || normalized.includes('enacted')) return 'green';
  if (normalized.includes('terminat') || normalized.includes('cancel')) return 'red';
  return 'default';
}

const { Title, Text } = Typography;

export function ProgramElementWatchPage() {
  const { peCode = '' } = useParams<{ peCode: string }>();
  const normalizedPeCode = peCode.toUpperCase();
  const navigate = useNavigate();
  const api = useApi();
  const queryClient = useQueryClient();
  const [selectedFy, setSelectedFy] = useState<number | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [linkTarget, setLinkTarget] = useState<{ id: string; name: string } | null>(null);

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

  const programTeamQuery = useQuery({
    queryKey: ['program-element-personnel', normalizedPeCode],
    queryFn: () => getProgramElementPersonnel(api, normalizedPeCode),
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
  const years = detail.years ?? [];
  const latestRequest = latestMeaningful(years, 'request');
  const latestEnacted = latestMeaningful(years, 'enacted');
  const latestConference = latestMeaningful(years, 'conference');
  const historyRows = toHistoryRows(years);
  const hasBudgetData = years.length > 0;
  const bills: ProgramElementBill[] = billsQuery.data ?? [];
  const contractors: ProgramElementContractorsResponse = contractorsQuery.data ?? {
    data: [],
    todo: null,
  };
  const programTeam: ProgramTeamPerson[] = programTeamQuery.data ?? [];

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
              <Space size={8} wrap style={{ marginTop: 4 }}>
                <Text type="secondary">{detail.appropriationType ?? 'Appropriation N/A'}</Text>
                {detail.budgetActivity ? <Tag>{detail.budgetActivity}</Tag> : null}
                {detail.firstSeenFy ? (
                  <Text type="secondary">Tracked since FY{detail.firstSeenFy}</Text>
                ) : null}
              </Space>
            </div>
            <Flex vertical align="flex-end" gap={8}>
              <Space>
                <Button onClick={() => navigate('/program-elements')}>Find Program</Button>
                <Button onClick={() => navigate('/program-elements/mark-up-monitor')}>
                  Mark-up Monitor
                </Button>
              </Space>
              <Button
                type={detail.currentUserIsWatching ? 'primary' : 'default'}
                icon={detail.currentUserIsWatching ? <BellFilled /> : <BellOutlined />}
                loading={watchMutation.isPending}
                onClick={() => watchMutation.mutate(!detail.currentUserIsWatching)}
              >
                {detail.currentUserIsWatching ? 'Watching' : 'Watch this PE'}
              </Button>
              <Space size={8}>
                <Tag color="blue" data-testid="pe-sector-tag">
                  {detail.service ?? 'Service N/A'}
                </Tag>
                {detail.status ? (
                  <Tag color={statusColor(detail.status)}>{detail.status}</Tag>
                ) : null}
              </Space>
              {detail.lastSyncedAt ? (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Last synced {formatSyncedDate(detail.lastSyncedAt)}
                </Text>
              ) : null}
            </Flex>
          </Flex>
        </Flex>
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} md={12} xl={6}>
          <Card>
            <Statistic
              title={latestRequest ? `Latest Request · FY${latestRequest.fy}` : 'Latest Request'}
              value={latestRequest ? latestRequest.value : undefined}
              precision={2}
              prefix="$"
              suffix="m"
              valueRender={latestRequest ? undefined : () => <Text type="secondary">—</Text>}
            />
          </Card>
        </Col>
        <Col xs={24} md={12} xl={6}>
          <Card>
            <Statistic
              title={latestConference ? `Latest Conference · FY${latestConference.fy}` : 'Latest Conference'}
              value={latestConference ? latestConference.value : undefined}
              precision={2}
              prefix="$"
              suffix="m"
              valueRender={latestConference ? undefined : () => <Text type="secondary">—</Text>}
            />
          </Card>
        </Col>
        <Col xs={24} md={12} xl={6}>
          <Card>
            <Statistic
              title={latestEnacted ? `Latest Enacted · FY${latestEnacted.fy}` : 'Latest Enacted'}
              value={latestEnacted ? latestEnacted.value : undefined}
              precision={2}
              prefix="$"
              suffix="m"
              valueRender={latestEnacted ? undefined : () => <Text type="secondary">—</Text>}
            />
          </Card>
        </Col>
        <Col xs={24} md={12} xl={6}>
          <Card>
            <Statistic
              title="Bills touching this PE"
              value={bills.length}
              prefix={<FileSearchOutlined />}
            />
          </Card>
        </Col>
      </Row>

      {hasBudgetData ? (
        <Suspense
          fallback={
            <Card title="Timeline">
              <Skeleton active paragraph={{ rows: 6 }} />
            </Card>
          }
        >
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
      ) : (
        <Card title="Budget timeline">
          <Empty description="No budget-year data has been synced for this Program Element yet." />
        </Card>
      )}

      <Row gutter={[16, 16]}>
        <Col xs={24} span={12}>
          <Suspense
            fallback={
              <Card title="Bills touching this PE">
                <Skeleton active paragraph={{ rows: 4 }} />
              </Card>
            }
          >
            <LazyBillsTouchingPePanel bills={bills} loading={billsQuery.isLoading} />
          </Suspense>
        </Col>
        <Col xs={24} span={12}>
          <Suspense
            fallback={
              <Card title="Top contractors touching this PE">
                <Skeleton active paragraph={{ rows: 4 }} />
              </Card>
            }
          >
            <LazyContractorsPanel contractors={contractors} loading={contractorsQuery.isLoading} />
          </Suspense>
        </Col>
      </Row>

      <Suspense
        fallback={
          <Card title="Program team">
            <Skeleton active paragraph={{ rows: 5 }} />
          </Card>
        }
      >
        <LazyProgramTeamPanel
          personnel={programTeam}
          loading={programTeamQuery.isLoading}
          estimatedTotal={Math.max(programTeam.length, 6)}
          onViewAllSources={() => navigate('/directory')}
          onLinkCrmContact={(personId) => {
            const person = programTeam.find((candidate) => candidate.id === personId);
            setLinkTarget({ id: personId, name: person?.fullName ?? 'this person' });
          }}
        />
      </Suspense>

      <FyDetailDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        peCode={detail.peCode}
        selectedFy={selectedFy}
        timeline={years}
      />

      <LinkCrmContactModal
        open={linkTarget !== null}
        personId={linkTarget?.id ?? null}
        personName={linkTarget?.name ?? null}
        onClose={() => setLinkTarget(null)}
      />
    </Space>
  );
}
