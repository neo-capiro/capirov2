import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AddContextItemDto } from './dto/context.dto.js';

/**
 * Build Context (Phase 3, AC-3.6 / handoff §12.16). Sources, relevant news, and
 * free-text grounding attached to a draft for Meri generation.
 *
 * CLIENT-SCOPED (Neo's guardrail): sources + news are filtered by the selected
 * client and selected offices only — no coworker/other-attendee domains leak in.
 *
 * v1 returns curated stubs flagged `mock: true`. To wire for real (logged):
 *  - sources: Client profile / Intel / Prior docs / Bills / Meeting preps via
 *    the API (read-only cross-domain), never by mutating api-owned tables.
 *  - news: live API (Politico Pro / BGOV / Google News) filtered by client +
 *    office + industry tags.
 */
@Injectable()
export class ContextService {
  constructor(private readonly prisma: PrismaService) {}

  /** Catalog of pullable source types (mock for v1; real wiring deferred). */
  sources(client?: string, offices?: string[]): {
    mock: true;
    client: string | null;
    offices: string[];
    groups: { type: string; label: string; items: { id: string; label: string }[] }[];
  } {
    const c = client ?? null;
    return {
      mock: true,
      client: c,
      offices: offices ?? [],
      groups: [
        {
          type: 'client-profile',
          label: 'Client profile',
          items: c ? [{ id: 'cp-overview', label: `${c} — overview & capabilities` }] : [],
        },
        { type: 'intel', label: 'Intelligence', items: [{ id: 'intel-budget', label: 'Budget identifiers (R-1 / PE / UPL)' }] },
        { type: 'prior-docs', label: 'Prior documents', items: [] },
        { type: 'bills', label: 'Tracked bills', items: [] },
        { type: 'meeting-preps', label: 'Meeting preps', items: [] },
      ],
    };
  }

  /**
   * Relevant news, filtered by client OR selected offices (handoff §12.16
   * filter logic). v1 = empty mock array; live API replaces it. Strictly
   * client/office-scoped — no unrelated context.
   */
  news(client?: string, offices?: string[]): {
    mock: true;
    client: string | null;
    offices: string[];
    articles: unknown[];
  } {
    return { mock: true, client: client ?? null, offices: offices ?? [], articles: [] };
  }

  private async assertDraft(tenantId: string, draftId: string) {
    const draft = await this.prisma.wsDraft.findFirst({ where: { id: draftId, tenantId } });
    if (!draft) throw new NotFoundException('Draft not found');
    return draft;
  }

  async listItems(tenantId: string, draftId: string) {
    await this.assertDraft(tenantId, draftId);
    return this.prisma.wsContextItem.findMany({
      where: { tenantId, draftId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async addItem(tenantId: string, draftId: string, dto: AddContextItemDto) {
    await this.assertDraft(tenantId, draftId);
    return this.prisma.wsContextItem.create({
      data: { tenantId, draftId, kind: dto.kind, payload: dto.payload as never },
    });
  }

  async removeItem(
    tenantId: string,
    draftId: string,
    itemId: string,
  ): Promise<{ deleted: boolean }> {
    await this.assertDraft(tenantId, draftId);
    const existing = await this.prisma.wsContextItem.findFirst({
      where: { id: itemId, tenantId, draftId },
    });
    if (!existing) throw new NotFoundException('Context item not found');
    await this.prisma.wsContextItem.delete({ where: { id: itemId } });
    return { deleted: true };
  }
}
