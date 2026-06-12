import { describe, expect, it, jest } from '@jest/globals';
import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
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
    upsert: jest.fn(async () => ({
      provider: 'openai',
      last4: '9876',
      modelOverride: null,
      status: 'active',
    })),
    remove: jest.fn(async () => ({ removed: true })),
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

describe('AiUsageController credentials', () => {
  it('saves through the store scoped to the caller tenant and never echoes the key', async () => {
    const { controller, store } = makeController();
    const result = await controller.saveCredential(ctx, {
      provider: 'openai',
      apiKey: 'sk-proj-supersecret-9876',
      modelOverride: 'gpt-4.1',
    });
    expect(store.upsert).toHaveBeenCalledWith(ctx.tenantId, {
      provider: 'openai',
      apiKey: 'sk-proj-supersecret-9876',
      modelOverride: 'gpt-4.1',
      createdByUserId: ctx.userId,
    });
    expect(JSON.stringify(result)).not.toContain('supersecret');
  });

  it('lists masked credentials for the caller tenant only', async () => {
    const { controller, store } = makeController();
    const result = await controller.listCredentials(ctx);
    expect(store.list).toHaveBeenCalledWith(ctx.tenantId);
    expect(JSON.stringify(result)).not.toContain('apiKey');
  });

  it('removes a credential for the caller tenant', async () => {
    const { controller, store } = makeController();
    await expect(controller.removeCredential(ctx, 'openai')).resolves.toEqual({ removed: true });
    expect(store.remove).toHaveBeenCalledWith(ctx.tenantId, 'openai');
  });

  it('rejects an unknown provider param on delete', () => {
    const { controller } = makeController();
    expect(() => controller.removeCredential(ctx, 'gemini')).toThrow(BadRequestException);
  });
});
