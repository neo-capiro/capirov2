import { useMemo } from 'react';
import { Typography } from 'antd';

const { Text } = Typography;

type TrajectoryTone = 'success' | 'critical' | 'info' | 'neutral';

interface Point {
  label: string;
  value: number;
}

interface TrajectoryChipSparklineProps {
  trajectory: string | null;
  series: Point[];
}

function toneForTrajectory(value: string | null): TrajectoryTone {
  if (!value) return 'neutral';
  const lower = value.toLowerCase();
  if (lower.includes('grow') || lower.includes('increas') || lower.includes('explod')) return 'success';
  if (lower.includes('declin') || lower.includes('decreas') || lower.includes('contract')) return 'critical';
  return 'info';
}

function titleCase(value: string): string {
  return value.replace(/[_-]/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
}

export function TrajectoryChipSparkline({ trajectory, series }: TrajectoryChipSparklineProps) {
  const tone = toneForTrajectory(trajectory);

  const normalized = useMemo(() => {
    const filtered = series.filter(
      (p) => Number.isFinite(p.value) && typeof p.label === 'string' && p.label.length > 0,
    );

    if (filtered.length < 2) return [];

    const values = filtered.map((p) => p.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = Math.max(1, max - min);

    return filtered.map((p, idx) => {
      const x = (idx / (filtered.length - 1)) * 100;
      const y = 100 - ((p.value - min) / span) * 100;
      return { ...p, x, y };
    });
  }, [series]);

  const hasTrend = normalized.length >= 2;
  const points = normalized.map((p) => `${p.x},${p.y}`).join(' ');
  const fallbackText = series.length === 0 ? 'No quarterly trend data' : 'Insufficient trend points';

  return (
    <div className="iv1-trajectory">
      <span className={`pill ${tone}`} style={{ width: 'max-content' }}>
        <span className={`dot ${tone}`} />
        {trajectory ? titleCase(trajectory) : 'Unknown'}
      </span>

      {hasTrend ? (
        <svg
          className="iv1-trajectory__spark"
          viewBox="0 0 100 28"
          role="img"
          aria-label="8-quarter spending trend"
        >
          <polyline className="iv1-trajectory__spark-line" points={points} />
          {normalized.map((p) => (
            <circle key={`${p.label}-${p.x}`} className="iv1-trajectory__spark-dot" cx={p.x} cy={p.y} r="1.8" />
          ))}
        </svg>
      ) : (
        <Text type="secondary" className="iv1-trajectory__fallback">
          {fallbackText}
        </Text>
      )}
    </div>
  );
}
