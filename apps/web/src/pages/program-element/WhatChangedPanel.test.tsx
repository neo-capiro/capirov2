import { render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { materialityColor, WhatChangedPanel } from './WhatChangedPanel.js';
import type { ProgramElementDelta } from './types.js';

function setupAntdBrowserMocks() {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverMock);
}

function delta(over: Partial<ProgramElementDelta> = {}): ProgramElementDelta {
  return {
    id: 'd1',
    peCode: '0601102A',
    assertedFy: 2027,
    deltaType: 'mark_vs_request',
    fromRef: 'request',
    toRef: 'hascMark',
    amountFrom: 100,
    amountTo: 150,
    deltaAbs: 50,
    deltaPct: 0.5,
    explanation: null,
    materialityScore: 0.72,
    computedAt: '2026-06-07T00:00:00.000Z',
    ...over,
  };
}

describe('WhatChangedPanel', () => {
  beforeAll(setupAntdBrowserMocks);

  it('renders top deltas with type label, FY, and materiality score', () => {
    render(<WhatChangedPanel deltas={[delta()]} />);
    expect(screen.getByText('Mark vs request')).toBeInTheDocument();
    expect(screen.getByText('FY2027')).toBeInTheDocument();
    expect(screen.getByText('72')).toBeInTheDocument();
  });

  it('caps the list at max', () => {
    const many = Array.from({ length: 10 }, (_v, i) => delta({ id: `d${i}` }));
    render(<WhatChangedPanel deltas={many} max={3} />);
    expect(screen.getAllByText('Mark vs request')).toHaveLength(3);
  });

  it('shows an honest empty state', () => {
    render(<WhatChangedPanel deltas={[]} />);
    expect(screen.getByText(/No scored budget changes/)).toBeInTheDocument();
  });

  it('materialityColor maps score → band', () => {
    expect(materialityColor(0.8)).toBe('red');
    expect(materialityColor(0.5)).toBe('orange');
    expect(materialityColor(0.2)).toBe('default');
  });
});
