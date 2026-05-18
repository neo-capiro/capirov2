import { Injectable, NotFoundException } from '@nestjs/common';
import { WorkflowStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateStrategyDto } from './dto/create-strategy.dto.js';
import type { UpdateStrategyDto } from './dto/update-strategy.dto.js';

@Injectable()
export class StrategiesService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Strategy CRUD ────────────────────────────────────────────────────────

  async create(tenantId: string, userId: string, dto: CreateStrategyDto) {
    return this.prisma.strategy.create({
      data: {
        tenantId,
        clientId: dto.clientId,
        capabilityId: dto.capabilityId,
        createdByUserId: userId,
        name: dto.name,
        fiscalYear: dto.fiscalYear,
        description: dto.description,
        submissionTypes: dto.submissionTypes ?? [],
      },
      include: {
        client: { select: { id: true, name: true } },
        capability: { select: { id: true, name: true, fundingAsk: true } },
      },
    });
  }

  list(tenantId: string, filters?: { clientId?: string; status?: string }) {
    return this.prisma.strategy.findMany({
      where: {
        tenantId,
        ...(filters?.clientId ? { clientId: filters.clientId } : {}),
        ...(filters?.status ? { status: filters.status } : {}),
      },
      include: {
        client: { select: { id: true, name: true } },
        capability: { select: { id: true, name: true, fundingAsk: true } },
        targets: true,
        _count: { select: { instances: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(tenantId: string, id: string) {
    const strategy = await this.prisma.strategy.findUnique({
      where: { id },
      include: {
        client: { select: { id: true, name: true } },
        capability: { select: { id: true, name: true, fundingAsk: true } },
        targets: { orderBy: { createdAt: 'asc' } },
        instances: {
          include: { template: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!strategy || strategy.tenantId !== tenantId) {
      throw new NotFoundException(`Strategy '${id}' not found`);
    }
    return strategy;
  }

  async update(tenantId: string, id: string, dto: UpdateStrategyDto) {
    await this.get(tenantId, id);

    const data: Parameters<typeof this.prisma.strategy.update>[0]['data'] = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.fiscalYear !== undefined) data.fiscalYear = dto.fiscalYear;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.submissionTypes !== undefined) data.submissionTypes = dto.submissionTypes;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (dto.settings !== undefined) data.settings = dto.settings as any;
    if (dto.capabilityId !== undefined) {
      data.capability = dto.capabilityId
        ? { connect: { id: dto.capabilityId } }
        : { disconnect: true };
    }

    return this.prisma.strategy.update({
      where: { id },
      data,
      include: {
        client: { select: { id: true, name: true } },
        capability: { select: { id: true, name: true, fundingAsk: true } },
      },
    });
  }

  async delete(tenantId: string, id: string) {
    await this.get(tenantId, id);
    // Unlink instances before deleting (SetNull happens via FK, but we do it
    // explicitly so callers can see the count of unlinked instances).
    await this.prisma.workflowInstance.updateMany({
      where: { strategyId: id },
      data: { strategyId: null },
    });
    return this.prisma.strategy.delete({ where: { id } });
  }

  // ── Targets ──────────────────────────────────────────────────────────────

  async addTarget(
    tenantId: string,
    strategyId: string,
    body: {
      memberName: string;
      memberTitle?: string;
      memberParty?: string;
      memberState?: string;
      committee?: string;
      subcommittee?: string;
      stafferName?: string;
      stafferEmail?: string;
      directoryContactId?: string;
    },
  ) {
    await this.get(tenantId, strategyId);
    return this.prisma.strategyTarget.create({
      data: {
        tenantId,
        strategyId,
        memberName: body.memberName,
        memberTitle: body.memberTitle,
        memberParty: body.memberParty,
        memberState: body.memberState,
        committee: body.committee,
        subcommittee: body.subcommittee,
        stafferName: body.stafferName,
        stafferEmail: body.stafferEmail,
        directoryContactId: body.directoryContactId,
      },
    });
  }

  async updateTarget(
    tenantId: string,
    strategyId: string,
    targetId: string,
    body: {
      outreachStatus?: string;
      meetingDate?: string | null;
      notes?: string;
      memberTitle?: string;
      committee?: string;
      subcommittee?: string;
      stafferName?: string;
      stafferEmail?: string;
    },
  ) {
    const target = await this.prisma.strategyTarget.findUnique({ where: { id: targetId } });
    if (!target || target.tenantId !== tenantId || target.strategyId !== strategyId) {
      throw new NotFoundException(`Target '${targetId}' not found`);
    }
    return this.prisma.strategyTarget.update({
      where: { id: targetId },
      data: {
        ...(body.outreachStatus !== undefined ? { outreachStatus: body.outreachStatus } : {}),
        ...(body.meetingDate !== undefined
          ? { meetingDate: body.meetingDate ? new Date(body.meetingDate) : null }
          : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
        ...(body.memberTitle !== undefined ? { memberTitle: body.memberTitle } : {}),
        ...(body.committee !== undefined ? { committee: body.committee } : {}),
        ...(body.subcommittee !== undefined ? { subcommittee: body.subcommittee } : {}),
        ...(body.stafferName !== undefined ? { stafferName: body.stafferName } : {}),
        ...(body.stafferEmail !== undefined ? { stafferEmail: body.stafferEmail } : {}),
      },
    });
  }

  async deleteTarget(tenantId: string, strategyId: string, targetId: string) {
    const target = await this.prisma.strategyTarget.findUnique({ where: { id: targetId } });
    if (!target || target.tenantId !== tenantId || target.strategyId !== strategyId) {
      throw new NotFoundException(`Target '${targetId}' not found`);
    }
    return this.prisma.strategyTarget.delete({ where: { id: targetId } });
  }

  // ── Link / Unlink Instances ───────────────────────────────────────────────

  async linkInstance(tenantId: string, strategyId: string, instanceId: string) {
    await this.get(tenantId, strategyId);
    const instance = await this.prisma.workflowInstance.findUnique({ where: { id: instanceId } });
    if (!instance || instance.tenantId !== tenantId) {
      throw new NotFoundException(`Workflow instance '${instanceId}' not found`);
    }
    return this.prisma.workflowInstance.update({
      where: { id: instanceId },
      data: { strategyId },
      include: { template: true },
    });
  }

  async unlinkInstance(tenantId: string, strategyId: string, instanceId: string) {
    await this.get(tenantId, strategyId);
    const instance = await this.prisma.workflowInstance.findUnique({ where: { id: instanceId } });
    if (!instance || instance.tenantId !== tenantId || instance.strategyId !== strategyId) {
      throw new NotFoundException(`Workflow instance '${instanceId}' not found on this strategy`);
    }
    return this.prisma.workflowInstance.update({
      where: { id: instanceId },
      data: { strategyId: null },
      include: { template: true },
    });
  }

  async createSubmissions(tenantId: string, userId: string, strategyId: string) {
    const strategy = await this.get(tenantId, strategyId);
    const slugs = (strategy.submissionTypes as string[]) ?? [];
    if (slugs.length === 0) return { created: [] };

    const templates = await this.prisma.workflowTemplate.findMany({
      where: { slug: { in: slugs }, isActive: true },
    });

    const templateBySlug = new Map(templates.map((t) => [t.slug, t]));

    const created = await Promise.all(
      slugs.map(async (slug) => {
        const template = templateBySlug.get(slug);
        if (!template) return null;
        return this.prisma.workflowInstance.create({
          data: {
            tenantId,
            templateId: template.id,
            createdByUserId: userId,
            clientId: strategy.clientId,
            strategyId,
            title: `${strategy.name} — ${template.name}`,
            status: WorkflowStatus.triage,
          },
          include: { template: true },
        });
      }),
    );

    return { created: created.filter(Boolean) };
  }
}
