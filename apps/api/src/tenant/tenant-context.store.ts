import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { TenantContext } from '@capiro/shared';

/**
 * Per-request tenant context propagated via AsyncLocalStorage. Filled in by
 * TenantContextMiddleware after Clerk verification + membership lookup.
 *
 * Read with `store.get()` from any service. Returns undefined for unauth
 * routes (health, webhooks).
 */
@Injectable()
export class TenantContextStore {
  private readonly als = new AsyncLocalStorage<TenantContext>();

  run<T>(ctx: TenantContext, fn: () => T): T {
    return this.als.run(ctx, fn);
  }

  get(): TenantContext | undefined {
    return this.als.getStore();
  }

  require(): TenantContext {
    const ctx = this.get();
    if (!ctx) {
      throw new Error('Tenant context not set, route is missing TenantContextMiddleware');
    }
    return ctx;
  }
}
