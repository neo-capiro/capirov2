import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, test, vi } from 'vitest';
import { BillKanban, type BillKanbanColumn } from './BillKanban.js';

describe('BillKanban identifier display vs functional id', () => {
  const columns: BillKanbanColumn[] = [
    {
      stage: 'passed',
      label: 'Passed chamber',
      count: 1,
      cards: [
        {
          num: '119-hr-1742',
          displayNum: 'H.R. 1742',
          title: 'Access to Reproductive Care for Servicemembers Act',
          pct: 72,
          isManual: false,
        },
      ],
    },
  ];

  test('shows the humanized label but keeps the raw slug for the drill-through href', () => {
    render(
      <MemoryRouter>
        <BillKanban columns={columns} billDrillHref="/explorer" />
      </MemoryRouter>,
    );

    // User sees "H.R. 1742", not the raw "119-hr-1742" slug.
    expect(screen.getByText('H.R. 1742')).toBeInTheDocument();
    expect(screen.queryByText('119-hr-1742')).not.toBeInTheDocument();

    // The drill-through link must still carry the RAW id the explorer expects.
    expect(screen.getByRole('link')).toHaveAttribute('href', '/explorer?bill=119-hr-1742');
  });

  test('track toggle fires with the raw bill id, not the display label', () => {
    const onToggleTrack = vi.fn();
    render(
      <MemoryRouter>
        <BillKanban columns={columns} billDrillHref="/explorer" onToggleTrack={onToggleTrack} />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: /Track H\.R\. 1742/i }));
    expect(onToggleTrack).toHaveBeenCalledWith('119-hr-1742', false);
  });
});
