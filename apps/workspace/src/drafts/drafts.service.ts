import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { WSC } from '../cascade/cascade.config.js';
import type { CreateDraftDto, UpdateDraftDto, ListDraftsQueryDto } from './dto/draft.dto.js';

/**
 * Drafts service (Phase 3, AC-3.3). Every method is tenant-scoped: tenantId is
 * a mandatory filter on every read AND a mandatory field on every write. There
 * is no path that can read or mutate another tenant's draft.
 *
 * Derivations on write:
 *  - isPacket / docCount  (handoff §12.10): packet = coverLetter || docs > 1.
 *  - ask                  (handoff §12.11): funding products carry {amount,pb,
 *                          delta}; non-funding persist "n/a". Human-set only —
 *                          never auto-populated.
 */
@Injectable()
export class DraftsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(tenantId: string, ownerId: string, dto: CreateDraftDto) {
    const product = dto.product ?? '';
    const meta = product ? WSC.meta(product) : null;
    const sections = product ? WSC.suggestedSections(product) : [];
    const pages = product ? WSC.suggestedPages(product) : 2;
    const funding = product ? WSC.isFunding(product) : false;

    const config: Record<string, unknown> = {
      industry: dto.industry ?? null,
      product: product || null,
      client: dto.client ?? null,
      pathways: [],
      committees: [],
      personalize: meta?.personalize ?? false,
      officeAssociated: meta?.office ?? false,
      offices: [],
      clientAssociated: false,
      clientPersons: [],
      coverLetter: meta?.cover ?? false,
      selectedTemplate: null,
      sections,
      pages,
      tone: 'Formal',
      toneContext: '',
      linkedData: [],
      anonymize: false,
      letterhead: { custom: false, firmName: '', firmAddr: '' },
    };

    const draft = await this.prisma.wsDraft.create({
      data: {
        tenantId,
        ownerId,
        docTitle: dto.docTitle ?? (product ? `${product} draft` : 'Untitled draft'),
        industry: dto.industry ?? null,
        product: product || null,
        client: dto.client ?? null,
        config: config as never,
        ask: funding ? { amount: '', pb: '', delta: '' } : 'n/a',
        isPacket: meta?.cover ?? false,
        docCount: 1,
      },
    });

    // Every draft starts with one primary document tab.
    await this.prisma.wsDocument.create({
      data: {
        tenantId,
        draftId: draft.id,
        name: product || 'Document',
        ordinal: 0,
        body: { blocks: [] },
      },
    });

    return this.byId(tenantId, draft.id);
  }

  async byId(tenantId: string, id: string) {
    const draft = await this.prisma.wsDraft.findFirst({
      where: { id, tenantId },
      include: { documents: { orderBy: { ordinal: 'asc' } } },
    });
    if (!draft) throw new NotFoundException('Draft not found');
    return draft;
  }

  async list(tenantId: string, ownerId: string, q: ListDraftsQueryDto) {
    const where: Record<string, unknown> = { tenantId };
    if (q.sector) where.industry = q.sector;
    if (q.scope === 'mine') where.ownerId = ownerId;
    // 'shared' = not owned by me (collaboration). 'all' = no owner filter.
    if (q.scope === 'shared') where.ownerId = { not: ownerId };
    return this.prisma.wsDraft.findMany({
      where: where as never,
      orderBy: { updatedAt: 'desc' },
      include: { documents: { select: { id: true } } },
    });
  }

  /**
   * Patch / autosave. Merges partial config into the persisted blob, promotes
   * hot fields, re-derives isPacket/docCount, and enforces the funding-only ask
   * rule. tenantId is checked first (no cross-tenant writes).
   */
  async update(tenantId: string, id: string, dto: UpdateDraftDto) {
    const existing = await this.prisma.wsDraft.findFirst({
      where: { id, tenantId },
      include: { documents: { select: { id: true } } },
    });
    if (!existing) throw new NotFoundException('Draft not found');

    const mergedConfig: Record<string, unknown> = {
      ...(existing.config as Record<string, unknown>),
      ...(dto.config ?? {}),
    };

    const product = dto.product ?? existing.product ?? '';
    const funding = product ? WSC.isFunding(product) : false;
    const coverLetter = Boolean(
      (mergedConfig.coverLetter as boolean | undefined) ?? existing.isPacket,
    );
    const docCount = existing.documents.length;
    const isPacket = coverLetter || docCount > 1;

    // Funding-only ask. Non-funding products always store "n/a"; never auto-fill.
    let ask: unknown = existing.ask;
    if (dto.ask !== undefined) {
      ask = funding ? dto.ask : 'n/a';
    } else if (!funding) {
      ask = 'n/a';
    }

    const updated = await this.prisma.wsDraft.update({
      where: { id },
      data: {
        ...(dto.docTitle !== undefined ? { docTitle: dto.docTitle } : {}),
        ...(dto.industry !== undefined ? { industry: dto.industry } : {}),
        ...(dto.product !== undefined ? { product: dto.product } : {}),
        ...(dto.client !== undefined ? { client: dto.client } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        config: mergedConfig as never,
        ask: ask as never,
        isPacket,
        docCount,
      },
    });
    return this.byId(tenantId, updated.id);
  }

  async remove(tenantId: string, id: string): Promise<{ deleted: boolean }> {
    const existing = await this.prisma.wsDraft.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('Draft not found');
    await this.prisma.wsDraft.delete({ where: { id } });
    return { deleted: true };
  }
}
