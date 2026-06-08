import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';
import type { TenantContext } from '@capiro/shared';
import { Roles } from '../../auth/roles.decorator.js';
import { RolesGuard } from '../../auth/roles.guard.js';
import { CurrentTenant } from '../../tenant/current-tenant.decorator.js';
import { ProgramsService, type ProgramMatchDecision } from './programs.service.js';

// aliasType values allowed on program_alias (mirrors the schema doc-comment).
const ALIAS_TYPES = [
  'canonical',
  'acronym',
  'pe_title',
  'project_title',
  'p1_line_name',
  'mdap_name',
  'office_usage',
  'congressional',
  'sam_usage',
  'award_usage',
] as const;

// The global ValidationPipe runs whitelist + forbidNonWhitelisted, so every DTO
// field MUST carry a class-validator decorator (mirrors AcquisitionPersonnelController).
class ProgramSearchDto {
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}

class MatchQueueQueryDto {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}

class ResolveMatchDto {
  @IsIn(['accept', 'reject', 'quarantine'])
  decision!: ProgramMatchDecision;

  @IsOptional()
  @IsString()
  notes?: string;
}

class CreateAliasDto {
  @IsString()
  alias!: string;

  @IsIn(ALIAS_TYPES)
  aliasType!: string;

  @IsOptional()
  @IsString()
  source?: string;
}

class UpdateAliasDto {
  @IsOptional()
  @IsString()
  alias?: string;

  @IsOptional()
  @IsIn(ALIAS_TYPES)
  aliasType?: string;
}

class MergeProgramsDto {
  @IsString()
  keepProgramId!: string;

  @IsString()
  mergeProgramId!: string;
}

@Controller('programs')
@UseGuards(RolesGuard)
@Roles('standard_user')
export class ProgramsController {
  constructor(private readonly service: ProgramsService) {}

  // Static admin routes declared BEFORE the ':id' dynamic route so 'admin' is not
  // captured as a program id. capiro_admin only (Step 2.1 review queue).
  @Get('admin/match-queue')
  @Roles('capiro_admin')
  matchQueue(@Query() query: MatchQueueQueryDto) {
    return this.service.listMatchQueue(query.status, query.page, query.limit);
  }

  @Post('admin/match-queue/:id/resolve')
  @Roles('capiro_admin')
  resolveMatch(
    @CurrentTenant() ctx: TenantContext,
    @Param('id') id: string,
    @Body() body: ResolveMatchDto,
  ) {
    return this.service.resolveMatch(id, { decision: body.decision, notes: body.notes }, ctx);
  }

  // ── Step 3.5 analyst console: alias manager + program merge (capiro_admin). ──
  // Fully-static admin routes (duplicate-aliases, merge) and the literal-prefixed
  // alias routes are declared BEFORE the ':id' dynamic route so they are not
  // captured as a program id.

  @Get('admin/duplicate-aliases')
  @Roles('capiro_admin')
  duplicateAliases() {
    return this.service.listDuplicateAliases();
  }

  @Post('admin/merge')
  @Roles('capiro_admin')
  merge(@CurrentTenant() ctx: TenantContext, @Body() body: MergeProgramsDto) {
    return this.service.mergePrograms(
      { keepProgramId: body.keepProgramId, mergeProgramId: body.mergeProgramId },
      ctx,
    );
  }

  @Get('admin/:programId/aliases')
  @Roles('capiro_admin')
  listAliases(@Param('programId') programId: string) {
    return this.service.listAliases(programId);
  }

  @Post('admin/:programId/aliases')
  @Roles('capiro_admin')
  createAlias(
    @CurrentTenant() ctx: TenantContext,
    @Param('programId') programId: string,
    @Body() body: CreateAliasDto,
  ) {
    return this.service.createAlias(
      programId,
      { alias: body.alias, aliasType: body.aliasType, source: body.source },
      ctx,
    );
  }

  @Patch('admin/aliases/:id')
  @Roles('capiro_admin')
  updateAlias(
    @CurrentTenant() ctx: TenantContext,
    @Param('id') id: string,
    @Body() body: UpdateAliasDto,
  ) {
    return this.service.updateAlias(id, { alias: body.alias, aliasType: body.aliasType }, ctx);
  }

  @Delete('admin/aliases/:id')
  @Roles('capiro_admin')
  deleteAlias(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    return this.service.deleteAlias(id, ctx);
  }

  @Get()
  search(@Query() query: ProgramSearchDto) {
    return this.service.searchPrograms(query.q, query.limit);
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.service.getProgram(id);
  }
}
