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

/**
 * Tiny dependency-free SVG sparkline with area fill.
 * Renders nothing for empty/zero data.
 */
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

/**
 * Compact horizontal bar showing one value relative to a max.
 * Used in ranked lists (top spenders, hot issues).
 */
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
