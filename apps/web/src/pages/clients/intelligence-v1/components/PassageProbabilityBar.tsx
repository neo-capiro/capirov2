/**
 * D-002 PassageProbabilityBar
 * Compact horizontal passage-probability bar with score label.
 *
 * - Handles null / undefined / NaN score safely: shows explicit "No score" UI.
 * - Score is clamped into [0, 100] before rendering (never crashes on out-of-range input).
 * - Color defaults to var(--info); pass probColor from the card for semantic coloring.
 */

interface PassageProbabilityBarProps {
  /** 0–100 integer or fractional percentage. null / undefined / NaN renders "No score". */
  score?: number | null;
  /** CSS color for the bar fill. Defaults to var(--info). */
  color?: string;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function PassageProbabilityBar({
  score,
  color = 'var(--info)',
}: PassageProbabilityBarProps) {
  if (score == null || Number.isNaN(score)) {
    return <div className="iv1-ppb iv1-ppb--none">No score</div>;
  }

  const pct = clamp(score, 0, 100);

  return (
    <div className="iv1-ppb">
      <div className="iv1-ppb-track">
        <div
          className="iv1-ppb-fill"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
      <span className="iv1-ppb-pct num">{Math.round(pct)}%</span>
    </div>
  );
}
