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

class PersonCandidateQueryDto {
  status?: string;
  page?: number;
  limit?: number;
}

class ResolvePersonCandidateDto {
  decision!: 'confirm' | 'reject';
  notes?: string;
}

class SuggestPersonDto {
  fullName!: string;
  roleTitle?: string;
  organization?: string;
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

  @Get('admin/program-elements/person-candidates')
  @Roles('capiro_admin')
  personCandidates(@CurrentTenant() ctx: TenantContext, @Query() query: PersonCandidateQueryDto) {
    return this.readService.listPersonCandidates(query.status ?? 'open', query.page, query.limit, ctx);
  }

  @Post('admin/program-elements/person-candidates/:id/resolve')
  @Roles('capiro_admin')
  resolvePersonCandidate(
    @CurrentTenant() ctx: TenantContext,
    @Param('id') id: string,
    @Body() body: ResolvePersonCandidateDto,
  ) {
    return this.readService.resolvePersonCandidate(id, body.decision, body.notes, ctx);
  }

  // user_admin (and above) can SUGGEST a person they know for a PE. The suggestion
  // becomes an open candidate (source=user_suggested) for capiro_admin review — it
  // never auto-applies a link.
  @Post('program-elements/:peCode/suggest-person')
  @Roles('user_admin')
  suggestPerson(
    @CurrentTenant() ctx: TenantContext,
    @Param('peCode') peCode: string,
    @Body() body: SuggestPersonDto,
  ) {
    return this.readService.suggestPersonForProgramElement(
      peCode.toUpperCase(),
      { fullName: body.fullName, roleTitle: body.roleTitle, organization: body.organization, notes: body.notes },
      ctx,
    );
  }
}
