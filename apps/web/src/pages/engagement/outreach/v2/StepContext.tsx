// Step 4, Context Builder.
//
// Two-pane interface:
//   • Left , browse a pool of bills, intel, past emails, past meetings,
//             plus a "Custom note" tab. Each item has a `matches` array
//             of recipient/client ids it naturally belongs to.
//   • Right, the "context plan": selected items grouped into Shared
//             (every recipient sees it) and per-recipient sections.
//             Each card has a free-form `note` textarea that the AI uses
//             as an extra instruction for that one item, and a scope
//             dropdown to manually re-route.
//
// Smart routing: when an item is added, we look at recipients matching
// item.matches (by recipient.id OR recipient.clientId). One match →
// scope = that recipient.id. Zero or multi → scope = 'all'.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  CloseOutlined,
  FileTextOutlined,
  MailOutlined,
  CalendarOutlined,
  PaperClipOutlined,
  PlusOutlined,
  SearchOutlined,
  RobotOutlined,
} from '@ant-design/icons';
import { useApi } from '../../../../lib/use-api.js';
import type { OutreachRecipient } from '../../OutreachView.js';
import {
  recipientKey,
  type ContextKind,
  type ContextPoolItem,
  type SelectedContextItem,
} from './types.js';

interface BillSearchRow {
  id: string;
  billType: string | null;
  billNumber: string | null;
  title: string;
  latestActionText: string | null;
  latestActionDate: string | null;
  policyArea: string | null;
}

interface Props {
  recipients: OutreachRecipient[];
  selected: SelectedContextItem[];
  onChange: (next: SelectedContextItem[]) => void;
  pool: Record<ContextKind, ContextPoolItem[]>;
  loading?: boolean;
}

// Intel tab intentionally removed — bills/emails/meetings/notes only.
const TABS: Array<{ id: ContextKind; label: string; Icon: typeof FileTextOutlined }> = [
  { id: 'bill', label: 'Bills', Icon: FileTextOutlined },
  { id: 'email', label: 'Past emails', Icon: MailOutlined },
  { id: 'meeting', label: 'Past meetings', Icon: CalendarOutlined },
  { id: 'document', label: 'Docs & Notes', Icon: PaperClipOutlined },
  { id: 'note', label: 'Custom note', Icon: PlusOutlined },
];

const KIND_LABEL: Record<ContextKind, string> = {
  bill: 'Bill',
  intel: 'Intel',
  email: 'Past email',
  meeting: 'Meeting',
  note: 'Note',
  document: 'Doc/Note',
};

export function StepContext({ recipients, selected, onChange, pool, loading }: Props) {
  const api = useApi();
  const [tab, setTab] = useState<ContextKind>('bill');
  const [search, setSearch] = useState('');

  // Debounce the search box so bill lookups don't fire on every keystroke.
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  // Bills: searching hits the ENTIRE congress-bill corpus server-side (not just
  // the client's tracked bills shown by default). Keyword match on title/sponsor.
  const billSearchActive = tab === 'bill' && debouncedSearch.length >= 2;
  const billSearch = useQuery({
    enabled: billSearchActive,
    queryKey: ['ctx-bill-search', debouncedSearch],
    queryFn: async () => {
      const res = await api.get<{ rows: BillSearchRow[] }>('/api/explorer/congress-bills', {
        params: { q: debouncedSearch, pageSize: 30, sort: 'latestAction' },
      });
      return res.data.rows.map<ContextPoolItem>((b) => ({
        // Same id scheme as tracked bills so selection/dedupe lines up.
        id: `bill-${b.id}`,
        kind: 'bill',
        title: `${(b.billType ?? '').toUpperCase()}${b.billNumber ? ` ${b.billNumber}` : ''}${b.billType || b.billNumber ? ', ' : ''}${b.title}`,
        body: b.latestActionText ?? undefined,
        tag: b.policyArea ?? undefined,
        sub: b.latestActionDate ? new Date(b.latestActionDate).toLocaleDateString() : undefined,
      }));
    },
  });

  const visible = useMemo(() => {
    // Full-corpus bill search results take over the bill list while searching.
    if (billSearchActive) return billSearch.data ?? [];
    const items = pool[tab] || [];
    if (!search) return items;
    const q = search.toLowerCase();
    return items.filter(
      (it) => it.title.toLowerCase().includes(q) || (it.body && it.body.toLowerCase().includes(q)),
    );
  }, [pool, tab, search, billSearchActive, billSearch.data]);

  const listLoading = loading || (billSearchActive && billSearch.isLoading);

  const isOn = (id: string) => selected.some((c) => c.id === id);

  // Smart routing: derive the initial scope for a newly-selected item.
  // `matches` is hoisted out of `item` so TS can narrow the array variable
  // through the filter callback (the optional-chain check on a property
  // doesn't carry into the closure under noUncheckedIndexedAccess).
  const deriveScope = (item: ContextPoolItem): 'all' | string => {
    const matches = item.matches;
    if (!matches?.length || recipients.length === 0) return 'all';
    const matched = recipients.filter((r) => {
      const key = recipientKey(r);
      return (
        matches.includes(key) ||
        (r.id && matches.includes(r.id)) ||
        (r.clientId && matches.includes(r.clientId)) ||
        (r.directoryContactId && matches.includes(r.directoryContactId))
      );
    });
    const sole = matched[0];
    if (matched.length === 1 && sole) return recipientKey(sole);
    return 'all';
  };

  const matchHint = (item: ContextPoolItem): string | null => {
    const matches = item.matches;
    if (!matches?.length || recipients.length === 0) return null;
    const matched = recipients.filter((r) => {
      const key = recipientKey(r);
      return (
        matches.includes(key) ||
        (r.id && matches.includes(r.id)) ||
        (r.clientId && matches.includes(r.clientId)) ||
        (r.directoryContactId && matches.includes(r.directoryContactId))
      );
    });
    if (matched.length === 0) return null;
    const sole = matched[0];
    if (matched.length === 1 && sole) return sole.name || sole.email || 'matched recipient';
    return `${matched.length} recipients`;
  };

  // Latest `selected` for async callbacks (document text extraction resolves
  // after the user may have toggled other items).
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  // Client documents have no body until selected; pull the extracted text on
  // demand (txt/docx supported server-side).
  const extractDoc = async (attachmentId: string, itemId: string) => {
    let body: string;
    try {
      const res = await api.post<{ text?: string }>(
        `/api/engagement/attachments/${attachmentId}/extract-text`,
      );
      const text = (res.data?.text ?? '').trim();
      body = text ? text.slice(0, 8000) : '(no extractable text in this document)';
    } catch {
      body = '(could not extract text — only .txt and .docx documents are supported)';
    }
    onChange(selectedRef.current.map((c) => (c.id === itemId ? { ...c, body } : c)));
  };

  const toggle = (item: ContextPoolItem) => {
    if (isOn(item.id)) {
      onChange(selected.filter((c) => c.id !== item.id));
      return;
    }
    const needsExtract = item.kind === 'document' && item.id.startsWith('doc-') && !item.body;
    onChange([
      ...selected,
      {
        ...item,
        scope: deriveScope(item),
        note: '',
        body: needsExtract ? 'Extracting document text…' : item.body,
      },
    ]);
    if (needsExtract) void extractDoc(item.id.slice('doc-'.length), item.id);
  };

  const setNote = (id: string, note: string) =>
    onChange(selected.map((c) => (c.id === id ? { ...c, note } : c)));

  const setScope = (id: string, scope: 'all' | string) =>
    onChange(selected.map((c) => (c.id === id ? { ...c, scope } : c)));

  const remove = (id: string) => onChange(selected.filter((c) => c.id !== id));

  const addNoteForScope = (scope: 'all' | string) => {
    const id = `ctx-note-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    onChange([
      ...selected,
      {
        id,
        kind: 'note',
        title: scope === 'all' ? 'Shared note' : 'Personalized note',
        body: '',
        note: '',
        scope,
      },
    ]);
  };

  const sharedItems = selected.filter((c) => c.scope === 'all');
  const perRecipient = recipients.map((r) => ({
    recipient: r,
    key: recipientKey(r),
    items: selected.filter((c) => c.scope === recipientKey(r)),
  }));

  const totals = {
    items: selected.length,
  };

  return (
    <div>
      <h2>Build the context Clio uses</h2>
      <div className="ov2-pane-sub">
        Shared items will be used as context for all recipients. You can also add personalized
        context and notes for individual recipients.
      </div>

      <div className="ov2-ctx-builder">
        {/* ---------- LEFT: pool browser ---------- */}
        <div className="ov2-ctx-left">
          <div className="ov2-ctx-tabs">
            {TABS.map((t) => (
              <div
                key={t.id}
                className={'ov2-ctx-tab' + (tab === t.id ? ' active' : '')}
                onClick={() => setTab(t.id)}
              >
                <t.Icon style={{ fontSize: 12 }} />
                {t.label}
                {(pool[t.id]?.length || 0) > 0 && <span className="badge">{pool[t.id].length}</span>}
              </div>
            ))}
          </div>

          {tab !== 'note' && (
            <>
              <div className="ov2-ctx-search">
                <SearchOutlined style={{ fontSize: 13, color: 'var(--ov2-ink-3)' }} />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={
                    tab === 'bill'
                      ? 'Search all bills by title or sponsor…'
                      : `Search ${tab}…`
                  }
                />
              </div>
              {tab === 'bill' && (
                <div
                  style={{
                    padding: '4px 12px 6px',
                    fontSize: 11,
                    color: 'var(--ov2-ink-3)',
                  }}
                >
                  {billSearchActive
                    ? 'Searching every tracked bill in Congress.'
                    : 'Showing this client’s bills. Type to search the full bill database.'}
                </div>
              )}
              <div className="ov2-ctx-list">
                {listLoading && (
                  <div style={{ padding: 30, textAlign: 'center', color: 'var(--ov2-ink-3)', fontSize: 12.5 }}>
                    Loading…
                  </div>
                )}
                {!listLoading && visible.length === 0 && (
                  <div style={{ padding: 30, textAlign: 'center', color: 'var(--ov2-ink-3)', fontSize: 12.5, fontStyle: 'italic' }}>
                    {billSearchActive ? 'No bills match your search.' : 'No matches.'}
                  </div>
                )}
                {visible.map((it) => {
                  const hint = matchHint(it);
                  return (
                    <div
                      key={it.id}
                      className={'ov2-ctx-item' + (isOn(it.id) ? ' selected' : '')}
                      onClick={() => toggle(it)}
                    >
                      <span className="ov2-ctx-cb">
                        {isOn(it.id) && (
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                            <path d="m5 12 5 5L20 7" />
                          </svg>
                        )}
                      </span>
                      <div>
                        <div className="title">
                          {it.title}
                          {hint && <span className="ov2-ctx-match-hint">→ {hint}</span>}
                        </div>
                        <div className="sub">
                          {it.tag && <span className="tag">{it.tag}</span>}
                          {it.sub && <span>{it.sub}</span>}
                        </div>
                        {it.body && <div className="body">{it.body}</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {tab === 'note' && (
            <div style={{ padding: 24, textAlign: 'center' }}>
              <p style={{ fontSize: 13, color: 'var(--ov2-ink-2)', lineHeight: 1.6, margin: '8px 0 18px' }}>
                Add a free-form note Clio should treat as context. Notes can be shared across all recipients,
                or scoped to a single recipient, you choose after adding.
              </p>
              <button
                className="ov2-ctx-add-note-btn"
                onClick={() => addNoteForScope('all')}
                style={{ width: 'auto', padding: '8px 18px' }}
              >
                <PlusOutlined /> Add shared note
              </button>
            </div>
          )}
        </div>

        {/* ---------- RIGHT: context plan ---------- */}
        <div className="ov2-ctx-right">
          <div className="ov2-ctx-right-head">
            <span className="clio">
              <RobotOutlined style={{ fontSize: 12 }} />
            </span>
            <span className="title">Context plan</span>
            <span className="count">{selected.length} items</span>
          </div>

          <div className="ov2-ctx-stack">
            {recipients.length === 0 && (
              <div className="ov2-ctx-no-recipients">
                <b>Pick recipients first</b>
                Per-recipient routing needs a recipient list. Go back to step 3 to add one.
              </div>
            )}

            {/* Shared section */}
            <div className="ov2-ctx-section">
              <div className="ov2-ctx-section-head shared">
                <span className="sec-ico">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
                  </svg>
                </span>
                <span className="sec-name">Shared</span>
                <span style={{ fontWeight: 500, color: 'var(--ov2-ink-3)', textTransform: 'none', letterSpacing: 0 }}>
                  · every recipient sees this
                </span>
                <span className="sec-count">{sharedItems.length}</span>
              </div>
              {sharedItems.length === 0 && (
                <div className="ov2-ctx-empty-row">No shared context yet</div>
              )}
              {sharedItems.map((c) => (
                <ContextCard
                  key={c.id}
                  c={c}
                  recipients={recipients}
                  onNote={setNote}
                  onScope={setScope}
                  onRemove={remove}
                />
              ))}
              <button className="ov2-ctx-add-note-btn" onClick={() => addNoteForScope('all')}>
                + Add shared note
              </button>
            </div>

            {/* Per-recipient sections */}
            {perRecipient.map(({ recipient, key, items }) => (
              <div key={key} className="ov2-ctx-section">
                <div className="ov2-ctx-section-head recipient">
                  <span className="sec-ico">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <circle cx="12" cy="8" r="3.5" />
                      <path d="M5 20c.5-3.4 3.2-5.5 7-5.5s6.5 2.1 7 5.5" />
                    </svg>
                  </span>
                  <span className="sec-name">For {recipient.name || recipient.email}</span>
                  <span className="sec-count">{items.length}</span>
                </div>
                {items.length === 0 && (
                  <div className="ov2-ctx-empty-row">No recipient-specific context, uses shared only.</div>
                )}
                {items.map((c) => (
                  <ContextCard
                    key={c.id}
                    c={c}
                    recipients={recipients}
                    onNote={setNote}
                    onScope={setScope}
                    onRemove={remove}
                  />
                ))}
                <button className="ov2-ctx-add-note-btn" onClick={() => addNoteForScope(key)}>
                  + Add note for {(recipient.name || recipient.email || 'recipient').split(' ').slice(0, 2).join(' ')}
                </button>
              </div>
            ))}
          </div>

          <div className="ov2-ctx-stack-foot">
            <div className="stats">
              <span>
                <b>{totals.items}</b> items
              </span>
              <span>·</span>
              <span>
                <b>{sharedItems.length}</b> shared
              </span>
              <span>
                <b>{selected.length - sharedItems.length}</b> per-recipient
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------- Single card ----------------

interface CardProps {
  c: SelectedContextItem;
  recipients: OutreachRecipient[];
  onNote: (id: string, note: string) => void;
  onScope: (id: string, scope: 'all' | string) => void;
  onRemove: (id: string) => void;
}

function ContextCard({ c, recipients, onNote, onScope, onRemove }: CardProps) {
  return (
    <div className="ov2-ctx-card">
      <div className="ov2-ctx-card-head">
        <span className="ov2-ctx-card-kind" data-kind={c.kind}>
          {KIND_LABEL[c.kind]}
        </span>
        <span className="ov2-ctx-card-title">{c.title}</span>
        <button
          className="ov2-ctx-card-remove"
          onClick={() => onRemove(c.id)}
          title="Remove"
          aria-label="Remove context item"
        >
          <CloseOutlined style={{ fontSize: 12 }} />
        </button>
      </div>
      {c.body && <div className="ov2-ctx-card-body">{c.body}</div>}
      <textarea
        className="ov2-ctx-card-note"
        value={c.note}
        onChange={(e) => onNote(c.id, e.target.value)}
        placeholder={
          c.kind === 'note'
            ? 'Write your note here…'
            : "+ Add a personalized instruction (optional), e.g. 'lead with this', 'omit the deadline language'…"
        }
      />
      <div className="ov2-ctx-scope-row">
        <span className="label">Applies to</span>
        <select
          className="ov2-ctx-scope-select"
          value={c.scope}
          onChange={(e) => onScope(c.id, e.target.value)}
        >
          <option value="all">🌐 All recipients (shared)</option>
          {recipients.map((r) => {
            const key = recipientKey(r);
            return (
              <option key={key} value={key}>
                👤 {r.name || r.email || key}
              </option>
            );
          })}
        </select>
      </div>
    </div>
  );
}
