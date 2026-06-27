import { Controller, Get, Param, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { TenantGuard } from '../auth/tenant.guard.js';
import { CurrentTenant } from '../auth/current-tenant.decorator.js';
import type { WorkspaceTenantContext } from '../auth/tenant-context.js';
import { ExportService } from './export.service.js';

/** Document export endpoints (Phase 7). PDF is produced client-side (print). */
@Controller('drafts/:draftId/export')
@UseGuards(TenantGuard)
export class ExportController {
  constructor(private readonly exportService: ExportService) {}

  /**
   * GET /workspace-api/drafts/:draftId/export/docx
   * Streams a .docx of the draft (anonymized when the draft flag is set).
   */
  @Get('docx')
  async docx(
    @CurrentTenant() ctx: WorkspaceTenantContext,
    @Param('draftId') draftId: string,
    @Res() res: Response,
  ): Promise<void> {
    const { filename, buffer } = await this.exportService.buildDocx(ctx.tenantId, draftId);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }
}
