import { Injectable, NotFoundException } from '@nestjs/common';
import type { TenantContext } from '@capiro/shared';
import { PrismaService } from '../prisma/prisma.service.js';

export interface CreateClientInput {
  name: string;
  website?: string;
  description?: string;
  productDescription?: string;
  primaryContactName?: string;
  primaryContactEmail?: string;
  primaryContactPhone?: string;
  intakeData?: Record<string, unknown>;
}

export type UpdateClientInput = Partial<CreateClientInput> & { status?: string };

/**
 * The lobbying firm's book of business. Tenant-scoped via RLS — the database
 * itself enforces isolation, the service just wires `withTenant` so the GUC
 * is set on every query.
 */
@Injectable()
export class ClientsService {
  constructor(private readonly prisma: PrismaService) {}

  list(ctx: TenantContext) {
    return this.prisma.withTenant(ctx.tenantId, (tx) =>
      tx.client.findMany({ orderBy: { createdAt: 'desc' } }),
    );
  }

  async get(ctx: TenantContext, id: string) {
    const client = await this.prisma.withTenant(ctx.tenantId, (tx) =>
      tx.client.findUnique({ where: { id } }),
    );
    if (!client) throw new NotFoundException('Client not found');
    return client;
  }

  create(ctx: TenantContext, input: CreateClientInput) {
    return this.prisma.withTenant(ctx.tenantId, (tx) =>
      tx.client.create({
        data: {
          tenantId: ctx.tenantId,
          name: input.name,
          website: input.website ?? null,
          description: input.description ?? null,
          productDescription: input.productDescription ?? null,
          primaryContactName: input.primaryContactName ?? null,
          primaryContactEmail: input.primaryContactEmail ?? null,
          primaryContactPhone: input.primaryContactPhone ?? null,
          intakeData: (input.intakeData ?? {}) as object,
          createdByUserId: ctx.userId,
        },
      }),
    );
  }

  update(ctx: TenantContext, id: string, input: UpdateClientInput) {
    return this.prisma.withTenant(ctx.tenantId, (tx) =>
      tx.client.update({
        where: { id },
        data: {
          ...('name' in input ? { name: input.name } : {}),
          ...('website' in input ? { website: input.website ?? null } : {}),
          ...('description' in input ? { description: input.description ?? null } : {}),
          ...('productDescription' in input
            ? { productDescription: input.productDescription ?? null }
            : {}),
          ...('primaryContactName' in input
            ? { primaryContactName: input.primaryContactName ?? null }
            : {}),
          ...('primaryContactEmail' in input
            ? { primaryContactEmail: input.primaryContactEmail ?? null }
            : {}),
          ...('primaryContactPhone' in input
            ? { primaryContactPhone: input.primaryContactPhone ?? null }
            : {}),
          ...('intakeData' in input ? { intakeData: (input.intakeData ?? {}) as object } : {}),
          ...('status' in input ? { status: input.status! } : {}),
        },
      }),
    );
  }

  archive(ctx: TenantContext, id: string) {
    return this.update(ctx, id, { status: 'archived' });
  }
}
