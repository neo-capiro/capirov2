import { render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import { ProvisionsPanel } from './ProvisionsPanel.js';
import type { ProvisionItem } from './types.js';

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

function provision(over: Partial<ProvisionItem> = {}): ProvisionItem {
  return {
    id: 'p1',
    committee: 'hasc',
    fy: 2027,
    heading: 'Hypersonic test acceleration',
    text: 'The committee directs the Secretary to provide a briefing on the program schedule.',
    pageStart: 142,
    pageEnd: 143,
    actionType: 'directs_briefing',
    sourceUrl: 'https://reports.example/hasc-fy27.pdf',
    matchBasis: 'pe_code_exact',
    reviewStatus: 'accepted',
    confidence: 0.92,
    ...over,
  };
}

describe('ProvisionsPanel', () => {
  beforeAll(setupAntdBrowserMocks);

  test('renders provisions with committee + actionType labels, heading, FY, and page link', () => {
    render(<ProvisionsPanel provisions={[provision()]} />);

    expect(screen.getByText('HASC')).toBeInTheDocument();
    expect(screen.getByText('Directs briefing')).toBeInTheDocument();
    expect(screen.getByText('Hypersonic test acceleration')).toBeInTheDocument();
    expect(screen.getByText('FY2027')).toBeInTheDocument();

    const link = screen.getByText('p. 142').closest('a');
    expect(link).toHaveAttribute(
      'href',
      'https://reports.example/hasc-fy27.pdf#page=142',
    );
  });

  test('shows the candidate review badge only for candidate rows', () => {
    render(
      <ProvisionsPanel
        provisions={[
          provision({ id: 'a', reviewStatus: 'accepted' }),
          provision({
            id: 'b',
            committee: 'sasc',
            actionType: 'cuts',
            heading: 'Reduction for schedule slip',
            reviewStatus: 'candidate',
          }),
        ]}
      />,
    );

    expect(screen.getByText('SASC')).toBeInTheDocument();
    expect(screen.getByText('Cuts')).toBeInTheDocument();
    expect(screen.getByText('Reduction for schedule slip')).toBeInTheDocument();
    // Exactly one candidate badge (the candidate row), not the accepted one.
    expect(screen.getAllByText('Candidate — review')).toHaveLength(1);
  });

  test('shows an honest empty state for an empty array', () => {
    render(<ProvisionsPanel provisions={[]} />);

    expect(
      screen.getByText(/No congressional report language linked to this PE yet/),
    ).toBeInTheDocument();
  });

  test('does not crash on a null actionType / null pageStart', () => {
    render(
      <ProvisionsPanel
        provisions={[
          provision({
            id: 'descriptive',
            actionType: null,
            pageStart: null,
            pageEnd: null,
            sourceUrl: 'https://reports.example/conf.pdf',
            committee: 'conference',
          }),
        ]}
      />,
    );

    expect(screen.getByText('Conference')).toBeInTheDocument();
    // null actionType renders the em-dash placeholder.
    expect(screen.getByText('—')).toBeInTheDocument();
    // sourceUrl present but no pageStart -> "Open source" link, no "#page=".
    const link = screen.getByText('Open source').closest('a');
    expect(link).toHaveAttribute('href', 'https://reports.example/conf.pdf');
  });

  test('guards against non-array / malformed data without throwing', () => {
    render(<ProvisionsPanel provisions={undefined} />);

    expect(
      screen.getByText(/No congressional report language linked to this PE yet/),
    ).toBeInTheDocument();
  });
});
