import { formatCompact } from '../mappers.js';

export interface QuarterPoint {
  label: string;
  lobbying: number;
  obligations: number;
}

interface RoiQuarterChartProps {
  series: QuarterPoint[] | undefined;
}

export function RoiQuarterChart({ series }: RoiQuarterChartProps) {
  const points = series ?? [];
  if (points.length === 0) {
    return (
      <div className="iv1-qchart-wrap">
        <div className="iv1-qchart-head">
          <span className="iv1-qchart-title">Quarterly ROI · 8 quarters</span>
        </div>
        <div className="iv1-empty" style={{ padding: '14px 0' }}>No quarterly data available.</div>
      </div>
    );
  }

  const maxY = Math.max(...points.map((p) => Math.max(p.lobbying, p.obligations)), 1);
  const ratioPoints = points.map((p) => {
    if (p.lobbying <= 0) return 0;
    return Math.max(0, p.obligations / p.lobbying);
  });
  const maxRatio = Math.max(...ratioPoints, 1);

  return (
    <div className="iv1-qchart-wrap">
      <div className="iv1-qchart-head">
        <span className="iv1-qchart-title">Quarterly ROI · 8 quarters</span>
        <span className="iv1-qchart-legend">
          <span className="iv1-qchart-swatch lobbying" />Lobbying
          <span className="iv1-qchart-swatch obligations" />Obligations
          <span className="iv1-qchart-swatch ratio" />Ratio
        </span>
      </div>

      <div className="iv1-qchart-grid">
        {points.map((p, idx) => {
          const lobbyPct = (p.lobbying / maxY) * 100;
          const obligPct = (p.obligations / maxY) * 100;
          const ratio = ratioPoints[idx] ?? 0;
          const ratioPct = (ratio / maxRatio) * 100;

          return (
            <div key={`${p.label}-${idx}`} className="iv1-qchart-col">
              <div className="iv1-qchart-bars">
                <div className="iv1-qchart-bar lobbying" style={{ height: `${lobbyPct}%` }} />
                <div className="iv1-qchart-bar obligations" style={{ height: `${obligPct}%` }} />
                <div className="iv1-qchart-ratio-dot" style={{ bottom: `${ratioPct}%` }} title={`${ratio.toFixed(2)}×`} />
              </div>
              <div className="iv1-qchart-ratio-label">{ratio.toFixed(1)}×</div>
              <div className="iv1-qchart-xlabel">{p.label}</div>
            </div>
          );
        })}
      </div>

      <div className="iv1-qchart-footnote">
        Latest quarter, Lobbying {formatCompact(points[points.length - 1]?.lobbying ?? 0)} · Obligations {formatCompact(points[points.length - 1]?.obligations ?? 0)}
      </div>
    </div>
  );
}
