/**
 * Workspace shared kit — presentational primitives ported from the locked
 * prototype's wskit.jsx (Icon, Ava, AvaStack, Kicker, MeriCallout, MeriBtn).
 *
 * Icons come from lucide-react (the prototype used the lucide global). All
 * components render the prototype's scoped utility classes (.card/.btn/.num)
 * + design tokens (var(--accent) …) defined in workspace-ds.css.
 */
import type { CSSProperties, ReactNode, ComponentType } from 'react';
import * as Lucide from 'lucide-react';

type LucideProps = {
  size?: number;
  strokeWidth?: number;
  style?: CSSProperties;
  className?: string;
  color?: string;
};

/** Render any Lucide icon by its PascalCase name (matches the prototype's `<Icon name="X" />`). */
export function Icon({
  name,
  size = 16,
  strokeWidth = 1.9,
  style,
  className,
}: {
  name: string;
  size?: number;
  strokeWidth?: number;
  style?: CSSProperties;
  className?: string;
}) {
  const Cmp = (Lucide as unknown as Record<string, ComponentType<LucideProps>>)[name];
  if (!Cmp) return null;
  return <Cmp size={size} strokeWidth={strokeWidth} style={style} className={className} />;
}

const AVA_TONES: Record<string, string> = {
  NM: '#2A57CE',
  MR: '#7A4FB5',
  EO: '#2E6B43',
  JO: '#A26913',
  RA: '#B5301B',
  AA: '#2C5BD4',
  KB: '#4F525A',
  meri: 'linear-gradient(135deg,#4E78D8,#1A3F9F)',
};

/** Round avatar with initials; color keyed off the initials or an explicit tone. */
export function Ava({ x, tone, size = 24 }: { x: string; tone?: string; size?: number }) {
  const bg = tone || AVA_TONES[x] || 'linear-gradient(135deg,#4E78D8,#1A3F9F)';
  return (
    <span
      className="num"
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: bg,
        color: '#fff',
        display: 'inline-grid',
        placeItems: 'center',
        fontSize: size * 0.4,
        fontWeight: 600,
        flex: 'none',
        boxShadow: '0 0 0 1.5px var(--bg-surface)',
      }}
    >
      {x === 'meri' ? '' : x}
    </span>
  );
}

/** Overlapping stack of avatars. */
export function AvaStack({ list, size = 24 }: { list: string[]; size?: number }) {
  return (
    <span style={{ display: 'inline-flex' }}>
      {list.map((x, i) => (
        <span key={i} style={{ marginLeft: i ? -7 : 0 }}>
          <Ava x={x} size={size} />
        </span>
      ))}
    </span>
  );
}

/** Uppercase tracked label above headings. */
export function Kicker({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div
      style={{
        fontSize: 10.5,
        textTransform: 'uppercase',
        letterSpacing: '0.09em',
        color: 'var(--ink-3)',
        fontWeight: 600,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** Meri callout banner — left accent border + MERI label. Compliance: keeps Meri output attributable. */
export function MeriCallout({
  children,
  action,
  onAction,
  style,
}: {
  children: ReactNode;
  action?: string;
  onAction?: () => void;
  style?: CSSProperties;
}) {
  return (
    <div
      className="card"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 13,
        padding: '12px 15px',
        borderLeft: '3px solid var(--accent)',
        boxShadow: 'none',
        ...style,
      }}
    >
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          color: 'var(--accent)',
          fontWeight: 700,
          fontSize: 11,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          flex: 'none',
        }}
      >
        <Icon name="Sparkles" size={14} />
        Meri
      </span>
      <span style={{ flex: 1, fontSize: 13, color: 'var(--ink-1)', lineHeight: 1.4 }}>
        {children}
      </span>
      {action && (
        <a
          onClick={onAction}
          style={{
            color: 'var(--accent)',
            fontSize: 12.5,
            fontWeight: 600,
            whiteSpace: 'nowrap',
            cursor: 'pointer',
          }}
        >
          {action} →
        </a>
      )}
    </div>
  );
}

/** Accent "Draft with Meri" button with a Sparkles glyph. */
export function MeriBtn({
  children = 'Draft with Meri',
  size,
  onClick,
}: {
  children?: ReactNode;
  size?: 'sm';
  onClick?: () => void;
}) {
  return (
    <button className={'btn btn-accent' + (size === 'sm' ? ' sm' : '')} onClick={onClick}>
      <Icon name="Sparkles" size={size === 'sm' ? 13 : 14} />
      {children}
    </button>
  );
}
