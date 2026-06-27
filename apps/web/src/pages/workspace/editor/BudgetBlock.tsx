/**
 * Budget block (ported from the prototype `BudgetBlock`, asset_14). Renders the
 * auto-populated budget identifiers (Account / PE / BA / R-1 / UPL), the funding
 * history pills, and the human-set ask (Amount / PB / Delta) which writes
 * `cfg.ask`.
 *
 * Data source (binding decision): the structured R-1/UPL validation pipeline is
 * not wired yet, so identifiers are read from optional `cfg.budget` fields when
 * present and otherwise fall back to em-dashes. The "validated / Re-sync"
 * affordance is shown; Re-sync is a no-op stub.
 * TODO(phase): live R-1/UPL fetch + per-field validation; until then identifiers
 * are display-only and the validation count is illustrative.
 */
import type { WsAsk, WsConfig } from '../types.js';
import { Icon } from '../kit.js';

export interface BudgetIdentifiers {
  account?: string;
  pe?: string;
  ba?: string;
  r1?: string;
  upl?: string;
}

interface FundRow {
  y: string;
  v: string;
}

export function BudgetBlock({
  ask,
  budget,
  onAsk,
  onToast,
}: {
  ask: WsAsk;
  budget?: BudgetIdentifiers;
  onAsk: (key: keyof WsAsk, value: string) => void;
  onToast: (msg: string) => void;
}) {
  const b = budget ?? {};
  const ids: Array<[string, string]> = [
    ['Account', b.account || '—'],
    ['Program element (PE)', b.pe || '—'],
    ['Budget activity', b.ba || '—'],
    ['R-1 line item', b.r1 || '—'],
    ['UPL / UFR listing', b.upl || '—'],
  ];

  // Funding history: PB and request derive from the human-set ask; prior-year
  // enacted lines are illustrative until live execution data is wired.
  const fund: FundRow[] = [
    { y: 'FY25 enacted', v: '$6.0M' },
    { y: 'FY26 enacted', v: '$8.0M' },
    { y: 'FY27 PB', v: ask.pb || '$8.0M' },
    { y: 'Request', v: ask.amount || '$18.0M' },
  ];

  return (
    <div className="card" style={{ padding: 13, boxShadow: 'none', marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 11 }}>
        <Icon name="Sparkles" size={13} style={{ color: 'var(--accent)' }} />
        <span style={{ fontSize: 11.5, color: 'var(--ink-2)' }}>
          Auto-populated from <b>FY27 R-1</b> &amp; <b>Navy UPL</b>, 5 of 6 validated
        </span>
        <a
          onClick={() => onToast('Re-sync: live R-1 / UPL validation arrives in a later phase')}
          style={{
            marginLeft: 'auto',
            fontSize: 11,
            color: 'var(--accent)',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Re-sync
        </a>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 20px' }}>
        {ids.map((r, i) => (
          <div
            key={r[0]}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 12,
              padding: '6px 0',
              borderTop: i > 1 ? '1px solid var(--border-1)' : 'none',
            }}
          >
            <span style={{ color: 'var(--ink-3)', flex: 1 }}>{r[0]}</span>
            <span className="num" style={{ fontWeight: 600 }}>
              {r[1]}
            </span>
            <span className="dot success" />
          </div>
        ))}
      </div>
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 11 }}
      >
        {fund.map((f, i) => (
          <span
            key={f.y}
            className="num"
            style={{
              fontSize: 11,
              padding: '3px 8px',
              borderRadius: 6,
              border: '1px solid var(--border-1)',
              background: i === 3 ? 'var(--accent-soft)' : 'var(--bg-surface-2)',
              color: i === 3 ? 'var(--accent-ink)' : 'var(--ink-2)',
              fontWeight: i === 3 ? 600 : 400,
            }}
          >
            {f.y} {f.v}
          </span>
        ))}
      </div>

      {/* Human-set ask — primary entry point. Writes cfg.ask. */}
      <div style={{ marginTop: 13, paddingTop: 12, borderTop: '1px solid var(--border-1)' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 11.5,
            fontWeight: 600,
            color: 'var(--ink-2)',
            marginBottom: 10,
          }}
        >
          <Icon name="Lock" size={12} style={{ color: 'var(--ink-4)' }} />
          The ask
          <span style={{ fontWeight: 400, color: 'var(--ink-3)' }}>
            — set by you, lobbyist sign-off required
          </span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
          {(
            [
              ['Amount', 'amount'],
              ['PB', 'pb'],
              ['Delta', 'delta'],
            ] as Array<[string, keyof WsAsk]>
          ).map(([label, key]) => (
            <div key={key}>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: 'var(--ink-3)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  marginBottom: 5,
                }}
              >
                {label}
              </div>
              <input
                value={ask[key] || ''}
                onChange={(e) => onAsk(key, e.target.value)}
                className="field num"
                style={{
                  width: '100%',
                  padding: '7px 10px',
                  fontSize: 13,
                  fontFamily: 'var(--font-mono)',
                  fontWeight: 700,
                  background: 'var(--bg-surface)',
                  boxSizing: 'border-box',
                }}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Resolve budget identifiers from the config (optional structured field). */
export function budgetFrom(cfg: WsConfig): BudgetIdentifiers {
  const raw = (cfg.budget as BudgetIdentifiers | undefined) ?? {};
  return {
    account: raw.account,
    pe: raw.pe,
    ba: raw.ba,
    r1: raw.r1,
    upl: raw.upl,
  };
}
