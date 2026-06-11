import { Injectable, NotFoundException } from '@nestjs/common';
import type { TenantContext } from '@capiro/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { ClientKbService } from '../embeddings/client-kb.service.js';

export interface CreatePersonInput {
  name: string;
  title?: string;
  email?: string;
  phone?: string;
  role?: string;
  lastContact?: string;
  notes?: string;
}

export type UpdatePersonInput = Partial<CreatePersonInput>;

@Injectable()
export class ClientPeopleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clientKb: ClientKbService,
  ) {}

  async listPeople(ctx: TenantContext, clientId: string) {
    return this.prisma.withTenant(ctx.tenantId, async (tx) => {
      const client = await tx.client.findFirst({
        where: { id: clientId, tenantId: ctx.tenantId, status: { not: 'archived' } },
        select: { id: true },
      });
      if (!client) throw new NotFoundException('Client not found');
      return tx.clientPerson.findMany({
        where: { tenantId: ctx.tenantId, clientId },
        orderBy: { createdAt: 'asc' },
      });
    });
  }

  async createPerson(ctx: TenantContext, clientId: string, input: CreatePersonInput) {
    const person = await this.prisma.withTenant(ctx.tenantId, async (tx) => {
      const client = await tx.client.findFirst({
        where: { id: clientId, tenantId: ctx.tenantId, status: { not: 'archived' } },
        select: { id: true },
      });
      if (!client) throw new NotFoundException('Client not found');
      return tx.clientPerson.create({
        data: {
          tenantId: ctx.tenantId,
          clientId,
          name: input.name,
          title: input.title ?? null,
          email: input.email ?? null,
          phone: input.phone ?? null,
          role: input.role ?? null,
          lastContact: input.lastContact ? new Date(input.lastContact) : null,
          notes: input.notes ?? null,
        },
      });
    });
    // Client KB (F5): keep retrieval in sync with the People tab.
    this.clientKb.indexPersonFireAndForget(ctx.tenantId, person.id);
    return person;
  }

  async updatePerson(ctx: TenantContext, clientId: string, id: string, input: UpdatePersonInput) {
    const person = await this.prisma.withTenant(ctx.tenantId, async (tx) => {
      const existing = await tx.clientPerson.findFirst({
        where: { id, tenantId: ctx.tenantId, clientId },
        select: { id: true },
      });
      if (!existing) throw new NotFoundException('Person not found');
      return tx.clientPerson.update({
        where: { id },
        data: {
          ...('name' in input ? { name: input.name } : {}),
          ...('title' in input ? { title: input.title ?? null } : {}),
          ...('email' in input ? { email: input.email ?? null } : {}),
          ...('phone' in input ? { phone: input.phone ?? null } : {}),
          ...('role' in input ? { role: input.role ?? null } : {}),
          ...('lastContact' in input
            ? { lastContact: input.lastContact ? new Date(input.lastContact) : null }
            : {}),
          ...('notes' in input ? { notes: input.notes ?? null } : {}),
        },
      });
    });
    this.clientKb.indexPersonFireAndForget(ctx.tenantId, person.id);
    return person;
  }

  async deletePerson(ctx: TenantContext, clientId: string, id: string) {
    const result = await this.prisma.withTenant(ctx.tenantId, async (tx) => {
      const existing = await tx.clientPerson.findFirst({
        where: { id, tenantId: ctx.tenantId, clientId },
        select: { id: true },
      });
      if (!existing) throw new NotFoundException('Person not found');
      await tx.clientPerson.delete({ where: { id } });
      return { deleted: true };
    });
    this.clientKb.purgeFireAndForget(ctx.tenantId, 'client_person', id);
    return result;
  }
}
