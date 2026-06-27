/**
 * Nested section outline shown under the "Draft" step in the StepsRail (ported
 * from the prototype StepsRail's draft-nested block, asset_07). Status dots
 * (empty = hollow, done = accent fill, review = notable fill), Meri sparkle on
 * smart sections, Add section, and Pages/Words counters.
 */
import { Icon } from '../kit.js';
import type { SectionView } from './section-model.js';
import { estimatePages, totalWords } from './section-model.js';

export function DraftOutline({
  views,
  onAddSection,
}: {
  views: SectionView[];
  onAddSection: () => void;
}) {
  const words = totalWords(views);
  const pages = estimatePages(words);

  return (
    <div
      style={{ margin: '2px 0 6px 19px', paddingLeft: 11, borderLeft: '1px solid var(--border-1)' }}
    >
      {views.map((sec, j) => (
        <div
          key={sec.name + j}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '5px 6px',
            borderRadius: 5,
            fontSize: 12,
            background: sec.smart ? 'var(--accent-soft)' : 'transparent',
            color: sec.status === 'empty' ? 'var(--ink-3)' : 'var(--ink-1)',
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              flex: 'none',
              border: sec.status === 'empty' ? '1.5px solid var(--ink-4)' : 'none',
              background:
                sec.status === 'done'
                  ? 'var(--accent)'
                  : sec.status === 'review'
                    ? 'var(--notable)'
                    : 'transparent',
            }}
          />
          <span
            style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
          >
            {sec.name}
          </span>
          {sec.smart && <Icon name="Sparkles" size={10} style={{ color: 'var(--accent)' }} />}
        </div>
      ))}
      <button
        className="btn sm btn-ghost"
        onClick={onAddSection}
        style={{
          justifyContent: 'flex-start',
          color: 'var(--ink-2)',
          marginTop: 2,
          paddingLeft: 6,
        }}
      >
        <Icon name="Plus" size={12} />
        Add section
      </button>
      <div
        style={{
          marginTop: 10,
          paddingTop: 10,
          borderTop: '1px solid var(--border-1)',
          paddingLeft: 6,
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
        }}
      >
        <div style={{ fontSize: 11.5, color: 'var(--ink-2)' }}>
          Pages: <b className="num">{pages}</b>
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--ink-2)' }}>
          Words: <b className="num">{words}</b>
        </div>
      </div>
    </div>
  );
}
