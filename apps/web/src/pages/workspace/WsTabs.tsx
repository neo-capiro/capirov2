/** Library | Documents tab bar (ported from the prototype WsTabs). */
export function WsTabs({
  active,
  onNav,
}: {
  active: 'library' | 'documents';
  onNav: (k: 'library' | 'documents') => void;
}) {
  const tabs: Array<['library' | 'documents', string]> = [
    ['library', 'Library'],
    ['documents', 'Documents'],
  ];
  return (
    <div
      style={{
        display: 'flex',
        gap: 4,
        borderBottom: '1px solid var(--border-1)',
        margin: '2px 0 22px',
      }}
    >
      {tabs.map(([k, l]) => (
        <button
          key={k}
          onClick={() => onNav(k)}
          style={{
            border: 'none',
            background: 'none',
            cursor: 'pointer',
            fontFamily: 'var(--font-sans)',
            fontSize: 13.5,
            fontWeight: 600,
            color: active === k ? 'var(--ink-1)' : 'var(--ink-3)',
            padding: '8px 12px',
            borderBottom: active === k ? '2px solid var(--accent)' : '2px solid transparent',
            marginBottom: -1,
          }}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
