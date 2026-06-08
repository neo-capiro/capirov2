import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import { DefenseBudgetExposureCard } from './DefenseBudgetExposureCard.js';
import type { RelevantPesForClientResponse } from './relevance-api.js';

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

function renderCard(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

function response(over: Partial<RelevantPesForClientResponse> = {}): RelevantPesForClientResponse {
  return { data: [], total: 0, page: 1, limit: 8, ...over };
}

const sampleRow = {
  peCode: '0604201A',
  title: 'Counter-UAS Capabilities',
  score: 0.85,
  paths: [
    {
      path: 'capability_pe_direct' as const,
      score: 1,
      evidence: ['Capability lists PE 0604201A'],
    },
    {
      path: 'prior_award' as const,
      score: 0.8,
      evidence: ['2 prior awards on this PE (~$4.2M)'],
    },
  ],
};

describe('DefenseBudgetExposureCard', () => {
  beforeAll(setupAntdBrowserMocks);

  test('renders relevant PEs with score badge, title, and evidence chips', () => {
    renderCard(
      <DefenseBudgetExposureCard relevance={response({ data: [sampleRow], total: 1 })} />,
    );

    expect(screen.getByText('0604201A')).toBeInTheDocument();
    expect(screen.getByText('Counter-UAS Capabilities')).toBeInTheDocument();
    // Score badge as a percentage.
    expect(screen.getByText('85%')).toBeInTheDocument();
    // Evidence path chips (labels) from both paths.
    expect(screen.getByText('Capability lists PE')).toBeInTheDocument();
    expect(screen.getByText('Prior award')).toBeInTheDocument();
    // The "N relevant" count.
    expect(screen.getByText('1 relevant')).toBeInTheDocument();
  });

  test('shows an honest empty state when nothing clears the floor', () => {
    renderCard(<DefenseBudgetExposureCard relevance={response()} />);

    expect(screen.getByText(/No Program Elements clear the relevance floor yet/)).toBeInTheDocument();
  });

  test('shows a loading skeleton without crashing', () => {
    const { container } = renderCard(<DefenseBudgetExposureCard relevance={undefined} loading />);
    expect(container.querySelector('.ant-skeleton')).toBeTruthy();
  });

  test('guards against non-array / malformed data without throwing', () => {
    // data missing entirely (e.g. an error payload).
    renderCard(
      <DefenseBudgetExposureCard
        relevance={{ total: 0 } as unknown as RelevantPesForClientResponse}
      />,
    );
    expect(screen.getByText(/No Program Elements clear the relevance floor yet/)).toBeInTheDocument();

    // A row with a non-array paths field must still render its peCode.
    renderCard(
      <DefenseBudgetExposureCard
        relevance={
          response({
            data: [
              {
                peCode: '0603001A',
                title: null,
                score: 0.6,
                paths: undefined as unknown as (typeof sampleRow)['paths'],
              },
            ],
            total: 1,
          })
        }
      />,
    );
    expect(screen.getByText('0603001A')).toBeInTheDocument();
  });
});
