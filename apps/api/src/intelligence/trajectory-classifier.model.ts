export interface TrajectoryClassifierInput {
  yearlySpend?: Array<{ year: number; amount: number }>;
  growthRate?: number | null;
  totalSpending?: number | null;
  sourceLabel?: string | null;
}

export type TrajectoryClassLabel = 'exploding' | 'growing' | 'stable' | 'declining' | 'contracting' | 'unknown';

export interface TrajectoryClassifierResult {
  label: TrajectoryClassLabel;
  confidence: number | null;
  score: number | null;
  source: 'model' | 'fallback';
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function normalizeSeries(
  yearlySpend: Array<{ year: number; amount: number }> | undefined,
): Array<{ year: number; amount: number }> {
  if (!Array.isArray(yearlySpend)) return [];
  return yearlySpend
    .filter((p) => Number.isFinite(p.year) && Number.isFinite(p.amount))
    .sort((a, b) => a.year - b.year)
    .map((p) => ({ year: p.year, amount: p.amount }));
}

function deterministicFallback(
  growthRate: number | null | undefined,
  sourceLabel: string | null | undefined,
): TrajectoryClassLabel {
  if (typeof growthRate === 'number' && Number.isFinite(growthRate)) {
    if (growthRate >= 0.35) return 'exploding';
    if (growthRate >= 0.12) return 'growing';
    if (growthRate <= -0.3) return 'contracting';
    if (growthRate <= -0.08) return 'declining';
    return 'stable';
  }

  const txt = (sourceLabel ?? '').toLowerCase();
  if (!txt) return 'unknown';
  if (txt.includes('explod')) return 'exploding';
  if (txt.includes('grow') || txt.includes('increas')) return 'growing';
  if (txt.includes('contract')) return 'contracting';
  if (txt.includes('declin') || txt.includes('decreas')) return 'declining';
  if (txt.includes('stable') || txt.includes('flat')) return 'stable';
  return 'unknown';
}

/**
 * Logistic-style trajectory classifier.
 * Uses trend + volatility signals from spend time series when sufficient data is present.
 * Falls back deterministically when model inputs are sparse.
 */
export function classifyTrajectory(input: TrajectoryClassifierInput): TrajectoryClassifierResult {
  const points = normalizeSeries(input.yearlySpend);
  const fallbackLabel = deterministicFallback(input.growthRate, input.sourceLabel);

  if (points.length < 3) {
    return {
      label: fallbackLabel,
      confidence: null,
      score: null,
      source: 'fallback',
    };
  }

  const values = points.map((p) => p.amount);
  const n = values.length;
  const first = values[0] ?? 0;
  const last = values[n - 1] ?? 0;
  const baseline = Math.max(1, Math.abs(first));
  const pctDelta = (last - first) / baseline;

  let slopeNumerator = 0;
  let slopeDenominator = 0;
  const midX = (n - 1) / 2;
  const meanY = values.reduce((sum, v) => sum + v, 0) / n;
  for (let i = 0; i < n; i += 1) {
    const x = i - midX;
    slopeNumerator += x * ((values[i] ?? 0) - meanY);
    slopeDenominator += x * x;
  }
  const slope = slopeDenominator > 0 ? slopeNumerator / slopeDenominator : 0;
  const slopeNorm = slope / Math.max(1, Math.abs(meanY));

  let volatility = 0;
  for (let i = 1; i < n; i += 1) {
    const prev = values[i - 1] ?? 0;
    const curr = values[i] ?? 0;
    volatility += Math.abs(curr - prev) / Math.max(1, Math.abs(prev));
  }
  volatility = volatility / Math.max(1, n - 1);

  const externalGrowth =
    typeof input.growthRate === 'number' && Number.isFinite(input.growthRate) ? input.growthRate : 0;

  const z =
    -0.35 +
    pctDelta * 1.4 +
    slopeNorm * 4.2 +
    externalGrowth * 0.75 +
    (Math.log1p(Math.max(0, input.totalSpending ?? 0)) - 10) * 0.12 -
    volatility * 0.7;

  const score = sigmoid(z);
  const centered = score - 0.5;

  let label: TrajectoryClassLabel;
  if (centered >= 0.27) label = 'exploding';
  else if (centered >= 0.1) label = 'growing';
  else if (centered <= -0.27) label = 'contracting';
  else if (centered <= -0.1) label = 'declining';
  else label = 'stable';

  const confidence = clamp(Math.abs(centered) * 1.9 + (1 - clamp(volatility, 0, 1)) * 0.15, 0, 0.99);

  return {
    label,
    confidence,
    score,
    source: 'model',
  };
}
