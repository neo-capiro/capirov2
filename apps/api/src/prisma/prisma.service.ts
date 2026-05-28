import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

/**
 * RLS-aware Prisma client.
 *
 * Direct use of `this.prisma.user.findMany()` (without a tenant scope) is the
 * "system" path: it runs with `app.current_tenant` unset, so RLS-protected
 * tables return zero rows. That fail-closed default is intentional.
 *
 * Per-request tenant-scoped queries go through `withTenant(tenantId, fn)`.
 * That opens a transaction, sets the GUC with `SET LOCAL`, and hands the
 * caller a transactional client. When the transaction commits, the GUC is
 * automatically discarded — no leakage between requests.
 *
 * `withSystem(fn)` is the same pattern but with the bypass flag set, used
 * for cross-tenant admin work and webhook ingestion. Use sparingly and
 * always log via the audit_logs table.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Prisma connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Run `fn` with `app.current_tenant` set to the given UUID inside a
   * transaction. The transactional client passed to `fn` MUST be used for
   * any query that should respect the tenant scope.
   */
  async withTenant<T>(
    tenantId: string,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
    opts?: { timeoutMs?: number },
  ): Promise<T> {
    return this.$transaction(
      async (tx) => {
        // SET LOCAL is bound to the transaction. set_config(..., true) returns
        // the value, which we discard. Parameter binding via $executeRaw is
        // safe against injection.
        await tx.$executeRaw`SELECT set_config('app.current_tenant', ${tenantId}, true)`;
        return fn(tx);
      },
      // Prisma's interactive-transaction default is 5000 ms. Most tenant
      // queries finish in <100 ms, but a few SQL graph helpers (e.g.
      // kg_walk in intelligence.service.getKnowledgeGraph) can take
      // several seconds on warm Aurora and were producing
      //   "Transaction already closed: ... however 8061 ms passed since
      //    the start of the transaction"
      // every time the intel tab loaded. Callers can pass a higher
      // timeoutMs for known-slow paths.
      opts?.timeoutMs ? { timeout: opts.timeoutMs } : undefined,
    );
  }

  /**
   * Run `fn` with the RLS bypass flag enabled. Use only for trusted server
   * paths (cross-tenant admin tooling, webhook ingestion, migrations).
   */
  async withSystem<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
      return fn(tx);
    });
  }
}
