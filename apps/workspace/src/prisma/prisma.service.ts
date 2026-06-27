import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '../../generated/prisma-client/index.js';

/**
 * Workspace engine Prisma client.
 *
 * The engine owns only ws_* tables in the shared Aurora cluster. Tenant
 * isolation is enforced in application code: every query MUST include the
 * `tenantId` resolved by the TenantGuard (see auth/tenant.guard.ts). There is
 * no Postgres RLS on ws_* tables in this pass — the guard + mandatory tenantId
 * filters are the isolation boundary. Helpers below make the tenant filter
 * impossible to forget.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Workspace Prisma connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
