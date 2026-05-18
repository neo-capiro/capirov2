import { Injectable, NotFoundException } from '@nestjs/common';
import type { ClientCapability } from '@prisma/client';
import { WorkflowStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateStrategyDto } from './dto/create-strategy.dto.js';
import type { UpdateStrategyDto } from './dto/update-strategy.dto.js';

export interface DeadlineItem {
  strategyId: string;
  strategyName: string;
  clientName: string;
  templateSlug: string;
  templateName: string;
  deadline: string;
  deadlineLabel: string;
  daysUntil: number;
  instanceId: string;
  instanceStatus: string;
}

@Injectable()
export class StrategiesService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Strategy CRUD ────────────────────────────────────────────────────────

  async create(tenantId: string, userId: string, dto: CreateStrategyDto) {
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.strategy.create({
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
      }),
    );
  }

  list(tenantId: string, filters?: { clientId?: string; status?: string }) {
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.strategy.findMany({
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
      }),
    );
  }

  async get(tenantId: string, id: string) {
    const strategy = await this.prisma.withTenant(tenantId, (tx) =>
      tx.strategy.findUnique({
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
      }),
    );
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

    return this.prisma.withTenant(tenantId, (tx) =>
      tx.strategy.update({
        where: { id },
        data,
        include: {
          client: { select: { id: true, name: true } },
          capability: { select: { id: true, name: true, fundingAsk: true } },
        },
      }),
    );
  }

  async delete(tenantId: string, id: string) {
    await this.get(tenantId, id);
    return this.prisma.withTenant(tenantId, async (tx) => {
      await tx.workflowInstance.updateMany({
        where: { strategyId: id },
        data: { strategyId: null },
      });
      return tx.strategy.delete({ where: { id } });
    });
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
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.strategyTarget.create({
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
      }),
    );
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

    const [capability, client] = await Promise.all([
      strategy.capabilityId
        ? this.prisma.clientCapability.findUnique({ where: { id: strategy.capabilityId } })
        : Promise.resolve(null),
      this.prisma.client.findUnique({ where: { id: strategy.clientId } }),
    ]);

    const prefillData = this.buildPrefillData(capability, client);

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
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            formData: prefillData as any,
          },
          include: { template: true },
        });
      }),
    );

    return { created: created.filter(Boolean) };
  }

  async syncData(tenantId: string, strategyId: string) {
    const strategy = await this.get(tenantId, strategyId);

    const [capability, client] = await Promise.all([
      strategy.capabilityId
        ? this.prisma.clientCapability.findUnique({ where: { id: strategy.capabilityId } })
        : Promise.resolve(null),
      this.prisma.client.findUnique({ where: { id: strategy.clientId } }),
    ]);

    const prefillData = this.buildPrefillData(capability, client);
    if (Object.keys(prefillData).length === 0) return { synced: 0 };

    const instances = await this.prisma.workflowInstance.findMany({
      where: { strategyId, tenantId },
    });

    let synced = 0;
    for (const inst of instances) {
      const existing = (inst.formData ?? {}) as Record<string, unknown>;
      const merged: Record<string, unknown> = { ...existing };
      let changed = false;
      for (const [k, v] of Object.entries(prefillData)) {
        if (merged[k] === undefined || merged[k] === null || merged[k] === '') {
          merged[k] = v;
          changed = true;
        }
      }
      if (changed) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await this.prisma.workflowInstance.update({ where: { id: inst.id }, data: { formData: merged as any } });
        synced++;
      }
    }
    return { synced };
  }

  async getDeadlines(tenantId: string): Promise<DeadlineItem[]> {
    const strategies = await this.prisma.strategy.findMany({
      where: { tenantId, status: 'active' },
      include: {
        client: { select: { id: true, name: true } },
        instances: { include: { template: true } },
      },
    });

    const today = new Date();
    const cutoff = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
    const items: DeadlineItem[] = [];

    for (const strategy of strategies) {
      const fyYear = deadlineYear(strategy.fiscalYear);
      for (const inst of strategy.instances) {
        const contextInfo = (inst.template?.contextInfo ?? {}) as Record<string, unknown>;
        const timing = typeof contextInfo.timing === 'string' ? contextInfo.timing : null;
        if (!timing) continue;

        for (const { date, label } of extractDeadlines(timing, fyYear)) {
          if (date < today || date > cutoff) continue;
          const daysUntil = Math.round((date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
          items.push({
            strategyId: strategy.id,
            strategyName: strategy.name,
            clientName: (strategy.client as { name: string } | null)?.name ?? '',
            templateSlug: inst.template?.slug ?? '',
            templateName: inst.template?.name ?? '',
            deadline: date.toISOString().slice(0, 10),
            deadlineLabel: label,
            daysUntil,
            instanceId: inst.id,
            instanceStatus: inst.status,
          });
        }
      }
    }

    return items.sort((a, b) => a.daysUntil - b.daysUntil);
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private buildPrefillData(
    capability: ClientCapability | null,
    client: { name: string } | null,
  ): Record<string, unknown> {
    const p: Record<string, unknown> = {};

    if (capability) {
      if (capability.name) p.program = capability.name;
      if (capability.peNumber) {
        p.program_element = capability.peNumber;
        p.pe_budget_line = capability.peNumber;
        p.line_number = capability.peNumber;
      }
      if (capability.appropriationAccount) {
        p.appropriation_account = capability.appropriationAccount;
        p.appropriations_account = capability.appropriationAccount;
        p.account_name = capability.appropriationAccount;
      }
      if (capability.fundingAsk != null) {
        p.requested_funding_amount = capability.fundingAsk;
        p.requested_amount = capability.fundingAsk;
        p.fy_requested = capability.fundingAsk;
      }
      if (capability.justification) p.justification = capability.justification;
      if (capability.targetSubcommittee) p.subcommittee = capability.targetSubcommittee;
      if (capability.serviceBranch) p.service_branch = capability.serviceBranch;
      if (capability.districtNexus) {
        p.connection_to_massachusetts = true;
        p.massachusetts_connection_detail = capability.districtNexus;
        p.state_connection = true;
        p.state_connection_detail = capability.districtNexus;
      }
      if (capability.description) p.problem_statement = capability.description;
    }

    if (client?.name) p.org_name = client.name;
    return p;
  }
}

// ── Module-level deadline parsing helpers ────────────────────────────────────

const MONTHS: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
  jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

function deadlineYear(fiscalYear: string | null | undefined): number {
  if (!fiscalYear) return new Date().getFullYear();
  const m = fiscalYear.match(/\d{2,4}/);
  if (!m) return new Date().getFullYear();
  const fy = parseInt(m[0], 10) < 100 ? 2000 + parseInt(m[0], 10) : parseInt(m[0], 10);
  return fy - 1; // FY27 approps deadlines are in spring 2026
}

function extractDeadlines(timing: string, year: number): { date: Date; label: string }[] {
  const results: { date: Date; label: string }[] = [];
  // Match "Something deadline: approximately Month DD"
  const re = /([A-Za-z/ ]+deadline[^:]*?:\s*approximately\s+)([A-Za-z]+)\s+(\d{1,2})/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(timing)) !== null) {
    const label = (m[1] ?? '').replace(/:\s*approximately\s*$/, '').trim();
    const month = MONTHS[(m[2] ?? '').toLowerCase()];
    const day = parseInt(m[3] ?? '', 10);
    if (month === undefined || isNaN(day)) continue;
    results.push({ date: new Date(year, month, day), label });
  }
  return results;
}
