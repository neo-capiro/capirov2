import { BadRequestException } from '@nestjs/common';
import type { TenantContext } from '@capiro/shared';
import { CoverageGapService } from './coverage-gap.service.js';

/**
 * Step 3.4 — CoverageGapService behaviour.
 *
 * In-memory prisma double. The GLOBAL graph tables (peProgramMatch / programOfficeProgramLink
 * / personRole) are read on the BASE client (no tenant scope); the engagement tables
 * (engagementContact / meetingAttendee / outreachRecord / mailThread) and action_recommendation
 * are read/written inside `withTenant`, whose fake tx is FILTERED to the scoped tenantId so a
 * foreign tenant's engagement is invisible (the RLS-isolation behaviour, in test form).
 *
 * The pure `coverageStrength` banding runs for real; we only fake the DB.
 */

const TENANT_A = '00000000-0000-0000-0000-0000000000a1';
const TENANT_B = '00000000-0000-0000-0000-0000000000b2';
const USER = '00000000-0000-0000-0000-0000000000c3';
const CLIENT = '11111111-1111-1111-1111-111111111111';
const PE = '0604123A';

const ctxA: TenantContext = {
  tenantId: TENANT_A,
  tenantSlug: 'capiro',
  userId: USER,
  clerkUserId: 'user_test',
  role: 'standard_user',
};

const NOW = new Date('2026-06-08T12:00:00.000Z');
function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
}

interface Seed {
  matches?: Array<{ peCode: string; programId: string; status: string }>;
  links?: Array<{ officeId: string; programId: string; reviewStatus: string; officeName: string }>;
  roles?: Array<{
    officeId: string;
    personId: string;
    fullName: string;
    roleTitle: string;
    contactUse: string;
    reviewStatus: string;
    staleAt: Date | null;
  }>;
  contacts?: Array<{
    id: string;
    tenantId: string;
    acquisitionPersonnelId: string;
    email: string | null;
  }>;
  attendees?: Array<{
    tenantId: string;
    contactId: string;
    meetingId: string;
    startsAt: Date;
    createdByUserId: string | null;
  }>;
  outreach?: Array<{
    tenantId: string;
    meetingId: string;
    sentAt: Date | null;
    createdAt: Date;
    createdByUserId: string | null;
    deletedAt: Date | null;
  }>;
  threads?: Array<{
    tenantId: string;
    participants: unknown;
    lastMessageAt: Date | null;
    updatedAt: Date;
  }>;
  actions?: Array<Record<string, unknown>>;
}

/** Build the in-memory prisma double from a seed. */
function makePrisma(seed: Seed) {
  const auditLogCalls: Array<Record<string, unknown>> = [];
  const matches = seed.matches ?? [];
  const links = seed.links ?? [];
  const roles = seed.roles ?? [];
  const contacts = seed.contacts ?? [];
  const attendees = seed.attendees ?? [];
  const outreach = seed.outreach ?? [];
  const threads = seed.threads ?? [];
  const actionStore = (seed.actions ?? []).map((a) => ({ ...a }));

  let scopedTenant: string | null = null;

  // GLOBAL graph reads (base client — no tenant filter).
  const base = {
    peProgramMatch: {
      findMany: jest.fn(async (args: { where: { peCode: string; status: string } }) =>
        matches.filter(
          (m) => m.peCode === args.where.peCode && m.status === args.where.status,
        ),
      ),
    },
    programOfficeProgramLink: {
      findMany: jest.fn(
        async (args: { where: { programId: { in: string[] }; reviewStatus: string } }) =>
          links
            .filter(
              (l) =>
                args.where.programId.in.includes(l.programId) &&
                l.reviewStatus === args.where.reviewStatus,
            )
            .map((l) => ({
              officeId: l.officeId,
              programId: l.programId,
              office: { id: l.officeId, name: l.officeName },
            })),
      ),
    },
    personRole: {
      findMany: jest.fn(
        async (args: {
          where: { officeId: { in: string[] }; reviewStatus: string; staleAt: null };
        }) =>
          roles
            .filter(
              (r) =>
                args.where.officeId.in.includes(r.officeId) &&
                r.reviewStatus === args.where.reviewStatus &&
                r.staleAt === null,
            )
            .map((r) => ({
              officeId: r.officeId,
              roleTitle: r.roleTitle,
              contactUse: r.contactUse,
              personId: r.personId,
              person: { id: r.personId, fullName: r.fullName },
            })),
      ),
    },
  };

  // Tenant-scoped tx. Every engagement/action read is FILTERED to scopedTenant so a
  // foreign-tenant row is never returned (RLS-isolation behaviour in test form).
  const tx = {
    engagementContact: {
      findMany: jest.fn(
        async (args: { where: { acquisitionPersonnelId: { in: string[] } } }) =>
          contacts.filter(
            (c) =>
              c.tenantId === scopedTenant &&
              args.where.acquisitionPersonnelId.in.includes(c.acquisitionPersonnelId),
          ),
      ),
    },
    meetingAttendee: {
      findMany: jest.fn(async (args: { where: { contactId: { in: string[] } } }) =>
        attendees
          .filter(
            (a) => a.tenantId === scopedTenant && args.where.contactId.in.includes(a.contactId),
          )
          .map((a) => ({
            contactId: a.contactId,
            meeting: {
              id: a.meetingId,
              startsAt: a.startsAt,
              createdByUserId: a.createdByUserId,
            },
          })),
      ),
    },
    outreachRecord: {
      findMany: jest.fn(async (args: { where: { meetingId: { in: string[] } } }) =>
        outreach.filter(
          (o) =>
            o.tenantId === scopedTenant &&
            o.deletedAt === null &&
            args.where.meetingId.in.includes(o.meetingId),
        ),
      ),
    },
    mailThread: {
      findMany: jest.fn(async () =>
        threads.filter((t) => t.tenantId === scopedTenant),
      ),
    },
    actionRecommendation: {
      findFirst: jest.fn(
        async (args: { where: Record<string, unknown> }) =>
          actionStore.find(
            (a) =>
              a.id === args.where.id &&
              (args.where.tenantId === undefined || a.tenantId === args.where.tenantId),
          ) ?? null,
      ),
      findMany: jest.fn(async (args: { where: Record<string, unknown> }) =>
        actionStore.filter((a) => {
          const w = args.where;
          if (w.tenantId !== undefined && a.tenantId !== w.tenantId) return false;
          if (w.clientId !== undefined && a.clientId !== w.clientId) return false;
          if (w.peCode !== undefined && a.peCode !== w.peCode) return false;
          if (w.actionType !== undefined && a.actionType !== w.actionType) return false;
          const statusFilter = w.status as { notIn?: string[] } | undefined;
          if (statusFilter?.notIn && statusFilter.notIn.includes(a.status as string)) return false;
          return true;
        }),
      ),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `card-${actionStore.length + 1}`, ...data };
        actionStore.push(row);
        return row;
      }),
    },
    auditLog: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        auditLogCalls.push(data);
        return data;
      }),
    },
  };

  const prisma = {
    ...base,
    __auditLogCalls: auditLogCalls,
    __actionStore: actionStore,
    __tx: tx,
    withTenant: jest.fn(
      async (tenantId: string, fn: (t: typeof tx) => Promise<unknown>) => {
        const prev = scopedTenant;
        scopedTenant = tenantId;
        try {
          return await fn(tx);
        } finally {
          scopedTenant = prev;
        }
      },
    ),
  };
  return prisma;
}

/** A standard relevant chain: one accepted match -> link -> office, with two people. */
function relevantChain(): Pick<Seed, 'matches' | 'links' | 'roles'> {
  return {
    matches: [{ peCode: PE, programId: 'prog-1', status: 'accepted' }],
    links: [
      { officeId: 'office-1', programId: 'prog-1', reviewStatus: 'accepted', officeName: 'PEO Aviation' },
    ],
    roles: [
      {
        officeId: 'office-1',
        personId: 'person-touched',
        fullName: 'Jane PM',
        roleTitle: 'Program Manager',
        contactUse: 'program_ownership_context',
        reviewStatus: 'accepted',
        staleAt: null,
      },
      {
        officeId: 'office-1',
        personId: 'person-cold',
        fullName: 'John Deputy',
        roleTitle: 'Deputy PM',
        contactUse: 'program_ownership_context',
        reviewStatus: 'accepted',
        staleAt: null,
      },
    ],
  };
}

describe('CoverageGapService', () => {
  describe('getCoverageForPe', () => {
    test('a person with a meeting 20 days ago bands active with that lastTouch; a relevant person with no engagement bands none', async () => {
      const chain = relevantChain();
      const prisma = makePrisma({
        ...chain,
        contacts: [
          {
            id: 'contact-1',
            tenantId: TENANT_A,
            acquisitionPersonnelId: 'person-touched',
            email: 'jane@navy.mil',
          },
        ],
        attendees: [
          {
            tenantId: TENANT_A,
            contactId: 'contact-1',
            meetingId: 'meeting-1',
            startsAt: daysAgo(20),
            createdByUserId: USER,
          },
        ],
      });
      const service = new CoverageGapService(prisma as never);

      const result = await service.getCoverageForPe(ctxA, PE, { clientId: CLIENT, now: NOW });

      expect(prisma.withTenant).toHaveBeenCalledWith(TENANT_A, expect.any(Function));

      // The touched person is strong/active with the meeting date as lastTouch + owner.
      const touched = result.strong.find((e) => e.personId === 'person-touched');
      expect(touched).toBeDefined();
      expect(touched?.strength).toBe('active');
      expect(touched?.lastTouch).toBe(daysAgo(20).toISOString());
      expect(touched?.owner).toBe(USER);

      // The other relevant person has NO engagement -> none.
      const cold = result.none.find((e) => e.personId === 'person-cold');
      expect(cold).toBeDefined();
      expect(cold?.strength).toBe('none');
      expect(cold?.lastTouch).toBeNull();
    });

    test('a touch 150 days ago bands weak (cold)', async () => {
      const chain = relevantChain();
      chain.roles = [chain.roles![0]!]; // single person
      const prisma = makePrisma({
        ...chain,
        contacts: [
          { id: 'contact-1', tenantId: TENANT_A, acquisitionPersonnelId: 'person-touched', email: null },
        ],
        attendees: [
          {
            tenantId: TENANT_A,
            contactId: 'contact-1',
            meetingId: 'meeting-1',
            startsAt: daysAgo(150),
            createdByUserId: USER,
          },
        ],
      });
      const service = new CoverageGapService(prisma as never);

      const result = await service.getCoverageForPe(ctxA, PE, { now: NOW });

      expect(result.weak.map((e) => e.personId)).toContain('person-touched');
      expect(result.strong).toHaveLength(0);
    });

    test('matches a mail thread to a person by participant email', async () => {
      const chain = relevantChain();
      chain.roles = [chain.roles![0]!];
      const prisma = makePrisma({
        ...chain,
        contacts: [
          {
            id: 'contact-1',
            tenantId: TENANT_A,
            acquisitionPersonnelId: 'person-touched',
            email: 'Jane@Navy.mil',
          },
        ],
        threads: [
          {
            tenantId: TENANT_A,
            participants: [{ email: 'jane@navy.mil', name: 'Jane PM' }],
            lastMessageAt: daysAgo(5),
            updatedAt: daysAgo(5),
          },
        ],
      });
      const service = new CoverageGapService(prisma as never);

      const result = await service.getCoverageForPe(ctxA, PE, { now: NOW });

      const touched = result.strong.find((e) => e.personId === 'person-touched');
      expect(touched?.strength).toBe('active');
      expect(touched?.lastTouch).toBe(daysAgo(5).toISOString());
    });

    test('RLS isolation: tenant A cannot see tenant B engagement, so the person reads as none', async () => {
      const chain = relevantChain();
      chain.roles = [chain.roles![0]!];
      const prisma = makePrisma({
        ...chain,
        // The ONLY contact/meeting belongs to tenant B.
        contacts: [
          {
            id: 'contact-b',
            tenantId: TENANT_B,
            acquisitionPersonnelId: 'person-touched',
            email: 'jane@navy.mil',
          },
        ],
        attendees: [
          {
            tenantId: TENANT_B,
            contactId: 'contact-b',
            meetingId: 'meeting-b',
            startsAt: daysAgo(2),
            createdByUserId: 'someone-else',
          },
        ],
      });
      const service = new CoverageGapService(prisma as never);

      // Tenant A asks for coverage -> tenant B's engagement is invisible -> none.
      const result = await service.getCoverageForPe(ctxA, PE, { now: NOW });

      expect(result.strong).toHaveLength(0);
      const touched = result.none.find((e) => e.personId === 'person-touched');
      expect(touched?.strength).toBe('none');
      expect(touched?.lastTouch).toBeNull();
    });

    test('a procurement-POC (excluded contactUse) is surfaced as context but NOT outreach-eligible', async () => {
      const chain = relevantChain();
      chain.roles = [
        {
          officeId: 'office-1',
          personId: 'person-co',
          fullName: 'Carl Contracting',
          roleTitle: 'Contracting Officer',
          contactUse: 'official_procurement_poc',
          reviewStatus: 'accepted',
          staleAt: null,
        },
      ];
      const prisma = makePrisma({ ...chain });
      const service = new CoverageGapService(prisma as never);

      const result = await service.getCoverageForPe(ctxA, PE, { now: NOW });

      const co = result.none.find((e) => e.personId === 'person-co');
      expect(co).toBeDefined();
      expect(co?.outreachEligible).toBe(false);
      expect(co?.contactUseLabel).toBe('Official procurement POC');
    });
  });

  describe('getCoverageForAction', () => {
    test('resolves the PE + clientId from the action and attaches why-now', async () => {
      const chain = relevantChain();
      chain.roles = [chain.roles![0]!];
      const prisma = makePrisma({
        ...chain,
        actions: [
          {
            id: 'action-1',
            tenantId: TENANT_A,
            clientId: CLIENT,
            peCode: PE,
            whatChanged: 'House cut below request',
            deadline: new Date('2026-07-01T00:00:00.000Z'),
          },
        ],
      });
      const service = new CoverageGapService(prisma as never);

      const result = await service.getCoverageForAction(ctxA, 'action-1');

      expect(result.peCode).toBe(PE);
      expect(result.clientId).toBe(CLIENT);
      expect(result.whyNow?.whatChanged).toBe('House cut below request');
      expect(result.whyNow?.deadline).toBe('2026-07-01T00:00:00.000Z');
    });
  });

  describe('createOutreachFromGap', () => {
    test('creates a schedule_outreach card assigned to the owner and writes an AuditLog', async () => {
      const chain = relevantChain();
      chain.roles = [chain.roles![0]!]; // person-touched, program_ownership_context (eligible)
      const prisma = makePrisma({ ...chain });
      const service = new CoverageGapService(prisma as never);
      const owner = '99999999-9999-9999-9999-999999999999';

      const res = await service.createOutreachFromGap(ctxA, {
        peCode: PE,
        clientId: CLIENT,
        officeId: 'office-1',
        personId: 'person-touched',
        ownerUserId: owner,
      });

      expect(res.created).toBe(true);
      expect(res.status).toBe('assigned');

      const card = prisma.__actionStore.find((c) => c.id === res.id)!;
      expect(card.actionType).toBe('schedule_outreach');
      expect(card.ownerUserId).toBe(owner);
      expect(card.clientId).toBe(CLIENT);
      expect(card.peCode).toBe(PE);
      const audience = card.targetAudience as Array<Record<string, unknown>>;
      expect(audience[0]).toMatchObject({ kind: 'person_role', id: 'person-touched' });

      expect(prisma.__auditLogCalls).toHaveLength(1);
      expect(prisma.__auditLogCalls[0]).toMatchObject({
        action: 'intelligence.coverage.outreach.create',
        entityType: 'action_recommendation',
        entityId: res.id,
        after: { actionType: 'schedule_outreach', ownerUserId: owner, personId: 'person-touched' },
      });
    });

    test('is idempotent: an existing open card for the same person is returned, not duplicated', async () => {
      const chain = relevantChain();
      chain.roles = [chain.roles![0]!];
      const prisma = makePrisma({
        ...chain,
        actions: [
          {
            id: 'existing-card',
            tenantId: TENANT_A,
            clientId: CLIENT,
            peCode: PE,
            actionType: 'schedule_outreach',
            status: 'assigned',
            targetAudience: [{ kind: 'person_role', id: 'person-touched', label: 'Jane PM' }],
          },
        ],
      });
      const service = new CoverageGapService(prisma as never);

      const res = await service.createOutreachFromGap(ctxA, {
        peCode: PE,
        clientId: CLIENT,
        officeId: 'office-1',
        personId: 'person-touched',
        ownerUserId: USER,
      });

      expect(res.created).toBe(false);
      expect(res.id).toBe('existing-card');
      expect(prisma.__tx.actionRecommendation.create).not.toHaveBeenCalled();
      expect(prisma.__auditLogCalls).toHaveLength(0);
    });

    test('refuses to create an outreach card for an excluded procurement POC', async () => {
      const chain = relevantChain();
      chain.roles = [
        {
          officeId: 'office-1',
          personId: 'person-co',
          fullName: 'Carl Contracting',
          roleTitle: 'Contracting Officer',
          contactUse: 'official_procurement_poc',
          reviewStatus: 'accepted',
          staleAt: null,
        },
      ];
      const prisma = makePrisma({ ...chain });
      const service = new CoverageGapService(prisma as never);

      await expect(
        service.createOutreachFromGap(ctxA, {
          peCode: PE,
          clientId: CLIENT,
          officeId: 'office-1',
          personId: 'person-co',
          ownerUserId: USER,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.__tx.actionRecommendation.create).not.toHaveBeenCalled();
    });

    test('rejects a target office that is not relevant to the PE', async () => {
      const chain = relevantChain();
      chain.roles = [chain.roles![0]!];
      const prisma = makePrisma({ ...chain });
      const service = new CoverageGapService(prisma as never);

      await expect(
        service.createOutreachFromGap(ctxA, {
          peCode: PE,
          clientId: CLIENT,
          officeId: 'office-NOT-RELEVANT',
          ownerUserId: USER,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
