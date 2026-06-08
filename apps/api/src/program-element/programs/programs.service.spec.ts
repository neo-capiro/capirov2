import { describe, expect, test } from '@jest/globals';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { TenantContext } from '@capiro/shared';
import { ProgramsService } from './programs.service.js';

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
    const svc = new ProgramsService(prisma as never);
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
    const svc = new ProgramsService(prisma as never);
    const res = await svc.resolveMatch('m1', { decision: 'reject' }, ctx);
    expect(res.status).toBe('rejected');
    expect(prisma.__mock.updateCalls[0]!.data.status).toBe('rejected');
  });

  test('quarantine -> status quarantined', async () => {
    const prisma = makePrisma(candidate);
    const svc = new ProgramsService(prisma as never);
    const res = await svc.resolveMatch('m1', { decision: 'quarantine' }, ctx);
    expect(res.status).toBe('quarantined');
  });

  test('empty notes is normalized to null', async () => {
    const prisma = makePrisma(candidate);
    const svc = new ProgramsService(prisma as never);
    await svc.resolveMatch('m1', { decision: 'accept', notes: '   ' }, ctx);
    expect(prisma.__mock.updateCalls[0]!.data.decisionNotes).toBeNull();
  });

  test('missing match -> NotFoundException', async () => {
    const prisma = makePrisma(null);
    const svc = new ProgramsService(prisma as never);
    await expect(svc.resolveMatch('nope', { decision: 'accept' }, ctx)).rejects.toBeInstanceOf(NotFoundException);
  });

  test('curated MDAP seed cannot be rejected via the review queue', async () => {
    const seed: MatchRow = { ...candidate, evidenceTier: 'mdap_curated', status: 'accepted', score: 1.0 };
    const prisma = makePrisma(seed);
    const svc = new ProgramsService(prisma as never);
    await expect(svc.resolveMatch('m1', { decision: 'reject' }, ctx)).rejects.toBeInstanceOf(BadRequestException);
    // No write happened.
    expect(prisma.__mock.updateCalls).toHaveLength(0);
  });

  test('accepting a weak-signal match clears the weakSignal flag', async () => {
    const weak: MatchRow = { ...candidate, score: 0.4, status: 'quarantined', weakSignal: true };
    const prisma = makePrisma(weak);
    const svc = new ProgramsService(prisma as never);
    await svc.resolveMatch('m1', { decision: 'accept' }, ctx);
    expect(prisma.__mock.updateCalls[0]!.data.weakSignal).toBe(false);
  });
});
