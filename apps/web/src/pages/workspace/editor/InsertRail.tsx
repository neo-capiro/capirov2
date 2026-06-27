/**
 * Insert rail (tiles only) — ported from the prototype `InsertRail` (asset_12).
 * Section / Templates / Photo / Table / Logo.
 *
 * Phase 6 stubs (DEFERRED): the Templates modal and the Table-type picker are
 * not built here — those tiles toast for now so the layout matches. Section /
 * Photo / Logo insert immediately.
 */
import { Icon } from '../kit.js';

function Tile({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={'Insert ' + label}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 5,
        padding: '11px 4px',
        border: '1px solid var(--border-1)',
        background: 'var(--bg-surface)',
        borderRadius: 9,
        cursor: 'pointer',
        font: 'inherit',
        color: 'var(--ink-2)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'var(--accent)';
        e.currentTarget.style.color = 'var(--accent)';
        e.currentTarget.style.background = 'var(--accent-soft)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--border-1)';
        e.currentTarget.style.color = 'var(--ink-2)';
        e.currentTarget.style.background = 'var(--bg-surface)';
      }}
    >
      <Icon name={icon} size={18} />
      <span style={{ fontSize: 10, fontWeight: 600 }}>{label}</span>
    </button>
  );
}

export function InsertRail({
  onAddSection,
  onInsert,
  onToast,
}: {
  onAddSection: () => void;
  onInsert: (kind: string) => void;
  onToast: (msg: string) => void;
}) {
  return (
    <div
      style={{
        borderLeft: '1px solid var(--border-1)',
        background: 'var(--bg-surface)',
        padding: '16px 9px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div
        style={{
          fontSize: 9.5,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          color: 'var(--ink-3)',
          fontWeight: 600,
          textAlign: 'center',
          marginBottom: 2,
        }}
      >
        Insert
      </div>
      <Tile icon="Plus" label="Section" onClick={onAddSection} />
      {/* TODO(phase 6): Templates modal — toast stub for now. */}
      <Tile
        icon="LayoutTemplate"
        label="Templates"
        onClick={() => onToast('Templates picker arrives in a later phase')}
      />
      <Tile icon="Image" label="Photo" onClick={() => onInsert('image')} />
      {/* TODO(phase 6): Table-type picker (platform vs custom) — inserts a sample table for now. */}
      <Tile icon="Table" label="Table" onClick={() => onInsert('table')} />
      <Tile icon="Stamp" label="Logo" onClick={() => onInsert('logo')} />
    </div>
  );
}
