import React from 'react';
import { Tag } from 'antd';
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  ExperimentOutlined,
  RiseOutlined,
} from '@ant-design/icons';

/* ── Formatting helpers ────────────────────────────────────────────────── */

export function formatMoney(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n}`;
}

export function formatNum(n: number | null | undefined): string {
  if (n == null) return '—';
  return n.toLocaleString();
}

/* ── Issue palette ─────────────────────────────────────────────────────── */

export const ISSUE_PALETTE = [
  'blue', 'cyan', 'geekblue', 'purple', 'volcano', 'gold',
  'lime', 'orange', 'magenta', 'green', 'red', 'default',
];

export function issueTagColor(code: string): string {
  let h = 0;
  for (const ch of code) h = (h * 31 + ch.charCodeAt(0)) & 0xffff;
  return ISSUE_PALETTE[h % ISSUE_PALETTE.length] ?? 'default';
}

/* ── Tag builders ──────────────────────────────────────────────────────── */

export function trajectoryTag(t: string | null): React.ReactNode {
  if (!t) return null;
  const styles: Record<string, { color: string; icon: React.ReactNode }> = {
    exploding: { color: 'red', icon: <RiseOutlined /> },
    new: { color: 'cyan', icon: <ExperimentOutlined /> },
    steady: { color: 'blue', icon: null },
    declining: { color: 'orange', icon: <ArrowDownOutlined /> },
  };
  const s = styles[t] ?? { color: 'default', icon: null };
  return (
    <Tag color={s.color} style={{ textTransform: 'capitalize' }}>
      {s.icon} {t}
    </Tag>
  );
}

export function surgeBadge(trend: string | null, pct: number | null): React.ReactNode {
  if (!trend) return null;
  const colors: Record<string, string> = { surging: 'red', growing: 'gold', stable: 'blue', declining: 'orange' };
  const arrow = trend === 'declining' ? <ArrowDownOutlined /> : trend === 'stable' ? null : <ArrowUpOutlined />;
  return (
    <Tag color={colors[trend] ?? 'default'}>
      {arrow} {pct != null ? `${pct > 0 ? '+' : ''}${Math.round(pct)}%` : trend}
    </Tag>
  );
}

/* ── Category colors ───────────────────────────────────────────────────── */

export const CATEGORY_COLORS: Record<string, string> = {
  Defense: 'red', Health: 'green', Tech: 'blue', Energy: 'orange', Construction: 'purple', Other: 'default',
};

/* ── Bill subject / topic coloring (Phase 2 visual unification) ─────────── */

// Coarse mapping of CongressBill subject / FR topic English strings to the
// shared SectorTag taxonomy, so subject Tags pick up SECTOR_COLORS instead of
// rendering as default-grey. The match is keyword-overlap, lower-case.
const SUBJECT_SECTOR_RULES: Array<{ pattern: RegExp; tag: string }> = [
  { pattern: /defense|armed forces|military|national security|navy|army|air force|marines/i, tag: 'DEFENSE' },
  { pattern: /health|medicare|medicaid|drug|disease|hospital|nursing|pharma|biolog/i, tag: 'HEALTH' },
  { pattern: /energy|nuclear|petroleum|gas|electric|solar|wind|renewable|grid/i, tag: 'ENERGY' },
  { pattern: /transport|road|highway|rail|aviation|maritime|aircraft|automob|truck/i, tag: 'TRANSPORTATION' },
  { pattern: /agricult|farm|food production|crop|livestock|forestry|rural development/i, tag: 'AGRICULTURE' },
  { pattern: /homeland|immigration|border|cbp|tsa|fema|customs|terror|cyber/i, tag: 'HOMELAND_SECURITY' },
  { pattern: /environment|water|pollut|epa|conservation|climate|wildlife|epa/i, tag: 'ENVIRONMENT_WATER' },
  { pattern: /commerce|trade|technology|telecom|internet|broadband|small business|sba/i, tag: 'COMMERCE_TECH' },
  { pattern: /education|student|school|teacher|college|university/i, tag: 'EDUCATION' },
  { pattern: /finance|banking|securities|tax|treasury|housing finance|credit/i, tag: 'FINANCIAL_SERVICES' },
];

/** Map a bill subject / FR topic / policy area string to one of SECTOR_COLORS, or null. */
export function subjectSectorColor(subject: string): string | null {
  if (!subject) return null;
  // Hard-coded subject → AntD color map. Kept inline here (vs. importing
  // SECTOR_COLORS) so this file stays JSX-style and doesn't grow a runtime
  // dependency on @capiro/shared in this util.
  const colors: Record<string, string> = {
    DEFENSE: 'volcano',
    HEALTH: 'green',
    ENERGY: 'gold',
    TRANSPORTATION: 'blue',
    AGRICULTURE: 'lime',
    HOMELAND_SECURITY: 'orange',
    ENVIRONMENT_WATER: 'cyan',
    COMMERCE_TECH: 'geekblue',
    EDUCATION: 'purple',
    FINANCIAL_SERVICES: 'magenta',
  };
  for (const rule of SUBJECT_SECTOR_RULES) {
    if (rule.pattern.test(subject)) return colors[rule.tag] ?? null;
  }
  return null;
}

/** Distinct color reserved for "this is an intersection match" tags in Phase 2 cross-reference tabs. */
export const MATCHED_TOPIC_COLOR = 'magenta';

/* ── Position formatting ───────────────────────────────────────────────── */

export function formatPosition(pos: unknown): string {
  if (!pos || typeof pos !== 'object') return '';
  const p = pos as Record<string, unknown>;
  const title = typeof p.position_title === 'string' ? p.position_title : '';
  const offices = Array.isArray(p.offices) ? p.offices : [];
  const officeName =
    offices[0] && typeof offices[0] === 'object'
      ? ((offices[0] as Record<string, unknown>).name as string | undefined) ?? ''
      : '';
  const dates = typeof p.dates_covered === 'string' ? p.dates_covered : '';
  const abbrevMap: Record<string, string> = {
    'Legislative Assistant': 'LA',
    'Legislative Director': 'LD',
    'Chief of Staff': 'CoS',
    'Senior Advisor': 'Sr. Advisor',
    'Staff Director': 'Staff Dir.',
    'General Counsel': 'Gen. Counsel',
  };
  const titleAbbrev = abbrevMap[title] ?? title.split(' ').slice(0, 2).join(' ');
  return [titleAbbrev && `Fmr. ${titleAbbrev}`, officeName, dates && `(${dates})`]
    .filter(Boolean)
    .join(', ');
}
