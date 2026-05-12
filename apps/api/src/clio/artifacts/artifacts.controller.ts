import { Controller, Get, NotFoundException, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { TenantContextStore } from '../../tenant/tenant-context.store.js';
import { PrismaService } from '../../prisma/prisma.service.js';

/**
 * Read-only API for the Workspace's artifact viewer panel.
 *
 * Writes happen inside the agent loop via render-artifact.tool.ts — the
 * model decides when to create an artifact; the UI just observes the
 * resulting rows. Listing is intentionally tenant-wide (with optional
 * session filter) so the user can browse anything they've produced
 * across recent sessions in one place, the same way Claude shows a
 * single artifacts shelf.
 */
@Controller('clio/artifacts')
export class ClioArtifactsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly store: TenantContextStore,
  ) {}

  /**
   * List artifacts in the current tenant. When `sessionId` is supplied,
   * scopes to that session — used by the panel right next to the chat
   * so it only shows artifacts produced in the active conversation.
   * Without it, returns the 50 most recent ready artifacts across the
   * tenant.
   */
  @Get()
  async list(@Query('sessionId') sessionId?: string) {
    const ctx = this.store.require();
    return this.prisma.withTenant(ctx.tenantId, async (tx) => {
      const rows = await tx.clioArtifact.findMany({
        where: {
          status: 'ready',
          ...(sessionId ? { sessionId } : {}),
        },
        orderBy: { updatedAt: 'desc' },
        take: 50,
        select: {
          id: true,
          kind: true,
          title: true,
          version: true,
          sessionId: true,
          createdAt: true,
          updatedAt: true,
          // Metadata can be heavier than the rest of the row but the panel
          // wants the citation list to show "based on N sources" at a
          // glance, so it ships in the list payload.
          metadata: true,
        },
      });
      return { items: rows };
    });
  }

  /**
   * Single artifact with full markdown body — what the right pane
   * renders when the user opens an artifact card.
   */
  @Get(':id')
  async get(@Param('id', new ParseUUIDPipe()) id: string) {
    const ctx = this.store.require();
    return this.prisma.withTenant(ctx.tenantId, async (tx) => {
      const row = await tx.clioArtifact.findFirst({
        where: { id, status: 'ready' },
        select: {
          id: true,
          kind: true,
          title: true,
          version: true,
          sessionId: true,
          content: true,
          s3Key: true,
          s3ContentType: true,
          metadata: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      if (!row) throw new NotFoundException('Artifact not found');
      return row;
    });
  }
}
