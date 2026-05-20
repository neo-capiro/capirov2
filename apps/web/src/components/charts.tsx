import type { CSSProperties } from 'react';

interface SparklineProps {
  data: { year: number; amount: number }[];
  width?: number;
  height?: number;
  color?: string;
  fillColor?: string;
  ariaLabel?: string;
  style?: CSSProperties;
}

export function Sparkline({
  data,
  width = 160,
  height = 40,
  color = 'var(--capiro-primary, #2563eb)',
  fillColor = 'rgba(37, 99, 235, 0.15)',
  ariaLabel = 'Trend',
  style,
}: SparklineProps) {
  if (!data || data.length === 0) {
    return (
      <div
        style={{
          width,
          height,
          fontSize: 11,
          color: 'var(--cp-muted, #888)',
          display: 'flex',
          alignItems: 'center',
          ...style,
        }}
      >
        no data
      </div>
    );
  }
  const sorted = [...data].sort((a, b) => a.year - b.year);
  const xs = sorted.map((d) => d.year);
  const ys = sorted.map((d) => d.amount);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = 0;
  const maxY = Math.max(...ys, 1);
  const pad = 2;
  const w = width - pad * 2;
  const h = height - pad * 2;
  const xScale = (x: number) =>
    pad + (maxX === minX ? w / 2 : ((x - minX) / (maxX - minX)) * w);
  const yScale = (y: number) =>
    pad + (h - ((y - minY) / (maxY - minY || 1)) * h);

  const points = sorted.map((d) => `${xScale(d.year)},${yScale(d.amount)}`);
  const path = points.join(' L ');
  const fill = `M ${xScale(minX)},${height - pad} L ${path} L ${xScale(maxX)},${height - pad} Z`;

  const last = sorted[sorted.length - 1];

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={ariaLabel}
      style={style}
    >
      <path d={fill} fill={fillColor} />
      <path d={`M ${path}`} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
      {last ? (
        <circle cx={xScale(last.year)} cy={yScale(last.amount)} r={2.5} fill={color} />
      ) : null}
    </svg>
  );
}

export function HBar({
  value,
  max,
  width = 120,
  height = 6,
  color = 'var(--capiro-primary, #2563eb)',
  trackColor = 'rgba(0,0,0,0.06)',
}: {
  value: number;
  max: number;
  width?: number;
  height?: number;
  color?: string;
  trackColor?: string;
}) {
  const pct = max > 0 ? Math.max(0.02, Math.min(1, value / max)) : 0;
  return (
    <div
      style={{
        width,
        height,
        background: trackColor,
        borderRadius: height / 2,
        overflow: 'hidden',
      }}
      aria-hidden
    >
      <div
        style={{
          width: `${pct * 100}%`,
          height: '100%',
          background: color,
          transition: 'width 200ms ease',
        }}
      />
    </div>
  );
}

export interface TrendPoint {
  label: string;
  value1: number;
  value2?: number;
}

interface TrendAreaChartProps {
  data: TrendPoint[];
  height?: number;
  color1?: string;
  color2?: string;
  label1?: string;
  label2?: string;
  formatValue1?: (v: number) => string;
  formatValue2?: (v: number) => string;
}

export function TrendAreaChart({
  data,
  height = 160,
  color1 = '#2563eb',
  color2 = '#10b981',
  label1 = 'Series 1',
  label2 = 'Series 2',
  formatValue1,
  formatValue2,
}: TrendAreaChartProps) {
  if (!data || data.length === 0) {
    return (
      <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888', fontSize: 12 }}>
        No data
      </div>
    );
  }

  const padL = 0;
  const padR = 8;
  const padT = 12;
  const padB = 28;
  const width = 900;
  const chartH = height - padT - padB;
  const chartW = width - padL - padR;

  const vals1 = data.map((d) => d.value1);
  const vals2 = data.map((d) => d.value2 ?? 0);
  const max1 = Math.max(...vals1, 1);
  const max2 = data.some((d) => d.value2 != null) ? Math.max(...vals2, 1) : max1;

  const xOf = (i: number) => padL + (i / Math.max(data.length - 1, 1)) * chartW;
  const y1Of = (v: number) => padT + chartH - (v / max1) * chartH;
  const y2Of = (v: number) => padT + chartH - (v / max2) * chartH;

  const line1 = data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${xOf(i)},${y1Of(d.value1)}`).join(' ');
  const fill1 = `${line1} L ${xOf(data.length - 1)},${padT + chartH} L ${xOf(0)},${padT + chartH} Z`;

  const hasV2 = data.some((d) => d.value2 != null);
  const line2 = hasV2
    ? data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${xOf(i)},${y2Of(d.value2 ?? 0)}`).join(' ')
    : '';
  const fill2 = hasV2
    ? `${line2} L ${xOf(data.length - 1)},${padT + chartH} L ${xOf(0)},${padT + chartH} Z`
    : '';

  // Show every 4th label to avoid crowding
  const labelStep = Math.max(1, Math.floor(data.length / 8));

  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        style={{ width: '100%', height }}
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="grad1" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color1} stopOpacity={0.25} />
            <stop offset="100%" stopColor={color1} stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id="grad2" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color2} stopOpacity={0.2} />
            <stop offset="100%" stopColor={color2} stopOpacity={0.02} />
          </linearGradient>
        </defs>

        {/* Base line */}
        <line
          x1={padL} y1={padT + chartH}
          x2={width - padR} y2={padT + chartH}
          stroke="rgba(0,0,0,0.08)" strokeWidth={1}
        />

        {/* Series 2 area + line */}
        {hasV2 && (
          <>
            <path d={fill2} fill="url(#grad2)" />
            <path d={line2} fill="none" stroke={color2} strokeWidth={1.5} strokeLinejoin="round" />
          </>
        )}

        {/* Series 1 area + line */}
        <path d={fill1} fill="url(#grad1)" />
        <path d={line1} fill="none" stroke={color1} strokeWidth={2} strokeLinejoin="round" />

        {/* X-axis labels */}
        {data.map((d, i) =>
          i % labelStep === 0 ? (
            <text
              key={d.label}
              x={xOf(i)}
              y={height - 6}
              textAnchor="middle"
              fontSize={9}
              fill="#888"
            >
              {d.label}
            </text>
          ) : null,
        )}
      </svg>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginTop: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#666' }}>
          <div style={{ width: 16, height: 2, background: color1, borderRadius: 1 }} />
          {label1}
          {formatValue1 ? ` (max: ${formatValue1(max1)})` : ''}
        </div>
        {hasV2 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#666' }}>
            <div style={{ width: 16, height: 2, background: color2, borderRadius: 1 }} />
            {label2}
            {formatValue2 ? ` (max: ${formatValue2(max2)})` : ''}
          </div>
        )}
      </div>
    </div>
  );
}
