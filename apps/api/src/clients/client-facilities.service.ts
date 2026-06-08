import { Injectable, NotFoundException } from '@nestjs/common';
import type { TenantContext } from '@capiro/shared';
import { PrismaService } from '../prisma/prisma.service.js';

export interface CreateFacilityInput {
  name: string;
  addressLine?: string;
  city?: string;
  state?: string;
  zip?: string;
  // Bare district number ("12"), state lives in `state`. Evidence strings
  // may print "TX-12" by combining the two; we never store the joined form.
  congressionalDistrict?: string;
  // How the district was determined: 'user' (manually entered) or 'geocoded'
  // (derived from the address). Defaults to 'user' when omitted on create.
  districtSource?: string;
  employeeCount?: number;
  notes?: string;
}

export type UpdateFacilityInput = Partial<CreateFacilityInput>;

@Injectable()
export class ClientFacilitiesService {
  constructor(private readonly prisma: PrismaService) {}

  async listFacilities(ctx: TenantContext, clientId: string) {
    return this.prisma.withTenant(ctx.tenantId, async (tx) => {
      const client = await tx.client.findFirst({
        where: { id: clientId, tenantId: ctx.tenantId, status: { not: 'archived' } },
        select: { id: true },
      });
      if (!client) throw new NotFoundException('Client not found');
      return tx.clientFacility.findMany({
        where: { tenantId: ctx.tenantId, clientId },
        orderBy: { createdAt: 'asc' },
      });
    });
  }

  async createFacility(ctx: TenantContext, clientId: string, input: CreateFacilityInput) {
    return this.prisma.withTenant(ctx.tenantId, async (tx) => {
      const client = await tx.client.findFirst({
        where: { id: clientId, tenantId: ctx.tenantId, status: { not: 'archived' } },
        select: { id: true },
      });
      if (!client) throw new NotFoundException('Client not found');
      return tx.clientFacility.create({
        data: {
          tenantId: ctx.tenantId,
          clientId,
          name: input.name,
          addressLine: input.addressLine ?? null,
          city: input.city ?? null,
          state: input.state ?? null,
          zip: input.zip ?? null,
          congressionalDistrict: input.congressionalDistrict ?? null,
          districtSource: input.districtSource ?? 'user',
          employeeCount: input.employeeCount ?? null,
          notes: input.notes ?? null,
        },
      });
    });
  }

  async updateFacility(
    ctx: TenantContext,
    clientId: string,
    id: string,
    input: UpdateFacilityInput,
  ) {
    return this.prisma.withTenant(ctx.tenantId, async (tx) => {
      const existing = await tx.clientFacility.findFirst({
        where: { id, tenantId: ctx.tenantId, clientId },
        select: { id: true },
      });
      if (!existing) throw new NotFoundException('Facility not found');
      return tx.clientFacility.update({
        where: { id },
        data: {
          ...('name' in input ? { name: input.name } : {}),
          ...('addressLine' in input ? { addressLine: input.addressLine ?? null } : {}),
          ...('city' in input ? { city: input.city ?? null } : {}),
          ...('state' in input ? { state: input.state ?? null } : {}),
          ...('zip' in input ? { zip: input.zip ?? null } : {}),
          ...('congressionalDistrict' in input
            ? { congressionalDistrict: input.congressionalDistrict ?? null }
            : {}),
          ...('districtSource' in input ? { districtSource: input.districtSource ?? null } : {}),
          ...('employeeCount' in input ? { employeeCount: input.employeeCount ?? null } : {}),
          ...('notes' in input ? { notes: input.notes ?? null } : {}),
        },
      });
    });
  }

  async deleteFacility(ctx: TenantContext, clientId: string, id: string) {
    return this.prisma.withTenant(ctx.tenantId, async (tx) => {
      const existing = await tx.clientFacility.findFirst({
        where: { id, tenantId: ctx.tenantId, clientId },
        select: { id: true },
      });
      if (!existing) throw new NotFoundException('Facility not found');
      await tx.clientFacility.delete({ where: { id } });
      return { deleted: true };
    });
  }
}
