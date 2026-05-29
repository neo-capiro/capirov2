import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import type { TenantContext } from '@capiro/shared';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { CurrentTenant } from '../tenant/current-tenant.decorator.js';
import { AcquisitionPersonnelWriterService } from './acquisition-personnel-writer.service.js';
import { AcquisitionPersonnelReadService } from './acquisition-personnel-read.service.js';
import { ListPersonnelDto } from './dto/list-personnel.dto.js';

class LinkCrmContactDto {
  engagementContactId!: string;
}

class MergeQueueQueryDto {
  status?: string;
  page?: number;
  limit?: number;
}

class ResolveMergeQueueDto {
  decision!: 'merge' | 'keep_separate' | 'reject_a' | 'reject_b';
  notes?: string;
}

@Controller()
@UseGuards(RolesGuard)
@Roles('standard_user')
export class AcquisitionPersonnelController {
  constructor(
    private readonly readService: AcquisitionPersonnelReadService,
    private readonly writerService: AcquisitionPersonnelWriterService,
  ) {}

  @Get('acquisition-personnel')
  list(@CurrentTenant() ctx: TenantContext, @Query() query: ListPersonnelDto) {
    return this.readService.listPersonnel(query, ctx);
  }

  @Get('acquisition-personnel/:id')
  detail(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    return this.readService.getPersonDetail(id, ctx);
  }

  @Get('program-elements/:peCode/personnel')
  listForProgramElement(@CurrentTenant() ctx: TenantContext, @Param('peCode') peCode: string) {
    return this.readService.getProgramElementPersonnel(peCode.toUpperCase(), ctx);
  }

  @Post('acquisition-personnel/:id/link-crm-contact')
  linkCrmContact(
    @CurrentTenant() ctx: TenantContext,
    @Param('id') id: string,
    @Body() body: LinkCrmContactDto,
  ) {
    return this.readService.linkCrmContact(id, body.engagementContactId, ctx);
  }

  @Get('admin/acquisition-personnel/merge-queue')
  @Roles('capiro_admin')
  mergeQueue(@CurrentTenant() ctx: TenantContext, @Query() query: MergeQueueQueryDto) {
    return this.readService.listMergeQueue(query.status ?? 'open', query.page, query.limit, ctx);
  }

  @Post('admin/acquisition-personnel/merge-queue/:id/resolve')
  @Roles('capiro_admin')
  resolveMergeQueue(
    @CurrentTenant() ctx: TenantContext,
    @Param('id') id: string,
    @Body() body: ResolveMergeQueueDto,
  ) {
    return this.readService.resolveMergeQueue(
      id,
      body.decision,
      body.notes,
      ctx,
      async (primaryId: string, secondaryId: string, userId: string) =>
        this.writerService.mergePersons(primaryId, secondaryId, userId),
    );
  }
}
