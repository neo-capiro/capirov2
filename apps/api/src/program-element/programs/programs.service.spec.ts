import { describe, expect, test } from '@jest/globals';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { TenantContext } from '@capiro/shared';
import { ProgramsService } from './programs.service.js';
import { PeProgramMatcherService } from '../matching/pe-program-matcher.service.js';

// The matcher is pure (no DB); reuse a real instance so aliasNormalized in the
// service matches the production normalizeAlias exactly.
const matcher = new PeProgramMatcherService();

/** Construct the service with the shared real matcher and a mock prisma. */
function makeSvc(prisma: unknown): ProgramsService {
  return new ProgramsService(prisma as never, matcher);
}

const ctx: TenantContext = {
  tenantId: '00000000-0000-0000-0000-000000000001',
  tenantSlug: 'capiro',
  userId: '00000000-0000-0000-0000-000000000002',
  clerkUserId: 'user_test',
  role: 'capiro_admin',
};

type MatchRow = {
  id: string;
  peCode: string;
  projectCode: string | null;
  programId: string;
  score: number;
  evidenceTier: string;
  status: string;
  weakSignal: boolean;
  evidence: unknown;
};

function makePrisma(match: MatchRow | null) {
  const auditLogCalls: Array<Record<string, unknown>> = [];
  const updateCalls: Array<{ where: unknown; data: Record<string, unknown> }> = [];
  return {
    __mock: { auditLogCalls, updateCalls },
    peProgramMatch: {
      findUnique: jest.fn(async () => match),
      update: jest.fn(async (args: { where: unknown; data: Record<string, unknown> }) => {
        updateCalls.push(args);
        return { ...(match as MatchRow), ...args.data };
      }),
    },
    withTenant: jest.fn(async (_tenantId: string, fn: (tx: { auditLog: { create: jest.Mock } }) => Promise<unknown>) =>
      fn({
        auditLog: {
          create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
            auditLogCalls.push(data);
            return data;
          }),
        },
      }),
    ),
  };
}

const candidate: MatchRow = {
  id: 'm1',
  peCode: '0604727N',
  projectCode: null,
  programId: 'prog-jsow',
  score: 0.82,
  evidenceTier: 'sam_match',
  status: 'candidate',
  weakSignal: false,
  evidence: [{ kind: 'alias_trigram:mdap_name', quote: "x ~ y" }],
};

describe('ProgramsService.resolveMatch — transitions', () => {
  test('accept -> status accepted, records resolver + audit log', async () => {
    const prisma = makePrisma(candidate);
    const svc = makeSvc(prisma);
    const res = await svc.resolveMatch('m1', { decision: 'accept', notes: 'looks right' }, ctx);

    expect(res).toEqual({ resolved: true, id: 'm1', status: 'accepted', decision: 'accept' });
    expect(prisma.__mock.updateCalls).toHaveLength(1);
    const data = prisma.__mock.updateCalls[0]!.data;
    expect(data.status).toBe('accepted');
    expect(data.resolvedByUserId).toBe(ctx.userId);
    expect(data.decisionNotes).toBe('looks right');
    expect(prisma.withTenant).toHaveBeenCalledWith(ctx.tenantId, expect.any(Function));
    expect(prisma.__mock.auditLogCalls).toHaveLength(1);
    expect(prisma.__mock.auditLogCalls[0]!.action).toBe('program.match.resolve');
    expect((prisma.__mock.auditLogCalls[0]!.after as Record<string, unknown>).status).toBe('accepted');
  });

  test('reject -> status rejected', async () => {
    const prisma = makePrisma(candidate);
    const svc = makeSvc(prisma);
    const res = await svc.resolveMatch('m1', { decision: 'reject' }, ctx);
    expect(res.status).toBe('rejected');
    expect(prisma.__mock.updateCalls[0]!.data.status).toBe('rejected');
  });

  test('quarantine -> status quarantined', async () => {
    const prisma = makePrisma(candidate);
    const svc = makeSvc(prisma);
    const res = await svc.resolveMatch('m1', { decision: 'quarantine' }, ctx);
    expect(res.status).toBe('quarantined');
  });

  test('empty notes is normalized to null', async () => {
    const prisma = makePrisma(candidate);
    const svc = makeSvc(prisma);
    await svc.resolveMatch('m1', { decision: 'accept', notes: '   ' }, ctx);
    expect(prisma.__mock.updateCalls[0]!.data.decisionNotes).toBeNull();
  });

  test('missing match -> NotFoundException', async () => {
    const prisma = makePrisma(null);
    const svc = makeSvc(prisma);
    await expect(svc.resolveMatch('nope', { decision: 'accept' }, ctx)).rejects.toBeInstanceOf(NotFoundException);
  });

  test('curated MDAP seed cannot be rejected via the review queue', async () => {
    const seed: MatchRow = { ...candidate, evidenceTier: 'mdap_curated', status: 'accepted', score: 1.0 };
    const prisma = makePrisma(seed);
    const svc = makeSvc(prisma);
    await expect(svc.resolveMatch('m1', { decision: 'reject' }, ctx)).rejects.toBeInstanceOf(BadRequestException);
    // No write happened.
    expect(prisma.__mock.updateCalls).toHaveLength(0);
  });

  test('accepting a weak-signal match clears the weakSignal flag', async () => {
    const weak: MatchRow = { ...candidate, score: 0.4, status: 'quarantined', weakSignal: true };
    const prisma = makePrisma(weak);
    const svc = makeSvc(prisma);
    await svc.resolveMatch('m1', { decision: 'accept' }, ctx);
    expect(prisma.__mock.updateCalls[0]!.data.weakSignal).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Step 3.5 — alias manager + program merge
// ─────────────────────────────────────────────────────────────────────────────

type AliasRow = {
  id: string;
  programId: string;
  alias: string;
  aliasNormalized: string;
  aliasType: string;
  source: string;
  sourceUrl?: string | null;
  confidence: number;
};

/** Mock prisma over an in-memory program_alias table, for the alias-manager specs. */
function makeAliasPrisma(opts: { aliases: AliasRow[]; programs?: Array<{ id: string }> }) {
  const aliases = [...opts.aliases];
  const programs = opts.programs ?? [{ id: 'prog-1' }];
  const auditLogCalls: Array<Record<string, unknown>> = [];
  const createdRows: AliasRow[] = [];
  const deletedIds: string[] = [];
  const updateCalls: Array<{ where: { id: string }; data: Record<string, unknown> }> = [];
  let nextId = 1;
  return {
    __mock: { auditLogCalls, createdRows, deletedIds, updateCalls, aliases },
    program: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
        programs.find((p) => p.id === where.id) ?? null,
      ),
    },
    programAlias: {
      findMany: jest.fn(async (args?: { where?: { programId?: string } }) => {
        const pid = args?.where?.programId;
        return aliases.filter((a) => (pid ? a.programId === pid : true));
      }),
      findFirst: jest.fn(
        async ({ where }: { where: { programId: string; aliasNormalized: string; aliasType: string; id?: { not: string } } }) =>
          aliases.find(
            (a) =>
              a.programId === where.programId &&
              a.aliasNormalized === where.aliasNormalized &&
              a.aliasType === where.aliasType &&
              (where.id?.not ? a.id !== where.id.not : true),
          ) ?? null,
      ),
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
        aliases.find((a) => a.id === where.id) ?? null,
      ),
      count: jest.fn(
        async ({ where }: { where: { programId: string; aliasType: string; id?: { not: string } } }) =>
          aliases.filter(
            (a) =>
              a.programId === where.programId &&
              a.aliasType === where.aliasType &&
              (where.id?.not ? a.id !== where.id.not : true),
          ).length,
      ),
      create: jest.fn(async ({ data }: { data: Omit<AliasRow, 'id'> }) => {
        const row: AliasRow = { id: `new-${nextId++}`, ...data };
        aliases.push(row);
        createdRows.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        updateCalls.push({ where, data });
        const row = aliases.find((a) => a.id === where.id)!;
        Object.assign(row, data);
        return row;
      }),
      delete: jest.fn(async ({ where }: { where: { id: string } }) => {
        deletedIds.push(where.id);
        const idx = aliases.findIndex((a) => a.id === where.id);
        const [removed] = aliases.splice(idx, 1);
        return removed;
      }),
    },
    withTenant: jest.fn(async (_tenantId: string, fn: (tx: { auditLog: { create: jest.Mock } }) => Promise<unknown>) =>
      fn({
        auditLog: {
          create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
            auditLogCalls.push(data);
            return data;
          }),
        },
      }),
    ),
  };
}

describe('ProgramsService — alias manager (Step 3.5)', () => {
  test('createAlias rejects a duplicate (programId, aliasNormalized, aliasType)', async () => {
    const prisma = makeAliasPrisma({
      aliases: [
        { id: 'a1', programId: 'prog-1', alias: 'JSOW', aliasNormalized: 'JSOW', aliasType: 'acronym', source: 'seed', confidence: 1 },
      ],
    });
    const svc = makeSvc(prisma);
    await expect(
      svc.createAlias('prog-1', { alias: 'jsow', aliasType: 'acronym' }, ctx),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.__mock.createdRows).toHaveLength(0);
  });

  test('createAlias computes aliasNormalized, defaults source/confidence, writes audit', async () => {
    const prisma = makeAliasPrisma({ aliases: [] });
    const svc = makeSvc(prisma);
    const ok = await svc.createAlias('prog-1', { alias: 'Joint  Stand-off Weapon!', aliasType: 'pe_title' }, ctx);
    expect(ok.aliasNormalized).toBe('JOINT STAND OFF WEAPON');
    expect(ok.source).toBe('analyst_manual');
    expect(ok.confidence).toBe(1.0);
    expect(prisma.__mock.auditLogCalls).toHaveLength(1);
    expect(prisma.__mock.auditLogCalls[0]!.action).toBe('program.alias.create');
  });

  test('createAlias rejects an unknown aliasType', async () => {
    const prisma = makeAliasPrisma({ aliases: [] });
    const svc = makeSvc(prisma);
    await expect(
      svc.createAlias('prog-1', { alias: 'x', aliasType: 'bogus' }, ctx),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.__mock.createdRows).toHaveLength(0);
  });

  test('updateAlias recomputes aliasNormalized and writes audit', async () => {
    const prisma = makeAliasPrisma({
      aliases: [
        { id: 'a1', programId: 'prog-1', alias: 'old name', aliasNormalized: 'OLD NAME', aliasType: 'pe_title', source: 'seed', confidence: 1 },
      ],
    });
    const svc = makeSvc(prisma);
    const updated = await svc.updateAlias('a1', { alias: 'New-Name 2' }, ctx);
    expect(updated.aliasNormalized).toBe('NEW NAME 2');
    expect(prisma.__mock.auditLogCalls[0]!.action).toBe('program.alias.update');
  });

  test('updateAlias rejects a collision with another alias on the program', async () => {
    const prisma = makeAliasPrisma({
      aliases: [
        { id: 'a1', programId: 'prog-1', alias: 'one', aliasNormalized: 'ONE', aliasType: 'acronym', source: 'seed', confidence: 1 },
        { id: 'a2', programId: 'prog-1', alias: 'two', aliasNormalized: 'TWO', aliasType: 'acronym', source: 'seed', confidence: 1 },
      ],
    });
    const svc = makeSvc(prisma);
    await expect(svc.updateAlias('a2', { alias: 'ONE' }, ctx)).rejects.toBeInstanceOf(BadRequestException);
  });

  test('deleteAlias removes and writes audit', async () => {
    const prisma = makeAliasPrisma({
      aliases: [
        { id: 'a1', programId: 'prog-1', alias: 'JSOW', aliasNormalized: 'JSOW', aliasType: 'acronym', source: 'seed', confidence: 1 },
        { id: 'a2', programId: 'prog-1', alias: 'Canon', aliasNormalized: 'CANON', aliasType: 'canonical', source: 'seed', confidence: 1 },
      ],
    });
    const svc = makeSvc(prisma);
    const res = await svc.deleteAlias('a1', ctx);
    expect(res).toEqual({ deleted: true, id: 'a1' });
    expect(prisma.__mock.deletedIds).toContain('a1');
    expect(prisma.__mock.auditLogCalls[0]!.action).toBe('program.alias.delete');
  });

  test('deleteAlias refuses the last canonical alias', async () => {
    const prisma = makeAliasPrisma({
      aliases: [
        { id: 'a1', programId: 'prog-1', alias: 'Canon', aliasNormalized: 'CANON', aliasType: 'canonical', source: 'seed', confidence: 1 },
        { id: 'a2', programId: 'prog-1', alias: 'JSOW', aliasNormalized: 'JSOW', aliasType: 'acronym', source: 'seed', confidence: 1 },
      ],
    });
    const svc = makeSvc(prisma);
    await expect(svc.deleteAlias('a1', ctx)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.__mock.deletedIds).toHaveLength(0);
  });
});

describe('ProgramsService.listDuplicateAliases (Step 3.5 / §13)', () => {
  test('finds an aliasNormalized that maps to two distinct programs', async () => {
    const prisma = {
      programAlias: {
        findMany: jest.fn(async () => [
          { id: 'a1', programId: 'prog-1', aliasNormalized: 'GHOST BAT' },
          { id: 'a2', programId: 'prog-2', aliasNormalized: 'GHOST BAT' },
          { id: 'a3', programId: 'prog-1', aliasNormalized: 'UNIQUE ONE' },
          // same program twice -> NOT a duplicate across programs.
          { id: 'a4', programId: 'prog-3', aliasNormalized: 'SOLO' },
          { id: 'a5', programId: 'prog-3', aliasNormalized: 'SOLO' },
        ]),
      },
      program: {
        findMany: jest.fn(async () => [
          { id: 'prog-1', canonicalName: 'Program One', status: 'active' },
          { id: 'prog-2', canonicalName: 'Program Two', status: 'active' },
        ]),
      },
    };
    const svc = makeSvc(prisma);
    const res = await svc.listDuplicateAliases();
    expect(res.total).toBe(1);
    expect(res.data[0]!.aliasNormalized).toBe('GHOST BAT');
    const progs = res.data[0]!.programs;
    expect(progs).toHaveLength(2);
    expect(progs.map((p) => p.programId).sort()).toEqual(['prog-1', 'prog-2']);
    expect(progs.find((p) => p.programId === 'prog-1')!.canonicalName).toBe('Program One');
    expect(progs.find((p) => p.programId === 'prog-1')!.aliasId).toBe('a1');
  });
});

// ── merge ──

type ProgramRow = { id: string; canonicalName: string; status: string; metadata: unknown };

/**
 * Mock prisma over in-memory program-graph tables for the merge spec. $transaction
 * runs the callback against the SAME tx object (so find/update/delete mutate the
 * shared arrays), mirroring an interactive transaction.
 */
function makeMergePrisma(seed: {
  programs: ProgramRow[];
  matches: Array<{ id: string; peCode: string; projectCode: string | null; programId: string }>;
  roles: Array<{ id: string; programId: string }>;
  officeLinks: Array<{ id: string; officeId: string; programId: string }>;
  provisionLinks: Array<{ id: string; provisionId: string; peCode: string | null; programId: string }>;
  aliases: Array<{ id: string; programId: string; aliasNormalized: string; aliasType: string }>;
}) {
  const programs = seed.programs.map((p) => ({ ...p }));
  const matches = seed.matches.map((m) => ({ ...m }));
  const roles = seed.roles.map((r) => ({ ...r }));
  const officeLinks = seed.officeLinks.map((l) => ({ ...l }));
  const provisionLinks = seed.provisionLinks.map((l) => ({ ...l }));
  const aliases = seed.aliases.map((a) => ({ ...a }));
  const auditLogCalls: Array<Record<string, unknown>> = [];

  const filterBy = <T extends { programId: string }>(rows: T[], where: { programId: string }) =>
    rows.filter((r) => r.programId === where.programId);

  const tx = {
    peProgramMatch: {
      findMany: jest.fn(async ({ where }: { where: { programId: string } }) => filterBy(matches, where)),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: { programId: string } }) => {
        const row = matches.find((m) => m.id === where.id)!;
        row.programId = data.programId;
        return row;
      }),
      delete: jest.fn(async ({ where }: { where: { id: string } }) => {
        const idx = matches.findIndex((m) => m.id === where.id);
        return matches.splice(idx, 1)[0];
      }),
    },
    personRole: {
      updateMany: jest.fn(async ({ where, data }: { where: { programId: string }; data: { programId: string } }) => {
        const hit = filterBy(roles, where);
        hit.forEach((r) => (r.programId = data.programId));
        return { count: hit.length };
      }),
    },
    programOfficeProgramLink: {
      findMany: jest.fn(async ({ where }: { where: { programId: string } }) => filterBy(officeLinks, where)),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: { programId: string } }) => {
        const row = officeLinks.find((l) => l.id === where.id)!;
        row.programId = data.programId;
        return row;
      }),
      delete: jest.fn(async ({ where }: { where: { id: string } }) => {
        const idx = officeLinks.findIndex((l) => l.id === where.id);
        return officeLinks.splice(idx, 1)[0];
      }),
    },
    provisionPeLink: {
      findMany: jest.fn(async ({ where }: { where: { programId: string } }) => filterBy(provisionLinks, where)),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: { programId: string } }) => {
        const row = provisionLinks.find((l) => l.id === where.id)!;
        row.programId = data.programId;
        return row;
      }),
      delete: jest.fn(async ({ where }: { where: { id: string } }) => {
        const idx = provisionLinks.findIndex((l) => l.id === where.id);
        return provisionLinks.splice(idx, 1)[0];
      }),
    },
    programAlias: {
      findMany: jest.fn(async ({ where }: { where: { programId: string } }) => filterBy(aliases, where)),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: { programId: string } }) => {
        const row = aliases.find((a) => a.id === where.id)!;
        row.programId = data.programId;
        return row;
      }),
    },
    program: {
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = programs.find((p) => p.id === where.id)!;
        Object.assign(row, data);
        return row;
      }),
    },
  };

  return {
    __mock: { programs, matches, roles, officeLinks, provisionLinks, aliases, auditLogCalls, tx },
    program: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
        programs.find((p) => p.id === where.id) ?? null,
      ),
    },
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    withTenant: jest.fn(async (_t: string, fn: (t: { auditLog: { create: jest.Mock } }) => Promise<unknown>) =>
      fn({
        auditLog: {
          create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
            auditLogCalls.push(data);
            return data;
          }),
        },
      }),
    ),
  };
}

describe('ProgramsService.mergePrograms (Step 3.5)', () => {
  test('re-points all 4 FK tables, deletes colliding rows, copies aliases, retires loser, audits', async () => {
    const prisma = makeMergePrisma({
      programs: [
        { id: 'keep', canonicalName: 'Keeper', status: 'active', metadata: { note: 'x' } },
        { id: 'lose', canonicalName: 'Loser', status: 'active', metadata: {} },
      ],
      matches: [
        // re-pointable (no collision on the keeper)
        { id: 'mm1', peCode: '0604727N', projectCode: null, programId: 'lose' },
        // COLLISION: keeper already has (PE 0604111A, proj null) -> loser row deleted
        { id: 'mm2', peCode: '0604111A', projectCode: null, programId: 'lose' },
        // keeper's existing colliding row
        { id: 'mk1', peCode: '0604111A', projectCode: null, programId: 'keep' },
      ],
      roles: [
        { id: 'r1', programId: 'lose' },
        { id: 'r2', programId: 'lose' },
      ],
      officeLinks: [{ id: 'ol1', officeId: 'off-1', programId: 'lose' }],
      provisionLinks: [{ id: 'pl1', provisionId: 'prov-1', peCode: '0604727N', programId: 'lose' }],
      aliases: [
        // non-duplicate -> copied (re-pointed)
        { id: 'al1', programId: 'lose', aliasNormalized: 'LOSER NAME', aliasType: 'pe_title' },
        // duplicate with keeper -> left behind
        { id: 'al2', programId: 'lose', aliasNormalized: 'SHARED', aliasType: 'acronym' },
        { id: 'ak1', programId: 'keep', aliasNormalized: 'SHARED', aliasType: 'acronym' },
      ],
    });
    const svc = makeSvc(prisma);
    const res = await svc.mergePrograms({ keepProgramId: 'keep', mergeProgramId: 'lose' }, ctx);

    expect(res.merged).toBe(true);
    expect(res.keepProgramId).toBe('keep');
    expect(res.mergeProgramId).toBe('lose');
    // matches: mm1 re-pointed, mm2 deleted (collision) -> 1 re-pointed
    expect(res.repointed.matches).toBe(1);
    expect(res.repointed.roles).toBe(2);
    expect(res.repointed.officeLinks).toBe(1);
    expect(res.repointed.provisionLinks).toBe(1);
    // al1 copied; al2 left behind (duplicate)
    expect(res.aliasesCopied).toBe(1);

    // The colliding loser match row was DELETED, not re-pointed.
    expect(prisma.__mock.matches.find((m) => m.id === 'mm2')).toBeUndefined();
    expect(prisma.__mock.matches.find((m) => m.id === 'mm1')!.programId).toBe('keep');

    // Loser retired with metadata.
    const loser = prisma.__mock.programs.find((p) => p.id === 'lose')!;
    expect(loser.status).toBe('merged');
    expect((loser.metadata as Record<string, unknown>).mergedInto).toBe('keep');
    expect((loser.metadata as Record<string, unknown>).mergedAt).toBeTruthy();

    // The non-duplicate alias was re-pointed; the duplicate stayed on the loser.
    expect(prisma.__mock.aliases.find((a) => a.id === 'al1')!.programId).toBe('keep');
    expect(prisma.__mock.aliases.find((a) => a.id === 'al2')!.programId).toBe('lose');

    // Audit written.
    expect(prisma.withTenant).toHaveBeenCalledWith(ctx.tenantId, expect.any(Function));
    expect(prisma.__mock.auditLogCalls).toHaveLength(1);
    expect(prisma.__mock.auditLogCalls[0]!.action).toBe('program.merge');
    expect(prisma.__mock.auditLogCalls[0]!.entityId).toBe('lose');
  });

  test('refuses merging a program into itself', async () => {
    const prisma = makeMergePrisma({
      programs: [{ id: 'p1', canonicalName: 'P', status: 'active', metadata: {} }],
      matches: [], roles: [], officeLinks: [], provisionLinks: [], aliases: [],
    });
    const svc = makeSvc(prisma);
    await expect(
      svc.mergePrograms({ keepProgramId: 'p1', mergeProgramId: 'p1' }, ctx),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  test('refuses merging an already-merged program', async () => {
    const prisma = makeMergePrisma({
      programs: [
        { id: 'keep', canonicalName: 'K', status: 'active', metadata: {} },
        { id: 'lose', canonicalName: 'L', status: 'merged', metadata: { mergedInto: 'other' } },
      ],
      matches: [], roles: [], officeLinks: [], provisionLinks: [], aliases: [],
    });
    const svc = makeSvc(prisma);
    await expect(
      svc.mergePrograms({ keepProgramId: 'keep', mergeProgramId: 'lose' }, ctx),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  test('NotFound when a program does not exist', async () => {
    const prisma = makeMergePrisma({
      programs: [{ id: 'keep', canonicalName: 'K', status: 'active', metadata: {} }],
      matches: [], roles: [], officeLinks: [], provisionLinks: [], aliases: [],
    });
    const svc = makeSvc(prisma);
    await expect(
      svc.mergePrograms({ keepProgramId: 'keep', mergeProgramId: 'ghost' }, ctx),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
