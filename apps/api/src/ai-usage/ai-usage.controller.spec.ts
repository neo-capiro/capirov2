import { describe, expect, it, jest } from '@jest/globals';
import 'reflect-metadata';
import type { TenantContext } from '@capiro/shared';
import { AiUsageController } from './ai-usage.controller.js';
import { ROLES_KEY } from '../auth/roles.decorator.js';

const ctx: TenantContext = {
  tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  tenantSlug: 'alpha',
  userId: 'u1',
  clerkUserId: 'ck1',
  role: 'user_admin',
};

function makeController() {
  const usage = {
    tenantSummary: jest.fn(async () => ({ totalCostUsd: 1.23, byWorkflow: [] })),
    tenantRecentEvents: jest.fn(async () => []),
  };
  const store = {
    list: jest.fn(async () => [
      { provider: 'openai', last4: '9876', modelOverride: null, status: 'active' },
    ]),
    upsert: jest.fn(),
    remove: jest.fn(),
  };
  const controller = new AiUsageController(usage as never, store as never);
  return { controller, usage, store };
}

describe('AiUsageController role gating', () => {
  it('is gated to tenant admins (user_admin and above) at the controller level', () => {
    expect(Reflect.getMetadata(ROLES_KEY, AiUsageController)).toEqual(['user_admin']);
  });
});

describe('AiUsageController usage reads', () => {
  it('passes the tenant ctx and parsed range to tenantSummary', async () => {
    const { controller, usage } = makeController();
    await controller.summary(ctx, { from: '2026-06-01T00:00:00Z', to: '2026-06-11T00:00:00Z' });
    expect(usage.tenantSummary).toHaveBeenCalledWith(ctx, {
      from: new Date('2026-06-01T00:00:00Z'),
      to: new Date('2026-06-11T00:00:00Z'),
    });
  });

  it('passes the limit to tenantRecentEvents', async () => {
    const { controller, usage } = makeController();
    await controller.events(ctx, { limit: 10 });
    expect(usage.tenantRecentEvents).toHaveBeenCalledWith(ctx, { limit: 10 });
  });
});

describe('AiUsageController credentials are READ-ONLY for tenants', () => {
  it('lists masked credentials for the caller tenant only', async () => {
    const { controller, store } = makeController();
    const result = await controller.listCredentials(ctx);
    expect(store.list).toHaveBeenCalledWith(ctx.tenantId);
    expect(JSON.stringify(result)).not.toContain('apiKey');
  });

  it('exposes NO tenant-side write endpoints — key management is capiro-admin only', () => {
    const { controller } = makeController();
    // Product rule: Capiro sets keys for customers, never the customer.
    // The write surface lives exclusively on capiro-admin.controller.
    expect((controller as unknown as Record<string, unknown>).saveCredential).toBeUndefined();
    expect((controller as unknown as Record<string, unknown>).removeCredential).toBeUndefined();
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(controller));
    expect(methods.sort()).toEqual(['constructor', 'events', 'listCredentials', 'summary'].sort());
  });
});
