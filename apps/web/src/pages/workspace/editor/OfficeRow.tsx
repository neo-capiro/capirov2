/**
 * Submission-targets office switcher (ported from the prototype `OfficeRow`,
 * asset_14). Renders ONLY when `cfg.personalize` (the single canonical
 * predicate, Q-ED-1). One chip per office from `cfg.offices` (active = accent);
 * "+ Office" adds another target (toast stub for now).
 */
import { Ava, Icon } from '../kit.js';

function initialsOf(name: string): string {
  return name
    .replace(/^(Rep\.|Sen\.)\s+/, '')
    .split(/\s+/)
    .map((x) => x[0])
    .filter(Boolean)
    .slice(-2)
    .join('')
    .toUpperCase();
}

export function OfficeRow({
  offices,
  active,
  onChange,
  onToast,
}: {
  offices: string[];
  active: string | null;
  onChange: (who: string) => void;
  onToast: (msg: string) => void;
}) {
  return (
    <div style={{ maxWidth: 624, width: '100%', margin: '0 auto 4px' }}>
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap', marginBottom: 5 }}
      >
        <span
          style={{
            fontSize: 10.5,
            color: 'var(--ink-3)',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.07em',
            marginRight: 3,
          }}
        >
          Submission targets
        </span>
        {offices.map((who) => {
          const on = active === who;
          return (
            <button
              key={who}
              onClick={() => onChange(who)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 10px 4px 6px',
                borderRadius: 20,
                border: '1px solid',
                borderColor: on ? 'var(--accent)' : 'var(--border-1)',
                background: on ? 'var(--accent-soft)' : 'var(--bg-surface)',
                color: on ? 'var(--accent-ink)' : 'var(--ink-2)',
                fontSize: 12,
                fontWeight: on ? 600 : 400,
                cursor: 'pointer',
                fontFamily: 'var(--font-sans)',
              }}
            >
              <Ava x={initialsOf(who)} size={18} />
              {who.replace(/^(Rep\.|Sen\.)\s+/, '')}
            </button>
          );
        })}
        <button
          className="btn sm btn-ghost"
          style={{ color: 'var(--ink-3)', fontSize: 11 }}
          onClick={() => onToast('+ Office: add another submission target')}
        >
          <Icon name="Plus" size={12} />
          Office
        </button>
      </div>
    </div>
  );
}
