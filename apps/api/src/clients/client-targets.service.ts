import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { TenantContext } from '@capiro/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { DirectoryService } from '../directory/directory.service.js';

export interface AddTargetInput {
  memberId: string;
  source?: string;
}

/**
 * Client Targets CRUD. A target is a congressional office (directory member) a
 * team intends to engage for a client. Firm-wide per client (tenant-scoped, RLS).
 *
 * The directory is an in-memory snapshot hydrated from S3, NOT a Postgres table,
 * so we cannot FK member_id. Instead, on add we look the member up in the cached
 * directory and DENORMALIZE a compact snapshot (name/party/state/chamber/
 * committee) onto the row. That lets the portfolio card pills and Targets list
 * render without a directory round-trip and keeps them stable across directory
 * refreshes. If the member id is unknown (e.g. a stale client), the target is
 * still stored with whatever snapshot fields the caller knows — id alone is
 * enough to identify it.
 */
@Injectable()
export class ClientTargetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly directory: DirectoryService,
  ) {}

  private async assertClient(tx: any, ctx: TenantContext, clientId: string) {
    const client = await tx.client.findFirst({
      where: { id: clientId, tenantId: ctx.tenantId, status: { not: 'archived' } },
      select: { id: true },
    });
    if (!client) throw new NotFoundException('Client not found');
  }

  async listTargets(ctx: TenantContext, clientId: string) {
    return this.prisma.withTenant(ctx.tenantId, async (tx) => {
      await this.assertClient(tx, ctx, clientId);
      return tx.clientTarget.findMany({
        where: { tenantId: ctx.tenantId, clientId },
        orderBy: { addedAt: 'asc' },
      });
    });
  }

  async addTarget(ctx: TenantContext, clientId: string, input: AddTargetInput) {
    const memberId = (input.memberId ?? '').trim();
    if (!memberId) throw new BadRequestException('memberId is required');
    const source = input.source === 'meri' ? 'meri' : 'manual';

    // Denormalize a member snapshot from the cached directory (best-effort).
    let snapshot: {
      memberName: string | null;
      party: string | null;
      state: string | null;
      chamber: string | null;
      committee: string | null;
    } = { memberName: null, party: null, state: null, chamber: null, committee: null };
    try {
      const contacts = await this.directory.getAllContacts();
      const m = contacts.find((c) => c.id === memberId);
      if (m) {
        snapshot = {
          memberName: m.fullName ?? null,
          party: m.party ?? null,
          // House includes district (e.g. "TX-12"); Senate is the bare state.
          state:
            m.chamber === 'House' && m.district
              ? m.district.includes('-')
                ? m.district
                : `${m.state}-${m.district}`
              : m.state ?? null,
          chamber: m.chamber ?? null,
          committee: m.committees?.[0] ?? null,
        };
      }
    } catch {
      // Directory unavailable — store the id-only target; the UI can still
      // resolve display fields from its own member cache.
    }

    return this.prisma.withTenant(ctx.tenantId, async (tx) => {
      await this.assertClient(tx, ctx, clientId);
      const existing = await tx.clientTarget.findFirst({
        where: { clientId, memberId },
        select: { id: true },
      });
      // Idempotent add: a duplicate is not an error (the UI fires optimistically).
      if (existing) {
        return tx.clientTarget.findUnique({ where: { id: existing.id } });
      }
      return tx.clientTarget.create({
        data: {
          tenantId: ctx.tenantId,
          clientId,
          memberId,
          memberName: snapshot.memberName,
          party: snapshot.party,
          state: snapshot.state,
          chamber: snapshot.chamber,
          committee: snapshot.committee,
          source,
          addedByUserId: ctx.userId ?? null,
        },
      });
    });
  }

  async removeTarget(ctx: TenantContext, clientId: string, memberId: string) {
    return this.prisma.withTenant(ctx.tenantId, async (tx) => {
      await this.assertClient(tx, ctx, clientId);
      const existing = await tx.clientTarget.findFirst({
        where: { clientId, memberId },
        select: { id: true },
      });
      // Idempotent remove: absent target is a no-op success (optimistic UI).
      if (!existing) return { deleted: true };
      await tx.clientTarget.delete({ where: { id: existing.id } });
      return { deleted: true };
    });
  }
}
