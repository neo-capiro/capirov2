import { useState, useMemo } from 'react';

export interface HearingMarkupItem {
  /** Optional stable ID — derived from month+day+title when absent. */
  id?: string;
  month: string;
  day: string;
  title: string;
  sub: string;
  time: string;
  room: string;
}

interface HearingsMarkupListProps {
  items: HearingMarkupItem[];
  syncCalendarHref: string;
  setAlertsHref: string;
}

/** Derive a stable, URL-safe key for a hearing item. */
function itemKey(item: HearingMarkupItem): string {
  return (
    item.id?.trim() ||
    `${item.month}-${item.day}-${item.title.slice(0, 40).replace(/\s+/g, '-').toLowerCase()}`
  );
}

/**
 * Append a single query param to a URL string.
 * - Preserves any existing query params.
 * - Preserves any fragment (#hash) at the end.
 * - No-ops when value is empty.
 */
function appendParam(href: string, key: string, value: string): string {
  if (!value) return href;
  const encoded = `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
  // Separate fragment if present
  const hashIdx = href.indexOf('#');
  const fragment = hashIdx >= 0 ? href.slice(hashIdx) : '';
  const base = hashIdx >= 0 ? href.slice(0, hashIdx) : href;
  const separator = base.includes('?') ? '&' : '?';
  return `${base}${separator}${encoded}${fragment}`;
}

export function HearingsMarkupList({
  items,
  syncCalendarHref,
  setAlertsHref,
}: HearingsMarkupListProps) {
  const safeSyncHref = syncCalendarHref?.trim() || '/engagement';
  const safeAlertsHref = setAlertsHref?.trim() || '/intelligence/changes';

  // '' means "no explicit user selection yet — use deterministic default"
  const [selectedKey, setSelectedKey] = useState<string>('');

  // Effective selection: user pick (if still valid) → first item → ''
  const effectiveKey = useMemo<string>(() => {
    if (!items.length) return '';
    const keys = items.map(itemKey);
    if (selectedKey && keys.includes(selectedKey)) return selectedKey;
    return keys[0] ?? ''; // deterministic default: first item (guarded by length check above)
  }, [items, selectedKey]);

  // Build action hrefs enriched with the selected hearing context
  const enrichedSyncHref = useMemo(
    () => appendParam(safeSyncHref, 'hearing', effectiveKey),
    [safeSyncHref, effectiveKey],
  );
  const enrichedAlertsHref = useMemo(
    () => appendParam(safeAlertsHref, 'hearing', effectiveKey),
    [safeAlertsHref, effectiveKey],
  );

  return (
    <>
      {items.map((h) => {
        const key = itemKey(h);
        const isSelected = key === effectiveKey;
        return (
          <div
            key={key}
            role="button"
            tabIndex={0}
            onClick={() => setSelectedKey(key)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setSelectedKey(key);
              }
            }}
            className={`iv1-hearing-row${isSelected ? ' iv1-hearing-row--selected' : ''}`}
            aria-pressed={isSelected}
            style={{ cursor: 'pointer' }}
          >
            <div className="iv1-hearing-date">
              <div className="m">{h.month}</div>
              <div className="d num">{h.day}</div>
            </div>
            <div>
              <div className="iv1-hearing-title">{h.title}</div>
              <div className="iv1-hearing-sub">{h.sub}</div>
            </div>
            <div className="iv1-hearing-time num">
              {h.time}
              <br />
              {h.room}
            </div>
          </div>
        );
      })}

      <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border-1)', display: 'flex', gap: 8 }}>
        <a href={enrichedSyncHref} className="iv1-btn iv1-btn-sm" style={{ textDecoration: 'none' }}>
          Sync to calendar
        </a>
        <a href={enrichedAlertsHref} className="iv1-btn iv1-btn-sm" style={{ textDecoration: 'none' }}>
          Set alerts
        </a>
      </div>
    </>
  );
}
