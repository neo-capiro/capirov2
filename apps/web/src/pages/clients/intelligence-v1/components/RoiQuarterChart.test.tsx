import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { RoiQuarterChart } from './RoiQuarterChart.js';

describe('RoiQuarterChart', () => {
  // The most recent quarter has no data yet (obligations lag) — the footnote
  // must anchor on the latest quarter that actually has activity, not the
  // empty trailing bucket which would read "$0 · $0 · 0.00×".
  const series = [
    { label: "Q1'25", lobbying: 500_000, obligations: 7_000_000_000 },
    { label: "Q2'25", lobbying: 0, obligations: 0 },
  ];

  test('footnote anchors on the latest active quarter and formats the ratio sanely', () => {
    render(<RoiQuarterChart series={series} />);

    const footnote = document.querySelector('.iv1-qchart-footnote');
    expect(footnote?.textContent).toContain("Q1'25");
    expect(footnote?.textContent).toContain('$7.0B');
    // Large ratio is rounded with separators, never "14000.0×".
    expect(footnote?.textContent).toContain('14,000×');
    // The empty trailing quarter must NOT drive the footnote.
    expect(footnote?.textContent).not.toContain('0.00×');
  });

  test('empty quarters render a dash rather than a misleading 0.0×', () => {
    render(<RoiQuarterChart series={series} />);
    expect(screen.getAllByText('–').length).toBeGreaterThan(0);
  });
});
