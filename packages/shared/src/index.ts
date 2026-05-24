// Single-file consumer-facing module. Earlier this file re-exported from
// roles.ts + tenant.ts, but Rollup (used by Vite) can't always trace named
// exports through CommonJS-compiled `export { x } from './y'` statements.
// Inlining keeps both Vite and the NestJS CJS runtime happy without dual
// builds or compatibility plugins.

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

export const TENANT_ROLES = [
  'capiro_admin',
  'user_admin',
  'standard_user',
  'client_portal_user',
] as const;

export type TenantRole = (typeof TENANT_ROLES)[number];

export const ROLE_RANK: Record<TenantRole, number> = {
  client_portal_user: 0,
  standard_user: 1,
  user_admin: 2,
  capiro_admin: 3,
};

export function hasAtLeast(role: TenantRole, minimum: TenantRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

export function isCapiroAdmin(role: TenantRole): boolean {
  return role === 'capiro_admin';
}

/** Tenant-admin power: own tenant for `user_admin`, any tenant for `capiro_admin`. */
export function isTenantAdmin(role: TenantRole): boolean {
  return role === 'user_admin' || role === 'capiro_admin';
}

// ---------------------------------------------------------------------------
// Tenant context
// ---------------------------------------------------------------------------

export interface TenantContext {
  tenantId: string;
  tenantSlug: string;
  userId: string;
  clerkUserId: string;
  role: TenantRole;
}

// ---------------------------------------------------------------------------
// Controlled vocabularies — Portfolio v2
// Centralized to avoid drift between API validation, UI pickers, and rendering.
// ---------------------------------------------------------------------------

export const SECTOR_TAGS = [
  'DEFENSE',
  'HEALTH',
  'ENERGY',
  'TRANSPORTATION',
  'AGRICULTURE',
  'HOMELAND_SECURITY',
  'ENVIRONMENT_WATER',
  'COMMERCE_TECH',
  'EDUCATION',
  'FINANCIAL_SERVICES',
  'OTHER',
] as const;

export type SectorTag = (typeof SECTOR_TAGS)[number];

export const SECTOR_LABELS: Record<SectorTag, string> = {
  DEFENSE: 'Defense',
  HEALTH: 'Health & Pharma',
  ENERGY: 'Energy',
  TRANSPORTATION: 'Transportation',
  AGRICULTURE: 'Agriculture',
  HOMELAND_SECURITY: 'Homeland Security',
  ENVIRONMENT_WATER: 'Environment / Water',
  COMMERCE_TECH: 'Commerce / Tech',
  EDUCATION: 'Education',
  FINANCIAL_SERVICES: 'Financial Services',
  OTHER: 'Other',
};

export const SECTOR_COLORS: Record<SectorTag, string> = {
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
  OTHER: 'default',
};

/** Normalize free-form sector text to a controlled SectorTag, or null if no clean match. */
export function normalizeSector(raw: string | null | undefined): SectorTag | null {
  if (!raw) return null;
  const upper = raw.trim().toUpperCase().replace(/[\s\-\/&]+/g, '_');
  if ((SECTOR_TAGS as readonly string[]).includes(upper)) return upper as SectorTag;
  // Common free-text variants
  const aliases: Record<string, SectorTag> = {
    HEALTHCARE: 'HEALTH',
    HEALTH_CARE: 'HEALTH',
    PHARMA: 'HEALTH',
    PHARMACEUTICALS: 'HEALTH',
    DEFENSE_INDUSTRIAL_BASE: 'DEFENSE',
    DOD: 'DEFENSE',
    DHS: 'HOMELAND_SECURITY',
    HOMELAND: 'HOMELAND_SECURITY',
    ENVIRONMENT: 'ENVIRONMENT_WATER',
    WATER: 'ENVIRONMENT_WATER',
    EPA: 'ENVIRONMENT_WATER',
    DOE: 'ENERGY',
    DOT: 'TRANSPORTATION',
    USDA: 'AGRICULTURE',
    AG: 'AGRICULTURE',
    COMMERCE: 'COMMERCE_TECH',
    TECH: 'COMMERCE_TECH',
    TECHNOLOGY: 'COMMERCE_TECH',
    ED: 'EDUCATION',
    EDU: 'EDUCATION',
    FINANCE: 'FINANCIAL_SERVICES',
    FINANCIAL: 'FINANCIAL_SERVICES',
    TREASURY: 'FINANCIAL_SERVICES',
  };
  return aliases[upper] ?? null;
}

// ---------------------------------------------------------------------------
// Submission tracks (Portfolio v2 §2.5)
// ---------------------------------------------------------------------------

export const SUBMISSION_TRACKS = [
  'NDAA',
  'APPROPRIATIONS',
  'CDS',
  'AUTHORIZATION',
  'ADVOCACY',
] as const;

export type SubmissionTrack = (typeof SUBMISSION_TRACKS)[number];

export const SUBMISSION_TRACK_LABELS: Record<SubmissionTrack, string> = {
  NDAA: 'NDAA',
  APPROPRIATIONS: 'Appropriations',
  CDS: 'Congressionally Directed Spending',
  AUTHORIZATION: 'Authorization',
  ADVOCACY: 'Advocacy',
};

// ---------------------------------------------------------------------------
// Profile types / status (Portfolio v2 §2.1)
// ---------------------------------------------------------------------------

export const PROFILE_TYPES = ['CLIENT', 'PROGRAM'] as const;
export type ProfileType = (typeof PROFILE_TYPES)[number];

export const PROFILE_STATUSES = ['ACTIVE', 'PAUSED', 'MONITORING', 'ARCHIVED'] as const;
export type ProfileStatus = (typeof PROFILE_STATUSES)[number];

export const ACCOUNT_TYPES = ['LOBBYING_FIRM', 'INHOUSE_GA'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const PLAN_TIERS = ['FOUNDATION', 'GROWTH', 'ENTERPRISE'] as const;
export type PlanTier = (typeof PLAN_TIERS)[number];

// ---------------------------------------------------------------------------
// Submission-history outcome types
// Canonical set: drawer is the writer, render must follow.
// ---------------------------------------------------------------------------

export const OUTCOME_TYPES = ['in_progress', 'success', 'partial', 'failed'] as const;
export type OutcomeType = (typeof OUTCOME_TYPES)[number];

export const OUTCOME_LABELS: Record<OutcomeType, string> = {
  in_progress: 'In Progress',
  success: 'Success',
  partial: 'Partial',
  failed: 'Failed',
};

export const OUTCOME_COLORS: Record<OutcomeType, string> = {
  in_progress: 'blue',
  success: 'green',
  partial: 'gold',
  failed: 'red',
};

/**
 * Coerce legacy / freeform outcome values to the canonical set.
 * Historical data has 'won', 'lost' which we map back into the new vocabulary.
 */
export function normalizeOutcome(raw: string | null | undefined): OutcomeType {
  if (!raw) return 'in_progress';
  const lower = raw.trim().toLowerCase();
  if ((OUTCOME_TYPES as readonly string[]).includes(lower)) return lower as OutcomeType;
  const aliases: Record<string, OutcomeType> = {
    won: 'success',
    win: 'success',
    successful: 'success',
    lost: 'failed',
    loss: 'failed',
    fail: 'failed',
    partial_win: 'partial',
    mixed: 'partial',
    pending: 'in_progress',
    ongoing: 'in_progress',
  };
  return aliases[lower] ?? 'in_progress';
}

// ---------------------------------------------------------------------------
// Capability tag suggestions
// Free-add still permitted, but these prevent typo-divergence on common terms.
// ---------------------------------------------------------------------------

export const CAPABILITY_TAG_SUGGESTIONS = [
  // technical
  'autonomy',
  'ai',
  'machine learning',
  'cybersecurity',
  'quantum',
  'space',
  'unmanned',
  'maritime',
  'aviation',
  'biotech',
  'genomics',
  'medical devices',
  'pharmaceutical',
  'vaccines',
  'energy storage',
  'nuclear',
  'renewable',
  'grid',
  'semiconductor',
  'microelectronics',
  'manufacturing',
  'logistics',
  'supply chain',
  // mission / domain
  'small business',
  'rural',
  'workforce',
  'workforce development',
  'research',
  'r&d',
  'commercialization',
  'sbir',
  'sttr',
  'dual-use',
  'critical infrastructure',
  'climate',
  'water',
  'transportation',
  'broadband',
  // policy
  'export control',
  'foreign investment',
  'procurement reform',
  'acquisition',
];

export const TENANT_HEADER = 'x-capiro-tenant';
