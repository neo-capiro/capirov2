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

export interface ClientProfileV1 {
  client: { id: string; name: string };
  generatedAt: string;
  meta?: {
    schema?: string;
    sectionOrder?: string[];
    hasSnapshot?: boolean;
    hasFinancialFootprint?: boolean;
    hasLegislativeRegulatory?: boolean;
    hasRelationships?: boolean;
    /** ISO timestamp matching top-level generatedAt */
    generatedAt?: string;
    /** Count of distinct confirmed intel sources (lda, contracting, lobby_intel) */
    sourceCount?: number;
    /** Count of unconfirmed/pending mappings for this client */
    unresolvedMappings?: number;
  };
  links: {
    changesInbox: string;
    mappingsAdmin: string;
    competitorIssuePage: string;
    billDetailBase: string;
    entityResolutionQueue: string;
  };
  sections: {
    snapshot: {
      trajectory: {
        label: string | null;
        growthRate: number | null;
        totalSpending: number | null;
        yearlySpend: Array<{ year: number; amount: number }>;
        model?: {
          label?: string | null;
          confidence?: number | null;
          score?: number | null;
          source?: 'model' | 'fallback' | string;
        } | null;
        fallback?: {
          label?: string | null;
        } | null;
      };
      health: {
        score: number;
        trend: 'improving' | 'stable' | 'declining';
      };
      topAlerts: Array<{
        id?: string;
        type: string;
        severity: string;
        title: string;
        subtitle: string;
        when: string;
        countdownDays?: number | null;
        countdownLabel?: string | null;
        href?: string | null;
      }>;
      dailyBriefing?: {
        summary: string | null;
        highlights: Array<{
          label: string;
          value: string | number | null;
          tone: 'critical' | 'notable' | 'info' | 'neutral';
        }>;
        generatedAt: string;
        eventCount: number;
        ctaHref?: string;
      } | null;
      activity14d: Array<{ date: string; meetings: number; emails: number; tasks: number; debriefs: number }>;
      changes7dCount: number;
    };
    financialFootprint: {
      hero: {
        lobbyingTtm: number;
        obligationsTtm: number;
        returnRatio: number | null;
        gap: number;
        truthState?: 'normal' | 'zero_obligation' | 'no_activity';
      };
      series: {
        lobbying: Array<{ year: number; amount: number }>;
        obligations: Array<{ year: number; amount: number }>;
        quarterSeries: Array<{ label: string; lobbying: number; obligations: number }>;
      };
      fecMoneyFlow: {
        mappedEmployer: string | null;
        summary: {
          totalContributions: number;
          totalAmount: number;
          committeeCount: number;
          candidateCount: number;
          memberCount: number;
          billCount: number;
        };
        committees?: Array<{
          committeeId: string;
          committeeName: string;
          totalAmount: number;
          contributionCount: number;
          latestContributionDate: string | Date | null;
          candidates: Array<{
            candidateName: string;
            totalAmount: number;
            contributionCount: number;
            linkedMembers: Array<{ memberName: string; billCount: number }>;
          }>;
          bills: Array<{ billId: string; billTitle: string; sponsorName: string | null }>;
        }>;
      };
      districtNexus: {
        topDistricts: Array<{ district: string; jobs: number; capability: string; dataYear: number }>;
        capabilities?: Array<{
          capabilityId: string;
          capabilityName: string;
          capabilitySector: string | null;
          districtNexus: string | null;
          districts: Array<{ district: string; jobs: number; stateName: string; dataYear: number }>;
          talkingPoints: string[];
          totalSupportedJobs: number | null;
        }>;
      };
    };
    legislativeRegulatory: {
      kanban: {
        total: number;
        issueCodes: string[];
        columns: Array<{
          id: 'introduced' | 'committee' | 'passed' | 'enacted';
          label: string;
          count: number;
          bills: Array<{
            identifier: string;
            title: string;
            latestActionDate: string | Date | null;
            latestActionText: string | null;
            probability?: number | null;
          }>;
        }>;
      };
      regulatoryLifecycle: {
        totalLinkedBills?: number;
        totalRegulations?: number;
        rails: Array<{
          documentNumber: string;
          title: string;
          agencyNames: string[];
          linkedBills: string[];
          currentStage: string;
          deadline: string | Date | null;
          stages: Array<{ key: string; label: string }>;
        }>;
      };
      hearingsAndMarkups: Array<{
        id: string;
        committeeName: string;
        chamber: string;
        title: string;
        date: string | Date;
        time: string | null;
        type: string | null;
        linkedBills: string[];
        isTracked: boolean;
      }>;
    };
    relationships: {
      scopedGraph: {
        resolutionQuality: { avgConfidence: number; confirmedCount: number; unconfirmedCount: number };
        meta: { lobbyistCount: number; memberCount: number; committeeCount: number };
      };
      officeRecommender: Array<{ office: string; score: number; tags: string[]; billCount: number }>;
      exStafferCount: number;
    };
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
