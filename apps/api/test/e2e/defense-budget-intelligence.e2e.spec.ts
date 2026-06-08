/**
 * Step 4.2 — Defense Budget Intelligence END-TO-END ACCEPTANCE TEST (§27 scenario).
 *
 * Proves the plan's headline claim — "source → action card → artifact without reading
 * the budget book" — by driving the FULL pipeline programmatically for ONE fictional
 * Program Element and asserting EACH built §27 step explicitly (one labelled assertion
 * block per §27 row).
 *
 * ── HARNESS (documented choice) ───────────────────────────────────────────────────
 * This env has no seeded test DB and the repo has no real-DB e2e harness (jest.config
 * testMatch was src/scripts only; there is no `test/` integration suite). So this is a
 * SHARED-MOCK-STORE INTEGRATION test: one in-memory Prisma double (`makeStore`) backs
 * EVERY real service in the chain, so the test proves the pieces COMPOSE — a row written
 * by one step (e.g. the accepted PeProgramMatch from ProgramsService.resolveMatch) is the
 * same row the next step reads (the ActionRecommendation generator's graph load). The
 * REAL services + REAL pure modules run unmodified:
 *   - upsertSourceDocument            (Step 0.1, pure registry)
 *   - checkBudgetReconciliation       (Step 0.2, pure)
 *   - deltasFromYear + scoreMateriality (Step 1.4, pure delta + materiality)
 *   - PeProgramMatcherService.matchPe (Step 2.1, pure matcher)
 *   - ProgramsService.resolveMatch    (Step 2.1, REAL service — candidate→accepted)
 *   - combineRelevance + path scorers (Step 2.3, pure relevance)
 *   - AcquisitionPersonnelReadService (Step 2.2, REAL service — contact-use guardrail)
 *   - ActionRecommendationService.generate (Step 3.2, REAL generator)
 *   - compareProofPackSources         (Step 1.2, pure proof-pack ordering)
 *   - CoverageGapService.createOutreachFromGap (Step 3.4, REAL service)
 *   - ActionRecommendationReadService.updateStatus/updateOwner (Step 3.2/§19, REAL)
 *
 * ── SKIPPED (data/infra/LLM-blocked — asserted as pending, NEVER faked) ────────────
 *   - §27 step 12 (artifact generation, Step 3.3): runtime-LLM blocked → `it.todo`.
 *   - SAM (3.1), PDF-extraction (0.3/1.1/1.5/2.4-extraction): data/infra blocked; the
 *     synthetic source stands in for an extracted artifact (extraction itself is not run).
 * See docs/plans/2026-06-07-defense-budget-intelligence-launch-readiness.md for the full
 * blocked-item ledger and unblocks.
 *
 * Money convention: $ MILLIONS throughout (project-wide).
 */

import type { TenantContext } from '@capiro/shared';

// Step 0.1 — source-document registry (pure)
import {
  sha256OfBuffer,
  upsertSourceDocument,
  type SourceDocumentRow,
} from '../../src/program-element/source-document/source-document-registry.js';
// Step 0.2 — reconciliation (pure)
import {
  checkBudgetReconciliation,
  type ControlTotals,
} from '../../src/program-element/reconciliation/budget-reconciliation.js';
// Step 1.4 — delta derivation + materiality (pure)
import { deltasFromYear } from '../../src/program-element/deltas/delta-compute.js';
import {
  scoreMateriality,
  MATERIALITY_THRESHOLDS,
} from '../../src/program-element/deltas/materiality-scorer.js';
// Step 2.1 — matcher (pure) + thresholds
import { PeProgramMatcherService } from '../../src/program-element/matching/pe-program-matcher.service.js';
// Step 2.1 — REAL programs service (candidate → accepted resolve path)
import { ProgramsService } from '../../src/program-element/programs/programs.service.js';
// Step 2.3 — client relevance (pure scorers + combine)
import {
  scoreCapabilityKeyword,
  scoreFacilityDistrict,
  combineRelevance,
} from '../../src/intelligence/client-pe-relevance.scoring.js';
// Step 2.2 — REAL personnel read service + contact-use policy
import { AcquisitionPersonnelReadService } from '../../src/acquisition-personnel/acquisition-personnel-read.service.js';
import { isExcludedFromRecommendations } from '../../src/acquisition-personnel/contact-use.policy.js';
// Step 3.2 — REAL generator + REAL read/write (status transitions)
import { ActionRecommendationService } from '../../src/intelligence/actions/action-recommendation.service.js';
import { ActionRecommendationReadService } from '../../src/intelligence/actions/action-recommendation-read.service.js';
// Step 1.2 — proof-pack ordering (pure)
import { compareProofPackSources } from '../../src/program-element/proof-pack.js';
// Step 3.4 — REAL coverage-gap service (schedule_outreach card)
import { CoverageGapService } from '../../src/intelligence/coverage/coverage-gap.service.js';

// ── Scenario constants ─────────────────────────────────────────────────────────────
// A fictional ARMY PE (8th char 'A' → ARMY component, which the reconciliation +
// matcher both derive from the code). Synthetic title that the program alias matches.
const PE = '0699999A';
const PE_TITLE = 'Synthetic Hypersonic Glide Vehicle';
const FY = 2027;
const TENANT = '00000000-0000-0000-0000-0000000000a1';
const USER = '00000000-0000-0000-0000-0000000000c3';
const CLIENT = '11111111-1111-1111-1111-111111111111';
const PROGRAM_ID = 'prog-shgv';
const OFFICE_ID = 'office-peo-missiles';
const PERSON_PM = 'person-pm';
const PERSON_CO = 'person-co'; // a contracting officer — must be a procurement POC, never a target

const ctx: TenantContext = {
  tenantId: TENANT,
  tenantSlug: 'capiro',
  userId: USER,
  clerkUserId: 'user_test',
  role: 'capiro_admin',
};

// ── The shared in-memory store (ONE store, every service reads/writes it) ───────────
interface Row {
  [k: string]: unknown;
}

/**
 * Build a single in-memory Prisma double covering every delegate the chained services
 * touch. Tenant-scoped tables are filtered by the active `scopedTenant` inside
 * withTenant; global graph tables are unfiltered. Returns the store handle + the prisma
 * proxy so assertions can inspect rows directly.
 */
function makeStore() {
  const store = {
    sourceDocuments: [] as SourceDocumentRow[],
    programElementYears: [] as Row[],
    programElements: [] as Row[],
    programElementSources: [] as Row[], // proof-pack rows (page provenance)
    programs: [] as Row[],
    programAliases: [] as Row[],
    peProgramMatches: [] as Row[],
    offices: [] as Row[],
    officeLinks: [] as Row[],
    personnel: [] as Row[],
    personRoles: [] as Row[],
    engagementContacts: [] as Row[],
    meetingAttendees: [] as Row[],
    outreachRecords: [] as Row[],
    mailThreads: [] as Row[],
    actions: [] as Row[],
    clients: [] as Row[],
    auditLogs: [] as Row[],
  };

  let scopedTenant: string | null = null;
  let sdSeq = 0;
  let matchSeq = 0;
  let roleSeq = 0;
  let actionSeq = 0;

  const inIncludes = (val: unknown, set: { in?: unknown[] } | undefined): boolean =>
    !set || !Array.isArray(set.in) ? true : set.in.includes(val);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prisma: Record<string, any> = {
    __store: store,

    // Tenant scope: every engagement/action/client/audit read is filtered to scopedTenant.
    withTenant: async <T>(tenantId: string, fn: (tx: unknown) => Promise<T>): Promise<T> => {
      const prev = scopedTenant;
      scopedTenant = tenantId;
      try {
        return await fn(prisma);
      } finally {
        scopedTenant = prev;
      }
    },
    $transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(prisma),

    // ── Step 0.1: SourceDocument ──
    sourceDocument: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        return (
          store.sourceDocuments.find((d) => {
            if (where.sourceKey !== undefined && d.sourceKey !== where.sourceKey) return false;
            if (where.sha256 !== undefined && d.sha256 !== where.sha256) return false;
            if (where.supersededByDocumentId !== undefined && d.supersededByDocumentId !== where.supersededByDocumentId)
              return false;
            return true;
          }) ?? null
        );
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        sdSeq += 1;
        const row = { id: `src-${sdSeq}`, supersededByDocumentId: null, ingestedAt: new Date(), ...data } as unknown as SourceDocumentRow;
        store.sourceDocuments.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = store.sourceDocuments.find((d) => d.id === where.id)!;
        Object.assign(row, data);
        return row;
      },
    },

    // ── Step 0.2 / 1.4: ProgramElementYear ──
    programElementYear: {
      findMany: async () => store.programElementYears,
    },

    // ── Step 1.4 / 3.2: ProgramElement ──
    programElement: {
      findUnique: async ({ where }: { where: { peCode: string } }) =>
        store.programElements.find((p) => p.peCode === where.peCode) ?? null,
    },

    // ── Step 1.2 / 3.2: ProgramElementSource (proof-pack page rows) ──
    programElementSource: {
      findMany: async ({ where }: { where?: { peCode?: string } }) =>
        store.programElementSources.filter((s) => !where?.peCode || s.peCode === where.peCode),
      findFirst: async () => store.programElementSources[0] ?? null,
    },

    // ── Step 2.1: Program graph ──
    program: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        store.programs.find((p) => p.id === where.id) ?? null,
    },
    programAlias: {
      findMany: async ({ where }: { where: { programId: string } }) =>
        store.programAliases.filter((a) => a.programId === where.programId),
    },
    peProgramMatch: {
      findMany: async ({ where }: { where: Row }) => {
        const w = (where ?? {}) as {
          peCode?: string;
          programId?: string;
          status?: string | { in?: string[] };
        };
        return store.peProgramMatches.filter((m) => {
          if (w.peCode !== undefined && m.peCode !== w.peCode) return false;
          if (w.programId !== undefined && m.programId !== w.programId) return false;
          if (typeof w.status === 'string' && m.status !== w.status) return false;
          if (w.status && typeof w.status === 'object' && Array.isArray(w.status.in) && !w.status.in.includes(m.status as string))
            return false;
          return true;
        });
      },
      findUnique: async ({ where }: { where: { id: string } }) =>
        store.peProgramMatches.find((m) => m.id === where.id) ?? null,
      create: async ({ data }: { data: Row }) => {
        matchSeq += 1;
        const row = { id: `match-${matchSeq}`, createdAt: new Date(), ...data };
        store.peProgramMatches.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Row }) => {
        const row = store.peProgramMatches.find((m) => m.id === where.id)!;
        Object.assign(row, data);
        return row;
      },
    },

    // ── Step 2.2: offices / links / personnel / roles ──
    programOffice: {
      findFirst: async ({ where }: { where: Row }) => {
        const w = where as { name?: string | { equals?: string } };
        if (typeof w.name === 'string') return store.offices.find((o) => o.name === w.name) ?? null;
        if (w.name && typeof w.name === 'object' && w.name.equals) {
          const t = w.name.equals.toLowerCase();
          return store.offices.find((o) => String(o.name).toLowerCase() === t) ?? null;
        }
        return null;
      },
    },
    programOfficeProgramLink: {
      findMany: async ({ where }: { where: Row }) => {
        const w = where as { officeId?: { in?: string[] }; programId?: { in?: string[] }; reviewStatus?: string };
        return store.officeLinks
          .filter(
            (l) =>
              inIncludes(l.officeId, w.officeId) &&
              inIncludes(l.programId, w.programId) &&
              (w.reviewStatus === undefined || l.reviewStatus === w.reviewStatus),
          )
          .map((l) => ({ ...l, office: store.offices.find((o) => o.id === l.officeId) ?? null }));
      },
    },
    acquisitionPersonnel: {
      findMany: async ({ where }: { where: Row }) => {
        const w = where as {
          supersededAt?: null;
          OR?: Array<{ pePrimary?: string; peSecondary?: { has?: string } }>;
        };
        return store.personnel.filter((p) => {
          if (w.supersededAt === null && p.supersededAt) return false;
          if (w.OR) {
            return w.OR.some((cond) => {
              if (cond.pePrimary !== undefined) return p.pePrimary === cond.pePrimary;
              if (cond.peSecondary?.has !== undefined)
                return Array.isArray(p.peSecondary) && (p.peSecondary as string[]).includes(cond.peSecondary.has);
              return false;
            });
          }
          return true;
        });
      },
    },
    personRole: {
      findMany: async ({ where, include }: { where: Row; include?: Row }) => {
        const w = where as {
          personId?: { in?: string[] };
          officeId?: { in?: string[] };
          reviewStatus?: string | { not?: string };
          staleAt?: null;
        };
        const rows = store.personRoles.filter((r) => {
          if (w.personId && !inIncludes(r.personId, w.personId)) return false;
          if (w.officeId && !inIncludes(r.officeId, w.officeId)) return false;
          if (typeof w.reviewStatus === 'string' && r.reviewStatus !== w.reviewStatus) return false;
          if (w.reviewStatus && typeof w.reviewStatus === 'object' && w.reviewStatus.not !== undefined && r.reviewStatus === w.reviewStatus.not)
            return false;
          if (w.staleAt === null && r.staleAt) return false;
          return true;
        });
        if (!include) {
          // Generator's loadEligiblePersonRoles select shape: person.fullName.
          return rows.map((r) => ({ ...r, person: { fullName: store.personnel.find((p) => p.id === r.personId)?.fullName } }));
        }
        return rows.map((r) => {
          const out: Row = { ...r };
          if ((include as Row).office) {
            const office = store.offices.find((o) => o.id === r.officeId);
            out.office = office ? { name: office.name } : null;
          }
          if ((include as Row).program) {
            const program = store.programs.find((pg) => pg.id === r.programId);
            out.program = program ? { canonicalName: program.canonicalName } : null;
          }
          out.person = { fullName: store.personnel.find((p) => p.id === r.personId)?.fullName };
          return out;
        });
      },
    },

    // ── Step 3.4: engagement tables (tenant-scoped) ──
    engagementContact: {
      findMany: async ({ where }: { where: { acquisitionPersonnelId: { in: string[] } } }) =>
        store.engagementContacts.filter(
          (c) => c.tenantId === scopedTenant && where.acquisitionPersonnelId.in.includes(c.acquisitionPersonnelId as string),
        ),
    },
    meetingAttendee: {
      findMany: async ({ where }: { where: { contactId: { in: string[] } } }) =>
        store.meetingAttendees
          .filter((a) => a.tenantId === scopedTenant && where.contactId.in.includes(a.contactId as string))
          .map((a) => ({ contactId: a.contactId, meeting: { id: a.meetingId, startsAt: a.startsAt, createdByUserId: a.createdByUserId } })),
    },
    outreachRecord: {
      findMany: async ({ where }: { where: { meetingId: { in: string[] } } }) =>
        store.outreachRecords.filter(
          (o) => o.tenantId === scopedTenant && o.deletedAt === null && where.meetingId.in.includes(o.meetingId as string),
        ),
    },
    mailThread: {
      findMany: async () => store.mailThreads.filter((t) => t.tenantId === scopedTenant),
    },

    // ── Step 3.2 / §19: action_recommendation (tenant-scoped) ──
    actionRecommendation: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        store.actions.find((a) => {
          const w = where;
          if (w.id !== undefined && a.id !== w.id) return false;
          if (w.tenantId !== undefined && a.tenantId !== w.tenantId) return false;
          if (w.clientId !== undefined && a.clientId !== w.clientId) return false;
          if (w.peCode !== undefined && a.peCode !== w.peCode) return false;
          if (w.actionType !== undefined && a.actionType !== w.actionType) return false;
          if (w.deltaId !== undefined && a.deltaId !== w.deltaId) return false;
          const sf = w.status as { notIn?: string[] } | undefined;
          if (sf?.notIn && sf.notIn.includes(a.status as string)) return false;
          return true;
        }) ?? null,
      findMany: async ({ where }: { where: Record<string, unknown> }) =>
        store.actions.filter((a) => {
          const w = where ?? {};
          if (w.tenantId !== undefined && a.tenantId !== w.tenantId) return false;
          if (w.clientId !== undefined && a.clientId !== w.clientId) return false;
          if (w.peCode !== undefined && a.peCode !== w.peCode) return false;
          if (w.actionType !== undefined && a.actionType !== w.actionType) return false;
          const sf = w.status as { notIn?: string[] } | undefined;
          if (sf?.notIn && sf.notIn.includes(a.status as string)) return false;
          return true;
        }),
      create: async ({ data }: { data: Row }) => {
        actionSeq += 1;
        const row = { id: `card-${actionSeq}`, createdAt: new Date(), updatedAt: new Date(), ownerUserId: null, dismissalReason: null, outcome: null, ...data };
        store.actions.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Row }) => {
        const row = store.actions.find((a) => a.id === where.id)!;
        Object.assign(row, data, { updatedAt: new Date() });
        return row;
      },
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Row }) => {
        let count = 0;
        for (const a of store.actions) {
          if (where.id !== undefined && a.id !== where.id) continue;
          if (where.tenantId !== undefined && a.tenantId !== where.tenantId) continue;
          Object.assign(a, data, { updatedAt: new Date() });
          count += 1;
        }
        return { count };
      },
      count: async ({ where }: { where: Record<string, unknown> }) =>
        store.actions.filter((a) => (where.tenantId === undefined || a.tenantId === where.tenantId)).length,
    },

    client: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        store.clients.find((c) => c.id === where.id) ?? null,
    },

    auditLog: {
      create: async ({ data }: { data: Row }) => {
        store.auditLogs.push(data);
        return data;
      },
    },
  };

  return { store, prisma };
}

/** A relevance service double exposing exactly the 3 methods the generator calls. */
function makeRelevance(opts: {
  tenantClients: Array<{ tenantId: string; clientId: string; score: number }>;
  paths: Array<{ path: string; score: number; evidence: string[] }>;
  clientName: string;
}) {
  const rows = () => [
    { clientId: CLIENT, clientName: opts.clientName, score: opts.tenantClients[0]?.score ?? 0, paths: opts.paths },
  ];
  return {
    getRelevantTenantClientsForPe: jest.fn(async () => opts.tenantClients),
    getRelevantClientsForPeByTenantId: jest.fn(async () => rows()),
    getRelevantClientsForPe: jest.fn(async () => rows()),
  };
}

describe('Defense Budget Intelligence — §27 end-to-end acceptance (Step 4.2)', () => {
  test('source → action card → outreach: the full §27 pipeline composes on one shared store', async () => {
    const { store, prisma } = makeStore();
    const matcher = new PeProgramMatcherService();

    // ── §27.1 — SourceDocument with a sha256 (Step 0.1) ──────────────────────────────
    // A synthetic House-mark budget artifact for ONE fictional PE. (PDF EXTRACTION itself
    // is data-blocked — see launch-readiness; this stands in for an extracted artifact.)
    const artifactBytes = Buffer.from(
      JSON.stringify({ pe: PE, fy: FY, exhibit: 'R-2', source: 'synthetic_house_mark' }),
    );
    const sha = sha256OfBuffer(artifactBytes);
    const sdResult = await upsertSourceDocument(prisma as never, {
      sourceKey: `synthetic/house_mark_fy${FY}_${PE}`,
      sha256: sha,
      fiscalYear: FY,
      budgetCycle: 'hasc',
      component: 'ARMY',
      documentType: 'R',
      title: `HASC Mark FY${FY} — ${PE_TITLE}`,
      sourceUrl: 'https://example.test/hasc-mark.pdf',
      extractionMethod: 'synthetic_fixture',
    });

    // ASSERT §27.1: stored with a real sha256.
    expect(sdResult.created).toBe(true);
    expect(store.sourceDocuments).toHaveLength(1);
    expect(sdResult.document.sha256).toBe(sha);
    expect(sdResult.document.sha256).toMatch(/^[0-9a-f]{64}$/);
    const sourceDocumentId = sdResult.document.id;

    // Idempotency sanity: re-ingesting identical content is a no-op (still one row).
    const again = await upsertSourceDocument(prisma as never, {
      sourceKey: `synthetic/house_mark_fy${FY}_${PE}`,
      sha256: sha,
      budgetCycle: 'hasc',
      documentType: 'R',
      title: 'dup',
      sourceUrl: 'https://example.test/hasc-mark.pdf',
      extractionMethod: 'synthetic_fixture',
    });
    expect(again.created).toBe(false);
    expect(store.sourceDocuments).toHaveLength(1);

    // ── §27.2 — Extraction rows with page provenance (Step 1.2 proof-pack rows) ───────
    // Two exhibit citations for the PE, each with a source document + page number.
    store.programElements.push({ peCode: PE, title: PE_TITLE, service: 'ARMY' });
    store.programElementSources.push(
      { peCode: PE, sourceDocumentId, docType: 'R', exhibitType: 'R-2', fy: FY, pageNumber: 144 },
      { peCode: PE, sourceDocumentId, docType: 'R', exhibitType: 'R-2A', fy: FY, pageNumber: 152 },
    );

    // ASSERT §27.2: extraction rows carry page provenance back to the source document.
    const extractionRows = await prisma.programElementSource.findMany({ where: { peCode: PE } });
    expect(extractionRows).toHaveLength(2);
    expect(extractionRows.every((r: Row) => typeof r.pageNumber === 'number' && r.sourceDocumentId === sourceDocumentId)).toBe(true);

    // ── §27.3 — Reconciliation PASS (Step 0.2): extracted totals match control totals ─
    // The PE-year row: request 250M, House mark 100M (a $150M, -60% cut — clearly material).
    // Control totals match the loaded values exactly → PASS (no unresolved conflict).
    store.programElementYears.push({
      peCode: PE,
      fy: FY,
      request: 250,
      hascMark: 100,
      sascMark: null,
      hacDMark: null,
      sacDMark: null,
      conference: null,
      enacted: null,
    });
    const control: ControlTotals = {
      groups: [
        { fiscalYear: FY, budgetCycle: 'pb', component: 'ARMY', field: 'request', totalMillions: 250 },
        { fiscalYear: FY, budgetCycle: 'hasc', component: 'ARMY', field: 'hascMark', totalMillions: 100 },
      ],
    };
    const recon = await checkBudgetReconciliation(prisma as never, control);

    // ASSERT §27.3: reconciliation passes — every checked group PASS, no FAIL (no conflict).
    expect(recon.ok).toBe(true);
    expect(recon.failed).toBe(0);
    expect(recon.checked).toBe(2);
    expect(recon.results.every((r) => r.status === 'PASS')).toBe(true);

    // ── §27.4 — A material delta detected (Step 1.4 delta engine + materiality) ───────
    // Derive deltas from the year, score materiality, persist the MATERIAL one as the
    // ProgramElementDelta the generator will later load.
    const year = store.programElementYears[0]! as unknown as Parameters<typeof deltasFromYear>[0];
    const derived = deltasFromYear(year);
    const markVsRequest = derived.find((d) => d.deltaType === 'mark_vs_request' && d.toRef === 'hascMark')!;
    const scored = scoreMateriality({
      deltaType: markVsRequest.deltaType,
      deltaAbsM: markVsRequest.deltaAbs,
      deltaPct: markVsRequest.deltaPct,
      stage: markVsRequest.stage,
    });

    // ASSERT §27.4: a typed delta with materialityScore over the 0.4 "notable" gate.
    expect(markVsRequest.deltaType).toBe('mark_vs_request');
    expect(markVsRequest.amountFrom).toBe(250);
    expect(markVsRequest.amountTo).toBe(100);
    expect(markVsRequest.deltaPct).toBeCloseTo(-0.6, 5);
    expect(scored.score).toBeGreaterThanOrEqual(MATERIALITY_THRESHOLDS.notable); // >= 0.4
    expect(scored.score).toBeGreaterThanOrEqual(0.4);

    // The persisted delta row (Decimal columns arrive with .toNumber() in the generator).
    const DELTA_ID = 'delta-shgv-1';
    const persistedDelta = {
      id: DELTA_ID,
      peCode: PE,
      assertedFy: FY,
      deltaType: markVsRequest.deltaType,
      fromRef: markVsRequest.fromRef,
      toRef: markVsRequest.toRef,
      amountFrom: { toNumber: () => markVsRequest.amountFrom! },
      amountTo: { toNumber: () => markVsRequest.amountTo! },
      deltaPct: markVsRequest.deltaPct,
      materialityScore: scored.score,
      supersededAt: null,
    };
    // Wire the delta into the generator's delegate (global, RLS-exempt).
    prisma.programElementDelta = {
      findMany: async () => [persistedDelta],
    };

    // ── §27.5 — A project identified (Step 1.2 R-2A project) ──────────────────────────
    // The R-2A exhibit names a project within the PE; its title drives the alias match.
    const project = { peCode: PE, projectCode: 'CG01', title: 'Hypersonic Glide Vehicle' };

    // ASSERT §27.5: a project is present with code + title + page-cited exhibit.
    expect(project.projectCode).toBe('CG01');
    expect(project.title).toContain('Glide Vehicle');
    const r2aRow = extractionRows.find((r: Row) => r.exhibitType === 'R-2A');
    expect(r2aRow?.pageNumber).toBe(152);

    // ── §27.6 — Program candidate via alias, left 'candidate', then ACCEPTED ──────────
    // Seed a Program + its alias; the pure matcher proposes a CANDIDATE (fuzzy paths can
    // never auto-accept). Persist it, then ProgramsService.resolveMatch('accept') walks
    // candidate → accepted (the analyst review path).
    store.programs.push({ id: PROGRAM_ID, canonicalName: 'Hypersonic Glide Vehicle Program', component: 'ARMY', mdapCode: null, status: 'active' });
    const aliasNormalized = matcher.normalizeAlias('Hypersonic Glide Vehicle');
    const aliasIndex = [
      { programId: PROGRAM_ID, aliasNormalized, aliasType: 'pe_title', component: 'ARMY' as const, tg: matcher.trigrams('Hypersonic Glide Vehicle') },
    ];
    const proposals = matcher.matchPe(
      { peCode: PE, title: PE_TITLE },
      [project],
      aliasIndex,
      new Map(),
    );
    const proposal = proposals.find((p) => p.programId === PROGRAM_ID)!;

    // ASSERT §27.6a: the fuzzy alias match is a CANDIDATE (never auto-accepted).
    expect(proposal).toBeDefined();
    expect(proposal.status).toBe('candidate');
    expect(proposal.evidenceTier).not.toBe('exact_pe_number');

    const candidateMatch = await prisma.peProgramMatch.create({
      data: {
        peCode: proposal.peCode,
        projectCode: proposal.projectCode,
        programId: proposal.programId,
        score: proposal.score,
        evidenceTier: proposal.evidenceTier,
        status: proposal.status,
        weakSignal: proposal.weakSignal,
        matchBasis: proposal.matchBasis,
        evidence: proposal.evidence,
      },
    });
    expect(store.peProgramMatches.find((m) => m.id === candidateMatch.id)!.status).toBe('candidate');

    // Analyst accepts via the REAL resolve path.
    const programsService = new ProgramsService(prisma as never, matcher);
    const resolved = await programsService.resolveMatch(candidateMatch.id, { decision: 'accept', notes: 'verified e2e' }, ctx);

    // ASSERT §27.6b: status transitions candidate → accepted; AuditLog written.
    expect(resolved.status).toBe('accepted');
    expect(store.peProgramMatches.find((m) => m.id === candidateMatch.id)!.status).toBe('accepted');
    expect(store.auditLogs.some((a) => a.action === 'program.match.resolve')).toBe(true);

    // ── §27.7 — A client matched (Step 2.3 relevance ≥0.5, ≥1 path with evidence) ─────
    // Two paths: a capability keyword (sim 0.7) + a facility district. combineRelevance
    // folds them into a score ≥0.5 with supporting evidence on each path.
    store.clients.push({ id: CLIENT, name: 'Acme Hypersonics', tenantId: TENANT });
    const relevance = combineRelevance([
      scoreCapabilityKeyword({ matchedKeywords: ['hypersonic', 'glide vehicle'], maxSimilarity: 0.7 }),
      scoreFacilityDistrict({ matchedDistricts: ['AL-05'] }),
    ]);

    // ASSERT §27.7: relevance ≥0.5 across ≥1 path, each path carrying evidence.
    expect(relevance.score).toBeGreaterThanOrEqual(0.5);
    expect(relevance.paths.length).toBeGreaterThanOrEqual(1);
    expect(relevance.paths.every((p) => p.evidence.length > 0)).toBe(true);
    expect(relevance.paths.map((p) => p.path)).toContain('capability_keyword');

    // ── §27.8 — A person/office mapped with the contact-use guardrail (Step 2.2) ──────
    // The PE's office has TWO accepted roles: a Program Manager (context, eligible to
    // surface) and a Contracting Officer (procurement POC — NEVER a lobbying target).
    store.offices.push({ id: OFFICE_ID, name: 'PEO Missiles and Space' });
    store.officeLinks.push({ officeId: OFFICE_ID, programId: PROGRAM_ID, reviewStatus: 'accepted' });
    store.personnel.push(
      { id: PERSON_PM, fullName: 'Col. Pat Manager', pePrimary: PE, peSecondary: [], metadata: {}, supersededAt: null, firstSeenAt: new Date(), lastSeenAt: new Date(), sources: [{ id: 's1' }] },
      { id: PERSON_CO, fullName: 'Mr. Casey Contracting', pePrimary: PE, peSecondary: [], metadata: {}, supersededAt: null, firstSeenAt: new Date(), lastSeenAt: new Date(), sources: [{ id: 's2' }] },
    );
    store.personRoles.push(
      { id: 'role-pm', personId: PERSON_PM, officeId: OFFICE_ID, programId: PROGRAM_ID, roleTitle: 'Program Manager', roleType: 'pm', source: 'peo_roster', observedAt: new Date(), staleAt: null, confidence: 0.9, reviewStatus: 'accepted', contactUse: 'program_ownership_context' },
      { id: 'role-co', personId: PERSON_CO, officeId: OFFICE_ID, programId: PROGRAM_ID, roleTitle: 'Contracting Officer', roleType: 'contracting_officer', source: 'sam_gov', observedAt: new Date(), staleAt: null, confidence: 0.9, reviewStatus: 'accepted', contactUse: 'official_procurement_poc' },
    );
    const personnelRead = new AcquisitionPersonnelReadService(prisma as never);
    const people = await personnelRead.getProgramElementPersonnel(PE, ctx);
    const pm = people.find((p) => p.id === PERSON_PM)!;
    const co = people.find((p) => p.id === PERSON_CO)!;

    // ASSERT §27.8: both people map via the office→program→PE chain; the CO's contactUse
    // is the procurement POC class that is EXCLUDED from recommendations; the why-shown
    // line never renders a person as the PE owner.
    expect(pm.roles![0]!.contactUse).toBe('program_ownership_context');
    expect(co.roles![0]!.contactUse).toBe('official_procurement_poc');
    expect(isExcludedFromRecommendations('official_procurement_poc')).toBe(true);
    expect(co.roles![0]!.whyShown.toLowerCase()).not.toContain('owns pe');

    // ── §27.9 — ActionRecommendation generated with ALL §10 fields (Step 3.2) ─────────
    // The REAL generator: loads the material delta, fans out to the relevant client,
    // gates on materiality≥0.4 AND relevance≥0.5, assembles the card. The CO role must
    // NOT appear in the audience (guardrail); the PM may (context-only).
    const relevanceService = makeRelevance({
      tenantClients: [{ tenantId: TENANT, clientId: CLIENT, score: relevance.score }],
      paths: relevance.paths.map((p) => ({ path: p.path, score: p.score, evidence: p.evidence })),
      clientName: 'Acme Hypersonics',
    });
    const generator = new ActionRecommendationService(prisma as never, relevanceService as never);
    const genResult = await generator.generate();

    // ASSERT §27.9: exactly one card generated, all §10 fields present, gating honored.
    expect(genResult.generated).toBe(1);
    const card = store.actions[0]!;
    // §10 narrative fields.
    expect(card.issueTitle).toEqual(expect.any(String));
    expect((card.issueTitle as string).length).toBeGreaterThan(0);
    expect(card.whatChanged).toMatch(new RegExp(PE));
    expect(card.whyItMatters).toMatch(/Acme Hypersonics/);
    expect(card.recommendedAction).toEqual(expect.any(String));
    expect(card.suggestedArtifactType).toEqual(expect.any(String));
    // §10 linkage / scoring fields.
    expect(card.actionType).toBe('restore_cut'); // a cut (100 → 60) with an ACCEPTED match
    expect(card.deltaId).toBe(DELTA_ID);
    expect(card.peCode).toBe(PE);
    expect(card.programId).toBe(PROGRAM_ID);
    expect(card.status).toBe('new');
    expect(card.priority).toBeGreaterThan(0);
    // §10 confidence bands (all four dimensions).
    const conf = card.confidence as Record<string, string>;
    expect(conf.delta).toBeDefined();
    expect(conf.programMatch).toBe('high'); // accepted match
    expect(conf.clientRelevance).toBeDefined();
    // GUARDRAIL: the procurement POC is NOT in the target audience; the PM (context) is.
    const audience = card.targetAudience as Array<{ id: string; kind: string; contactUse?: string }>;
    expect(audience.find((a) => a.id === 'role-co')).toBeUndefined();
    expect(audience.every((a) => !a.contactUse || !isExcludedFromRecommendations(a.contactUse as never))).toBe(true);
    // gating: the delta cleared 0.4 AND relevance cleared 0.5 (proven above) → a card exists.
    expect(scored.score).toBeGreaterThanOrEqual(0.4);
    expect(relevance.score).toBeGreaterThanOrEqual(0.5);

    // ── §27.10 — Proof pack resolves every evidence ref (Step 1.2 + the card evidence) ─
    // Every evidence ref on the card must resolve to a real row in the store.
    const evidence = card.evidence as Array<{ kind: string; deltaId?: string; sourceDocumentId?: string; provisionId?: string }>;
    expect(evidence.length).toBeGreaterThan(0);
    for (const ref of evidence) {
      if (ref.kind === 'delta') {
        expect(ref.deltaId).toBe(DELTA_ID);
      } else if (ref.kind === 'source') {
        // resolves to a real SourceDocument in the registry.
        expect(store.sourceDocuments.some((d) => d.id === ref.sourceDocumentId)).toBe(true);
      } else if (ref.kind === 'provision') {
        // the relied-upon program match's program id.
        expect(store.programs.some((p) => p.id === ref.provisionId)).toBe(true);
      }
    }
    // The proof-pack ordering core orders exhibits R-2 before R-2A (document order).
    const ordered = [...store.programElementSources].sort((a, b) =>
      compareProofPackSources(
        { docType: a.docType as string, exhibitType: a.exhibitType as string, fy: a.fy as number, pageNumber: a.pageNumber as number },
        { docType: b.docType as string, exhibitType: b.exhibitType as string, fy: b.fy as number, pageNumber: b.pageNumber as number },
      ),
    );
    expect(ordered[0]!.exhibitType).toBe('R-2');
    expect(ordered[1]!.exhibitType).toBe('R-2A');

    // ── §27.11 — Uncertainty surfaces pending pieces (candidate match → escalate) ─────
    // A SECOND PE whose program match is left CANDIDATE: the generator must flip its card
    // to escalate_uncertainty with a non-null uncertainty note (the §7/§19 review hook).
    const PE2 = '0699998A';
    const DELTA2 = 'delta-candidate-1';
    store.programElements.push({ peCode: PE2, title: 'Synthetic Directed Energy', service: 'ARMY' });
    store.programs.push({ id: 'prog-de', canonicalName: 'Directed Energy Program', component: 'ARMY', status: 'active' });
    await prisma.peProgramMatch.create({
      data: { peCode: PE2, projectCode: null, programId: 'prog-de', score: 0.78, evidenceTier: 'sam_match', status: 'candidate', weakSignal: false, matchBasis: 'fuzzy', evidence: [] },
    });
    const delta2 = {
      id: DELTA2,
      peCode: PE2,
      assertedFy: FY,
      deltaType: 'mark_vs_request',
      fromRef: 'request',
      toRef: 'hascMark',
      amountFrom: { toNumber: () => 80 },
      amountTo: { toNumber: () => 40 },
      deltaPct: -0.5,
      materialityScore: 0.8,
      supersededAt: null,
    };
    prisma.programElementDelta = { findMany: async () => [delta2] };
    const relevance2 = makeRelevance({
      tenantClients: [{ tenantId: TENANT, clientId: CLIENT, score: 0.7 }],
      paths: [{ path: 'capability_keyword', score: 0.7, evidence: ['Keyword match: directed energy'] }],
      clientName: 'Acme Hypersonics',
    });
    await new ActionRecommendationService(prisma as never, relevance2 as never).generate();
    const candidateCard = store.actions.find((a) => a.peCode === PE2)!;

    // ASSERT §27.11: the unconfirmed (candidate) match forces escalate_uncertainty + a note.
    expect(candidateCard.actionType).toBe('escalate_uncertainty');
    expect(candidateCard.uncertainty).toEqual(expect.any(String));
    expect(candidateCard.uncertainty as string).toMatch(/candidate/i);

    // ── §27.12 — Artifact generation (Step 3.3) — SKIPPED, see it.todo below ───────────
    // (asserted as pending out-of-band; nothing to do inline.)

    // ── §27.13 — Coverage gap → schedule_outreach card (Step 3.4) ─────────────────────
    // The PM is RELEVANT to the PE (accepted chain) but has NO engagement → a coverage
    // gap. createOutreachFromGap produces a schedule_outreach card assigned to an owner.
    const coverage = new CoverageGapService(prisma as never);
    const outreachOwner = '99999999-9999-9999-9999-999999999999';
    const outreach = await coverage.createOutreachFromGap(ctx, {
      peCode: PE,
      clientId: CLIENT,
      officeId: OFFICE_ID,
      personId: PERSON_PM,
      ownerUserId: outreachOwner,
    });

    // ASSERT §27.13: the gap produces a schedule_outreach card, owned + assigned.
    expect(outreach.created).toBe(true);
    expect(outreach.status).toBe('assigned');
    const outreachCard = store.actions.find((c) => c.id === outreach.id)!;
    expect(outreachCard.actionType).toBe('schedule_outreach');
    expect(outreachCard.ownerUserId).toBe(outreachOwner);
    expect(store.auditLogs.some((a) => a.action === 'intelligence.coverage.outreach.create')).toBe(true);

    // GUARDRAIL on the outreach path too: refuse to schedule outreach to the procurement POC.
    await expect(
      coverage.createOutreachFromGap(ctx, { peCode: PE, clientId: CLIENT, officeId: OFFICE_ID, personId: PERSON_CO, ownerUserId: outreachOwner }),
    ).rejects.toBeTruthy();

    // ── §27.14 — Owner assigned + status walk new→…; a SECOND card dismissed w/ reason ─
    // Walk the FIRST card through the §19 lifecycle via the REAL read/write service:
    // assign owner, then new→triaged→assigned→drafting→ready_for_review.
    const readWrite = new ActionRecommendationReadService(prisma as never);
    const cardId = card.id as string;
    await readWrite.updateOwner(ctx, cardId, USER);
    expect((store.actions.find((a) => a.id === cardId)!).ownerUserId).toBe(USER);

    let walked = await readWrite.updateStatus(ctx, cardId, 'triaged');
    expect(walked.status).toBe('triaged');
    walked = await readWrite.updateStatus(ctx, cardId, 'assigned');
    expect(walked.status).toBe('assigned');
    walked = await readWrite.updateStatus(ctx, cardId, 'drafting');
    expect(walked.status).toBe('drafting');
    walked = await readWrite.updateStatus(ctx, cardId, 'ready_for_review');
    expect(walked.status).toBe('ready_for_review');

    // An ILLEGAL transition is rejected (transition validation, §19).
    await expect(readWrite.updateStatus(ctx, cardId, 'new')).rejects.toBeTruthy();

    // A SECOND card (the candidate-match card) is DISMISSED — WITH a reason. Dismissing
    // WITHOUT a reason is rejected; WITH a reason succeeds and persists the reason.
    const card2Id = candidateCard.id as string;
    await expect(readWrite.updateStatus(ctx, card2Id, 'dismissed')).rejects.toBeTruthy(); // no reason → rejected
    const dismissed = await readWrite.updateStatus(ctx, card2Id, 'dismissed', 'Not a fit for this client right now');
    expect(dismissed.status).toBe('dismissed');
    expect(dismissed.dismissalReason).toBe('Not a fit for this client right now');
    expect(store.auditLogs.some((a) => a.action === 'intelligence.action.status' && (a.after as Row).status === 'dismissed')).toBe(true);
  });

  // ── §27.12 — Artifact generation (Step 3.3) — pending runtime LLM ───────────────────
  // Source-backed one-pagers/memos/talking-points (Step 3.3) are NOT built: they require
  // a runtime LLM constrained by the FactSheet verifier, which this env cannot call. The
  // card already carries `suggestedArtifactType` (asserted in §27.9); the generation step
  // is the only §27 row left unbuilt. See the launch-readiness doc's BLOCKED ledger.
  it.todo('§27.12 — artifact generated with sources appendix (pending Step 3.3 — runtime LLM)');
});
