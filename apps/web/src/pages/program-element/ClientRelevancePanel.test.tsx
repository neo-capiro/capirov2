import { render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import { ClientRelevancePanel } from './ClientRelevancePanel.js';
import type { RelevantClientRow } from '../clients/relevance-api.js';

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

const clientA: RelevantClientRow = {
  clientId: 'c1',
  clientName: 'Acme Defense',
  score: 0.9,
  paths: [
    {
      path: 'facility_district' as const,
      score: 0.6,
      evidence: ['Facility in district(s): TX-12'],
    },
    {
      path: 'ecosystem' as const,
      score: 0.5,
      evidence: ['Ecosystem performer(s): Acme Defense'],
    },
  ],
};

describe('ClientRelevancePanel', () => {
  beforeAll(setupAntdBrowserMocks);

  test('renders relevant clients with score badge and evidence/path chips', () => {
    render(<ClientRelevancePanel clients={[clientA]} />);

    expect(screen.getByText('Acme Defense')).toBeInTheDocument();
    expect(screen.getByText('90%')).toBeInTheDocument();
    expect(screen.getByText('Facility district')).toBeInTheDocument();
    expect(screen.getByText('Ecosystem')).toBeInTheDocument();
    expect(screen.getByText('Client relevance · 1')).toBeInTheDocument();
  });

  test('shows an honest empty state when no client clears the floor', () => {
    render(<ClientRelevancePanel clients={[]} />);

    expect(
      screen.getByText(/No clients in your portfolio clear the relevance floor/),
    ).toBeInTheDocument();
  });

  test('shows a loading skeleton without crashing', () => {
    const { container } = render(<ClientRelevancePanel clients={undefined} loading />);
    expect(container.querySelector('.ant-skeleton')).toBeTruthy();
  });

  test('guards against non-array / malformed data without throwing', () => {
    // clients is not an array (e.g. an error payload).
    render(<ClientRelevancePanel clients={{} as unknown as RelevantClientRow[]} />);
    expect(
      screen.getByText(/No clients in your portfolio clear the relevance floor/),
    ).toBeInTheDocument();

    // A row with a non-array paths field must still render the client name.
    render(
      <ClientRelevancePanel
        clients={[
          {
            clientId: 'c2',
            clientName: 'Beta Systems',
            score: 0.7,
            paths: undefined as unknown as RelevantClientRow['paths'],
          },
        ]}
      />,
    );
    expect(screen.getByText('Beta Systems')).toBeInTheDocument();
  });
});
