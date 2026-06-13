// Outreach 2.0 saved audiences (lists/groups): ownership scoping + member
// normalization. The service methods only touch this.prisma, so the tests
// build a minimal service object with a stub withTenant instead of wiring
// the full EngagementService constructor graph.

import { describe, expect, test } from '@jest/globals';
import { BadRequestException } from '@nestjs/common';
import type { TenantContext } from '@capiro/shared';
import { EngagementService } from './engagement.service.js';

const ctx: TenantContext = {
  tenantId: 'tenant-1',
  tenantSlug: 'capiro',
  userId: 'user-1',
  clerkUserId: 'clerk-1',
  role: 'standard_user',
} as TenantContext;

function serviceWith(tx: Record<string, unknown>): EngagementService {
  const prisma = {
    withTenant: (_tenantId: string, fn: (scoped: unknown) => unknown) => fn(tx),
  };
  // Real prototype (so the methods under test exist) over a stub `prisma` —
  // skips the heavy constructor dependency graph.
  const service = Object.create(EngagementService.prototype) as EngagementService;
  (service as unknown as { prisma: unknown }).prisma = prisma;
  return service;
}

describe('listOutreachAudiences', () => {
  test('scopes to the tenant + owning user, hides archived, filters by kind', async () => {
    let captured: Record<string, unknown> | undefined;
    const service = serviceWith({
      outreachAudience: {
        findMany: async (args: Record<string, unknown>) => {
          captured = args;
          return [];
        },
      },
    });

    await service.listOutreachAudiences(ctx, 'list');

    expect(captured).toBeDefined();
    expect(captured!.where).toEqual({
      tenantId: 'tenant-1',
      createdByUserId: 'user-1',
      status: { not: 'archived' },
      kind: 'list',
    });
    expect(captured!.include).toEqual({
      members: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
    });
  });

  test('omits the kind filter when not provided', async () => {
    let captured: { where?: Record<string, unknown> } = {};
    const service = serviceWith({
      outreachAudience: {
        findMany: async (args: { where?: Record<string, unknown> }) => {
          captured = args;
          return [];
        },
      },
    });

    await service.listOutreachAudiences(ctx);

    expect(captured.where).not.toHaveProperty('kind');
  });
});

describe('createOutreachAudience', () => {
  const baseInput = {
    kind: 'list' as const,
    name: '  HASC staffers Q3  ',
    members: [
      {
        source: 'congress' as const,
        sourceRefId: 'member-1:staff-2',
        name: '  Jordan Smith ',
        email: 'Jordan.Smith@MAIL.HOUSE.GOV',
        title: ' Legislative Director ',
        office: '',
      },
      {
        source: 'manual' as const,
        email: 'jane@example.com',
      },
    ],
  };

  test('creates an active, user-owned audience with normalized members', async () => {
    let captured: { data?: Record<string, unknown> } = {};
    const service = serviceWith({
      outreachAudience: {
        create: async (args: { data?: Record<string, unknown> }) => {
          captured = args;
          return { id: 'aud-1', members: [] };
        },
      },
    });

    await service.createOutreachAudience(ctx, baseInput);

    const data = captured.data!;
    expect(data.tenantId).toBe('tenant-1');
    expect(data.createdByUserId).toBe('user-1');
    expect(data.kind).toBe('list');
    expect(data.name).toBe('HASC staffers Q3');
    expect(data.status).toBe('active');
    const members = (data.members as { create: Array<Record<string, unknown>> }).create;
    expect(members).toEqual([
      {
        tenantId: 'tenant-1',
        source: 'congress',
        sourceRefId: 'member-1:staff-2',
        name: 'Jordan Smith',
        email: 'jordan.smith@mail.house.gov',
        title: 'Legislative Director',
        office: null,
      },
      {
        tenantId: 'tenant-1',
        source: 'manual',
        sourceRefId: null,
        name: null,
        email: 'jane@example.com',
        title: null,
        office: null,
      },
    ]);
  });

  test('rejects a blank name and an empty member set', () => {
    const service = serviceWith({});
    expect(() => service.createOutreachAudience(ctx, { ...baseInput, name: '   ' })).toThrow(
      BadRequestException,
    );
    expect(() => service.createOutreachAudience(ctx, { ...baseInput, members: [] })).toThrow(
      BadRequestException,
    );
  });
});
