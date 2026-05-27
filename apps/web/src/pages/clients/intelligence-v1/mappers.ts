import type { ClientIntelProfile } from '../../intelligence/types.js';

// ── Re-export intelligence types used by section components ──────────
export type {
  ClientIntelProfile,
  HealthScore,
  TrackedBillsResult,
  TrackedBill,
  IntelligenceChange,
  CommentAlert,
  FederalRegisterDoc,
  ExStaffersResult,
  ExStafferEntry,
  KnowledgeGraphData,
  GraphNode,
  GraphEdge,
} from '../../intelligence/types.js';

// ── Section identifiers and metadata ────────────────────────────────
export type SectionId =
  | 'snapshot'
  | 'financial-footprint'
  | 'legislative-regulatory'
  | 'relationships';

export interface SectionMeta {
  id: SectionId;
  num: number;
  title: string;
  shortTitle: string;
}

export interface SectionNavMeta {
  syncedAt: string | null;
  sourceCount: number;
}

export const SECTION_ORDER: SectionMeta[] = [
  { id: 'snapshot', num: 1, title: 'Snapshot', shortTitle: 'Snapshot' },
  {
    id: 'financial-footprint',
    num: 2,
    title: 'Financial Footprint',
    shortTitle: 'Financial',
  },
  {
    id: 'legislative-regulatory',
    num: 3,
    title: 'Legislative & Regulatory',
    shortTitle: 'Legislative',
  },
  { id: 'relationships', num: 4, title: 'Relationships', shortTitle: 'Relationships' },
];

export function buildSectionNavMeta(profile: ClientIntelProfile | null | undefined): SectionNavMeta {
  const sourceCount = [profile?.lda?.matched, profile?.contracting?.matched, profile?.lobbyIntel?.matched].filter(
    Boolean,
  ).length;

  return {
    syncedAt: profile?.lastUpdated ?? null,
    sourceCount,
  };
}

export function minutesAgoLabel(isoDate: string | null | undefined): string {
  if (!isoDate) return 'Synced recently';
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return 'Synced recently';

  const mins = Math.max(1, Math.round((Date.now() - d.getTime()) / (1000 * 60)));
  if (mins < 60) return `Synced ${mins} min ago`;

  const hours = Math.round(mins / 60);
  if (hours < 24) return `Synced ${hours}h ago`;

  const days = Math.round(hours / 24);
  return `Synced ${days}d ago`;
}

// ── Shared data utilities ────────────────────────────────────────────

/** Compact dollar formatter — no external dep */
export function formatCompact(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value === 0) return '$0';
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${Math.round(value / 1_000)}K`;
  return `$${Math.round(value)}`;
}

/** Short human date — "May 26, 2026" */
export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(d);
}

/** Days until a deadline ISO date string (negative = past) */
export function daysUntil(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

/** Derive kanban stage from a bill's latest action text */
export type BillStage = 'introduced' | 'committee' | 'passed' | 'enacted';

export function billStage(latestActionText: string | null | undefined): BillStage {
  const txt = (latestActionText ?? '').toLowerCase();
  if (/signed|enacted|public law|pl \d/.test(txt)) return 'enacted';
  if (/passed|agreed to/.test(txt)) return 'passed';
  if (/committee|referred|reported|markup/.test(txt)) return 'committee';
  return 'introduced';
}
