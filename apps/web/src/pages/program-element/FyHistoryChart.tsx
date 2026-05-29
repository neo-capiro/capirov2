import { useMemo } from 'react';
import { Button, Card, Empty, Skeleton, Space, Tag, Typography } from 'antd';
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from 'recharts';
import type { FyHistoryChartProps, ProgramElementHistoryRow, ProgramElementSourceField } from './types.js';

const { Text } = Typography;

interface ChartPoint {
  fy: number;
  request: number;
  enacted: number;
  projected: boolean;
  requestSource: string;
  hascMark: number | null;
  sascMark: number | null;
  hacDMark: number | null;
  sacDMark: number | null;
  conference: number | null;
  enactedSource: string;
  hascSource: string;
  sascSource: string;
  hacDSource: string;
  sacDSource: string;
  conferenceSource: string;
  rawEnacted: number | null;
}

const dollarsTick = (v: number) => `$${v}m`;
const dollars2 = (v: number | null) => (v == null ? '-' : `$${v.toFixed(2)}m`);

function sourceFor(row: ProgramElementHistoryRow, field: ProgramElementSourceField): string {
  return row.sourceAttribution[field] ?? 'n/a';
}

function toChartPoint(row: ProgramElementHistoryRow): ChartPoint {
  return {
    fy: row.fy,
    request: row.request ?? 0,
    enacted: row.enacted ?? row.request ?? 0,
    projected: row.projectedEnacted,
    requestSource: sourceFor(row, 'request'),
    hascMark: row.hascMark,
    sascMark: row.sascMark,
    hacDMark: row.hacDMark,
    sacDMark: row.sacDMark,
    conference: row.conference,
    enactedSource: sourceFor(row, 'enacted'),
    hascSource: sourceFor(row, 'hascMark'),
    sascSource: sourceFor(row, 'sascMark'),
    hacDSource: sourceFor(row, 'hacDMark'),
    sacDSource: sourceFor(row, 'sacDMark'),
    conferenceSource: sourceFor(row, 'conference'),
    rawEnacted: row.enacted,
  };
}

export function TooltipContent({ active, payload }: { active?: boolean; payload?: Array<{ payload: ChartPoint }> }) {
  if (!active || !payload || payload.length === 0) return null;
  const first = payload[0];
  if (!first) return null;
  const d = first.payload;
  if (!d) return null;

  return (
    <Card size="small" styles={{ body: { padding: 10, minWidth: 250 } }}>
      <Space direction="vertical" size={6} style={{ width: '100%' }}>
        <Text strong>FY {d.fy}</Text>
        <TooltipRow label="Request" value={d.request} source={d.requestSource} />
        <TooltipRow label="HASC" value={d.hascMark} source={d.hascSource} />
        <TooltipRow label="SASC" value={d.sascMark} source={d.sascSource} />
        <TooltipRow label="HAC-D" value={d.hacDMark} source={d.hacDSource} />
        <TooltipRow label="SAC-D" value={d.sacDMark} source={d.sacDSource} />
        <TooltipRow label="Conference" value={d.conference} source={d.conferenceSource} />
        <TooltipRow
          label={d.projected ? 'Enacted (Projected)' : 'Enacted'}
          value={d.rawEnacted ?? d.request}
          source={d.enactedSource}
        />
      </Space>
    </Card>
  );
}

function TooltipRow({ label, value, source }: { label: string; value: number | null; source: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
      <Text type="secondary">{label}</Text>
      <Space size={6}>
        <Text>{dollars2(value)}</Text>
        <Text type="secondary">[{source}]</Text>
      </Space>
    </div>
  );
}

function WinRateLabel({ rows }: { rows: ProgramElementHistoryRow[] }) {
  const pct = useMemo(() => {
    const baseline = rows.reduce((acc, r) => acc + (r.request ?? 0), 0);
    const enacted = rows.reduce((acc, r) => acc + (r.enacted ?? r.request ?? 0), 0);
    if (baseline === 0) return 0;
    return ((enacted - baseline) / baseline) * 100;
  }, [rows]);

  const sign = pct >= 0 ? '+' : '';
  return (
    <Text type="secondary" data-testid="pe-win-rate-label">
      Win rate this PE (5y): {sign}
      {pct.toFixed(1)}% over request
    </Text>
  );
}

export function FyHistoryChart({ rows, loading = false, onFyClick }: FyHistoryChartProps) {
  const data = useMemo(() => [...rows].sort((a, b) => a.fy - b.fy).map(toChartPoint), [rows]);

  if (loading) {
    return (
      <Card title="Timeline">
        <Skeleton active paragraph={{ rows: 6 }} />
      </Card>
    );
  }

  if (data.length === 0) {
    return (
      <Card title="Timeline">
        <Empty description="No FY history yet" />
      </Card>
    );
  }

  return (
    <Card title="Timeline">
      <div style={{ width: '100%', height: 420 }}>
        <ResponsiveContainer width="100%" height="100%" aspect={2} minWidth={320} minHeight={160}>
          <ComposedChart data={data} margin={{ top: 20, right: 20, left: 20, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="fy" tickFormatter={(v) => `FY ${v}`} />
            <YAxis tickFormatter={dollarsTick} />
            <Tooltip content={<TooltipContent />} />
            <Bar
              dataKey="request"
              fill="#91caff"
              name="Request"
              onClick={(state) => {
                const entry = state as { fy?: number } | null;
                if (entry && typeof entry.fy === 'number') {
                  onFyClick?.(entry.fy);
                }
              }}
            />
            <Bar
              dataKey="enacted"
              fill="#1677ff"
              name="Enacted"
              onClick={(state) => {
                const entry = state as { fy?: number } | null;
                if (entry && typeof entry.fy === 'number') {
                  onFyClick?.(entry.fy);
                }
              }}
              shape={(props: unknown) => {
                if (!props || typeof props !== 'object') return null;
                const candidate = props as {
                  x?: number;
                  y?: number;
                  width?: number;
                  height?: number;
                  payload?: ChartPoint;
                };
                if (
                  typeof candidate.x !== 'number' ||
                  typeof candidate.y !== 'number' ||
                  typeof candidate.width !== 'number' ||
                  typeof candidate.height !== 'number' ||
                  !candidate.payload
                ) {
                  return null;
                }
                const { x, y, width, height, payload } = candidate;
                return (
                  <g>
                    <rect
                      x={x}
                      y={y}
                      width={width}
                      height={height}
                      fill="#1677ff"
                      opacity={payload.projected ? 0.4 : 1}
                    />
                    {payload.projected ? (
                      <text
                        x={x + width / 2}
                        y={Math.max(y - 6, 12)}
                        textAnchor="middle"
                        fontSize={10}
                        fill="#595959"
                      >
                        Projected
                      </text>
                    ) : null}
                  </g>
                );
              }}
            />
            <ReferenceLine y={0} stroke="#d9d9d9" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <Space style={{ marginTop: 8 }}>
        <Tag color="blue">Request (lighter)</Tag>
        <Tag color="processing">Enacted (darker)</Tag>
      </Space>
      <div style={{ marginTop: 8 }}>
        <WinRateLabel rows={rows} />
      </div>
      <Button
        type="link"
        size="small"
        onClick={() => onFyClick?.(data[data.length - 1]?.fy ?? 0)}
        style={{ paddingInline: 0, marginTop: 6 }}
      >
        Select latest FY
      </Button>
    </Card>
  );
}
