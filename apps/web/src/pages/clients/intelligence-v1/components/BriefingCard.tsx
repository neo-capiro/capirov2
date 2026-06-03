import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { formatCompact, formatDate } from '../mappers.js';

/** True for app-internal SPA routes that should navigate without a full reload. */
function isInternalHref(href: string): boolean {
  return href.startsWith('/') && !href.startsWith('//');
}

type BriefingTone = 'critical' | 'notable' | 'info' | 'neutral';

interface BriefingHighlight {
  label: string;
  value: string | number | null;
  tone: BriefingTone;
}

interface BriefingData {
  summary: string | null;
  highlights: BriefingHighlight[];
  generatedAt: string;
  eventCount: number;
  ctaHref?: string;
}

interface BriefingCardProps {
  briefing?: BriefingData | null;
  fallbackSummary: ReactNode;
  ctaHref: string;
}

const toneClass: Record<BriefingTone, string> = {
  critical: 'is-critical',
  notable: 'is-notable',
  info: 'is-info',
  neutral: 'is-neutral',
};

// Highlight values arrive as raw numbers for counts ("Bills tracked": 50) AND
// for money ("Lobbying TTM": 510000). Money labels get compact-dollar
// formatting so the pill reads "$510K" instead of "510000"; counts pass through
// untouched. Pre-formatted strings (e.g. "3 due ≤7d") are returned as-is.
const CURRENCY_HIGHLIGHT = /lobby|spend|ttm|obligation|funding|contribution|\$/i;

function formatHighlightValue(label: string, value: string | number | null): string {
  if (value == null || value === '') return '';
  if (typeof value === 'number' && CURRENCY_HIGHLIGHT.test(label)) return formatCompact(value);
  return String(value);
}

function summarizeHighlights(highlights: BriefingHighlight[]): ReactNode {
  if (!highlights.length) return null;

  const ranked = [...highlights]
    .sort((a, b) => {
      const rank = (tone: BriefingTone) => {
        if (tone === 'critical') return 4;
        if (tone === 'notable') return 3;
        if (tone === 'info') return 2;
        return 1;
      };
      return rank(b.tone) - rank(a.tone);
    })
    .slice(0, 2);

  return (
    <>
      {' '}
      {ranked.map((h, idx) => (
        <span key={`${h.label}-${idx}`}>
          <mark className={h.tone === 'critical' ? 'crit' : undefined}>
            {(() => {
              const v = formatHighlightValue(h.label, h.value);
              return v ? `${v} ${h.label}` : h.label;
            })()}
          </mark>
          {idx < ranked.length - 1 ? ' · ' : ''}
        </span>
      ))}
    </>
  );
}

export function BriefingCard({ briefing, fallbackSummary, ctaHref }: BriefingCardProps) {
  const highlights = briefing?.highlights ?? [];
  const summary = briefing?.summary?.trim();
  const generatedAt = briefing?.generatedAt;
  const eventCount = briefing?.eventCount;
  // G1: Snapshot briefing CTA must route to client-filtered Changes Inbox.
  // Prefer the parent-provided href (already scoped to client), then fall back.
  const targetHref = ctaHref || briefing?.ctaHref || '/intelligence/changes';

  return (
    <div className="iv1-briefing-wrap">
      <span
        className="iv1-clio-avatar"
        title="Clio"
        aria-label="Clio"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#fff"
          strokeWidth="2.2"
          strokeLinecap="round"
        >
          <path d="M12 3v3M12 18v3M3 12h3M18 12h3M6 6l2.2 2.2M15.8 15.8 18 18M6 18l2.2-2.2M15.8 8.2 18 6" />
        </svg>
      </span>
      <div className="iv1-briefing-body">
        <div className="iv1-briefing-titlebar">
          <span className="iv1-clio-badge">Clio briefing</span>
          {generatedAt ? (
            <span className="iv1-briefing-date">{formatDate(generatedAt)}</span>
          ) : null}
        </div>

        {highlights.length > 0 && (
          <div className="iv1-briefing-highlights">
            {highlights.map((h, idx) => {
              const display = formatHighlightValue(h.label, h.value);
              return (
                <span key={`${h.label}-${idx}`} className={`iv1-highlight-pill ${toneClass[h.tone]}`}>
                  <span className="iv1-highlight-pill-label">{h.label}</span>
                  {display ? <b>{display}</b> : null}
                </span>
              );
            })}
          </div>
        )}

        <p className="iv1-briefing-text">
          {summary || fallbackSummary}
          {!summary && summarizeHighlights(highlights)}
        </p>

        <div className="iv1-briefing-meta">
          <span className="iv1-briefing-eventcount">
            {eventCount != null
              ? `${eventCount} event${eventCount === 1 ? '' : 's'} synthesized`
              : 'No events synthesized'}
          </span>
          {isInternalHref(targetHref) ? (
            <Link className="iv1-link" to={targetHref}>
              See all changes →
            </Link>
          ) : (
            <a className="iv1-link" href={targetHref}>
              See all changes →
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
