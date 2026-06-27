import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { IsString, MinLength } from 'class-validator';
import { TenantGuard } from '../auth/tenant.guard.js';
import { CurrentTenant } from '../auth/current-tenant.decorator.js';
import type { WorkspaceTenantContext } from '../auth/tenant-context.js';
import { GenerationService } from './generation.service.js';

export class GenerateSectionDto {
  @IsString() @MinLength(1) section!: string;
}

/** Meri generation endpoints (Phase 6). Tenant-scoped (Sonnet runtime). */
@Controller('drafts/:draftId')
@UseGuards(TenantGuard)
export class GenerationController {
  constructor(private readonly generation: GenerationService) {}

  /**
   * POST /workspace-api/drafts/:draftId/generate-section
   * Draft a single section with Meri (Claude Sonnet, tenant key when present).
   * Honors the draft's anonymize flag end-to-end.
   */
  @Post('generate-section')
  generateSection(
    @CurrentTenant() ctx: WorkspaceTenantContext,
    @Param('draftId') draftId: string,
    @Body() dto: GenerateSectionDto,
  ) {
    return this.generation.generateSection(ctx.tenantId, draftId, dto.section);
  }
}
