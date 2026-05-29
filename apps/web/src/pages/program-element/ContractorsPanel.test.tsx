import { render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { ContractorsPanel, formatContractorDollars } from './ContractorsPanel.js';

describe('ContractorsPanel', () => {
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

  test('renders mock data with CRM/new tags and highlighting classes', async () => {
    const { container } = render(
      <ContractorsPanel
        contractors={{
          data: [
            {
              contractorName: 'Acme Dynamics',
              amount: 1500,
              awards: 12,
              contractType: 'IDIQ',
              contractorIsCrmClient: true,
              isNewEntrant: false,
            },
            {
              contractorName: 'Nova Systems',
              amount: 45.2,
              awards: 2,
              contractType: 'FPIF',
              contractorIsCrmClient: false,
              isNewEntrant: true,
            },
          ],
          todo: null,
        }}
      />,
    );

    expect(screen.getByText(/Top contractors touching this PE/i)).toBeInTheDocument();
    expect(screen.getByText(/Acme Dynamics/i)).toBeInTheDocument();
    expect(screen.getByText(/Nova Systems/i)).toBeInTheDocument();
    expect(screen.getByText(/CRM Client/i)).toBeInTheDocument();
    expect(screen.getByText(/^New$/i)).toBeInTheDocument();
    expect(screen.getByText('$1.5B')).toBeInTheDocument();
    expect(screen.getByText('$45.2M')).toBeInTheDocument();

    const crmRow = container.querySelector('tr.contractor-row-crm');
    const warningRow = container.querySelector('tr.contractor-row-warning');
    expect(crmRow).not.toBeNull();
    expect(warningRow).not.toBeNull();
  });

  test('empty state renders cleanly', () => {
    render(<ContractorsPanel contractors={{ data: [], todo: 'federal_award table not yet created (Step 28)' }} />);
    expect(screen.getByText(/federal_award table not yet created \(Step 28\)/i)).toBeInTheDocument();
  });

  test('dollar formatter helper', () => {
    expect(formatContractorDollars(2500)).toBe('$2.5B');
    expect(formatContractorDollars(12.34)).toBe('$12.3M');
  });
});
