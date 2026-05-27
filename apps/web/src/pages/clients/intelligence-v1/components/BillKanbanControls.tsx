/**
 * D-006 BillKanbanControls
 * Controlled filter/sort toolbar for the Bill pipeline kanban.
 *
 * - Filter options: All | High fit (clioTag present) | High prob (≥70 %)
 * - Sort options:   Passage probability (desc, nulls last) | Bill number (alpha asc)
 * - State is lifted to the parent; this component is purely presentational.
 * - No external dependencies beyond React (already in the project).
 */

import type { CSSProperties } from 'react';

export type KanbanFilter = 'all' | 'high-fit' | 'high-prob';
export type KanbanSort = 'probability' | 'bill-number';

export interface KanbanControlsValue {
  filter: KanbanFilter;
  sort: KanbanSort;
}

interface BillKanbanControlsProps {
  value: KanbanControlsValue;
  onChange: (next: KanbanControlsValue) => void;
}

const FILTER_OPTIONS: { value: KanbanFilter; label: string }[] = [
  { value: 'all',       label: 'All'      },
  { value: 'high-fit',  label: 'High fit' },
  { value: 'high-prob', label: '≥70 %'    },
];

const SORT_OPTIONS: { value: KanbanSort; label: string }[] = [
  { value: 'probability', label: 'Passage probability' },
  { value: 'bill-number', label: 'Bill number'         },
];

const ACTIVE_STYLE: CSSProperties = {
  background:  'var(--accent-soft)',
  color:       'var(--accent-ink)',
  borderColor: 'var(--accent)',
};

export function BillKanbanControls({ value, onChange }: BillKanbanControlsProps) {
  return (
    <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      {/* ── Filter: segmented button group ── */}
      <span style={{ display: 'flex', gap: 2 }}>
        {FILTER_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            className="iv1-btn iv1-btn-sm"
            style={value.filter === opt.value ? ACTIVE_STYLE : undefined}
            aria-pressed={value.filter === opt.value}
            onClick={() => onChange({ ...value, filter: opt.value })}
          >
            {opt.label}
          </button>
        ))}
      </span>

      {/* ── Sort: native select styled to match iv1-btn ── */}
      <select
        className="iv1-btn iv1-btn-sm"
        style={{ display: 'inline-block', cursor: 'pointer' }}
        value={value.sort}
        onChange={(e) => onChange({ ...value, sort: e.target.value as KanbanSort })}
        aria-label="Sort bills by"
      >
        {SORT_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            Sort: {opt.label} ▾
          </option>
        ))}
      </select>
    </span>
  );
}
