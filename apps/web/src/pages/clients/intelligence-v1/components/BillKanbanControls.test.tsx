import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { BillKanbanControls, type KanbanControlsValue } from './BillKanbanControls.js';

describe('BillKanbanControls interactions', () => {
  test('updates filter via segmented controls', () => {
    const onChange = vi.fn();
    const value: KanbanControlsValue = { filter: 'all', sort: 'probability' };

    render(<BillKanbanControls value={value} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'High fit' }));
    expect(onChange).toHaveBeenCalledWith({ filter: 'high-fit', sort: 'probability' });
  });

  test('updates sort via select control', () => {
    const onChange = vi.fn();
    const value: KanbanControlsValue = { filter: 'high-prob', sort: 'probability' };

    render(<BillKanbanControls value={value} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('Sort bills by'), {
      target: { value: 'bill-number' },
    });

    expect(onChange).toHaveBeenCalledWith({ filter: 'high-prob', sort: 'bill-number' });
  });
});
