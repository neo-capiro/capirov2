import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, test, vi } from 'vitest';
import { BillsTouchingPePanel, billProbabilityColor } from './BillsTouchingPePanel.js';

const navigateMock = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

describe('BillsTouchingPePanel', () => {
  test('setup browser mocks', () => {
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
    expect(true).toBe(true);
  });

  test('renders mock data and probability colors helper', () => {
    render(
      <MemoryRouter>
        <BillsTouchingPePanel
          bills={[
            {
              id: 'HR-123',
              congress: 119,
              billType: 'HR',
              billNumber: '123',
              title: 'A very long bill title that should be truncated because it is over sixty characters long for rendering checks',
              policyArea: null,
              latestActionText: null,
              latestActionDate: null,
              url: null,
              sponsor: 'Rep. Doe',
              committee: 'Armed Services',
              passageProbability: 0.75,
            },
            {
              id: 'S-456',
              congress: 119,
              billType: 'S',
              billNumber: '456',
              title: 'Senate measure',
              policyArea: null,
              latestActionText: null,
              latestActionDate: null,
              url: null,
              sponsor: 'Sen. Roe',
              committee: 'Appropriations',
              passageProbability: 0.4,
            },
            {
              id: 'HR-789',
              congress: 119,
              billType: 'HR',
              billNumber: '789',
              title: 'House red probability',
              policyArea: null,
              latestActionText: null,
              latestActionDate: null,
              url: null,
              sponsor: 'Rep. Poe',
              committee: 'Rules',
              passageProbability: 0.1,
            },
          ]}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText(/Bills touching this PE/i)).toBeInTheDocument();
    expect(screen.getByText(/HR-123/i)).toBeInTheDocument();
    expect(screen.getByText(/Rep. Doe • Armed Services/i)).toBeInTheDocument();

    expect(billProbabilityColor(0.75)).toBe('green');
    expect(billProbabilityColor(0.5)).toBe('gold');
    expect(billProbabilityColor(0.2)).toBe('red');
  });

  test('empty state renders', () => {
    render(
      <MemoryRouter>
        <BillsTouchingPePanel bills={[]} />
      </MemoryRouter>,
    );

    expect(screen.getByText(/No linked bills yet/i)).toBeInTheDocument();
  });

  test('click navigates to bill detail route', () => {
    render(
      <MemoryRouter>
        <BillsTouchingPePanel
          bills={[
            {
              id: 'HR-123',
              congress: 119,
              billType: 'HR',
              billNumber: '123',
              title: 'Title',
              policyArea: null,
              latestActionText: null,
              latestActionDate: null,
              url: null,
              sponsor: 'Rep. Doe',
              committee: 'Armed Services',
              passageProbability: 0.75,
            },
          ]}
        />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByText(/HR-123/i));
    expect(navigateMock).toHaveBeenCalledWith('/bills/HR-123');
  });
});
