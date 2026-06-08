import { render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import { ProgramsPanel } from './ProgramsPanel.js';
import type { ProgramsForPeResponse } from './programs-api.js';

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

function response(over: Partial<ProgramsForPeResponse> = {}): ProgramsForPeResponse {
  return {
    peCode: '0601102A',
    acceptedMatches: [],
    candidateMatches: [],
    ...over,
  };
}

const acceptedMatch = {
  id: 'm1',
  programId: 'prog-1',
  program: { id: 'prog-1', canonicalName: 'PATRIOT', component: 'ARMY', mdapCode: 'M001', status: 'active' },
  peCode: '0601102A',
  projectCode: null,
  score: 1,
  confidenceBand: 'high' as const,
  evidenceTier: 'mdap_curated',
  status: 'accepted' as const,
  whyShown: 'curated MDAP map',
  evidence: [{ kind: 'mdap_curated', sourceUrl: 'http://seed', quote: 'seed_curated_v1' }],
  resolvedAt: '2026-06-07T12:00:00.000Z',
};

const candidateMatch = {
  ...acceptedMatch,
  id: 'm2',
  program: { id: 'prog-2', canonicalName: 'AEGIS', component: 'NAVY', mdapCode: 'M002', status: 'active' },
  score: 0.78,
  confidenceBand: 'medium' as const,
  evidenceTier: 'alias_trigram',
  status: 'candidate' as const,
  whyShown: 'alias match',
  resolvedAt: null,
};

describe('ProgramsPanel', () => {
  beforeAll(setupAntdBrowserMocks);

  test('renders accepted matches with program name, why-shown line, confidence + status badges', () => {
    render(<ProgramsPanel programs={response({ acceptedMatches: [acceptedMatch] })} />);

    expect(screen.getByText('PATRIOT')).toBeInTheDocument();
    expect(screen.getByText('curated MDAP map')).toBeInTheDocument();
    expect(screen.getByText('High confidence')).toBeInTheDocument();
    expect(screen.getByText('accepted')).toBeInTheDocument();
    expect(screen.getByText('Programs · 1')).toBeInTheDocument();
  });

  test('renders candidates only behind a "requires review" badge', () => {
    render(<ProgramsPanel programs={response({ candidateMatches: [candidateMatch] })} />);

    expect(screen.getByText('AEGIS')).toBeInTheDocument();
    expect(screen.getByText('Candidate — requires review')).toBeInTheDocument();
    expect(screen.getByText('Proposed candidates (awaiting review)')).toBeInTheDocument();
  });

  test('shows an honest empty state when there are no matches', () => {
    render(<ProgramsPanel programs={response()} />);

    expect(screen.getByText(/No programs linked to this Program Element yet/)).toBeInTheDocument();
  });

  test('guards against non-array / malformed data without throwing', () => {
    // acceptedMatches/candidateMatches missing entirely (e.g. an error payload).
    render(<ProgramsPanel programs={{ peCode: '0601102A' } as unknown as ProgramsForPeResponse} />);

    expect(screen.getByText(/No programs linked to this Program Element yet/)).toBeInTheDocument();
  });
});
