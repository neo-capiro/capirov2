import { Injectable, NotFoundException } from '@nestjs/common';
import { WorkflowStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateWorkflowInstanceDto } from './dto/create-workflow-instance.dto.js';
import type { UpdateWorkflowInstanceDto } from './dto/update-workflow-instance.dto.js';

@Injectable()
export class WorkflowsService {
  constructor(private readonly prisma: PrismaService) {}

  listTemplates() {
    return this.prisma.workflowTemplate.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async getTemplateBySlug(slug: string) {
    const template = await this.prisma.workflowTemplate.findUnique({ where: { slug } });
    if (!template) throw new NotFoundException(`Workflow template '${slug}' not found`);
    return template;
  }

  async createInstance(tenantId: string, userId: string, dto: CreateWorkflowInstanceDto) {
    const template = await this.getTemplateBySlug(dto.templateSlug);
    return this.prisma.workflowInstance.create({
      data: {
        tenantId,
        templateId: template.id,
        createdByUserId: userId,
        clientId: dto.clientId,
        title: dto.title ?? template.name,
        status: WorkflowStatus.triage,
      },
      include: { template: true },
    });
  }

  listInstances(tenantId: string, filters?: { status?: string; clientId?: string }) {
    return this.prisma.workflowInstance.findMany({
      where: {
        tenantId,
        ...(filters?.status ? { status: filters.status as WorkflowStatus } : {}),
        ...(filters?.clientId ? { clientId: filters.clientId } : {}),
      },
      include: { template: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getInstance(tenantId: string, id: string) {
    const instance = await this.prisma.workflowInstance.findUnique({
      where: { id },
      include: { template: true },
    });
    if (!instance || instance.tenantId !== tenantId) {
      throw new NotFoundException(`Workflow instance '${id}' not found`);
    }
    return instance;
  }

  async updateInstance(tenantId: string, id: string, dto: UpdateWorkflowInstanceDto) {
    await this.getInstance(tenantId, id);

    const data: Record<string, unknown> = {};
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.formData !== undefined) data.formData = dto.formData;
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.notes !== undefined) data.notes = dto.notes;
    if (dto.targetMemberId !== undefined) data.targetMemberId = dto.targetMemberId;
    if (dto.submissionDeadline !== undefined) data.submissionDeadline = new Date(dto.submissionDeadline);
    if (dto.submissionMethod !== undefined) data.submissionMethod = dto.submissionMethod;
    if (dto.status === WorkflowStatus.complete) data.completedAt = new Date();

    return this.prisma.workflowInstance.update({
      where: { id },
      data,
      include: { template: true },
    });
  }

  async deleteInstance(tenantId: string, id: string) {
    await this.getInstance(tenantId, id);
    return this.prisma.workflowInstance.delete({ where: { id } });
  }
}
