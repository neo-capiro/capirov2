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
