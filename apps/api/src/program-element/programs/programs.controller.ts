import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';
import type { TenantContext } from '@capiro/shared';
import { Roles } from '../../auth/roles.decorator.js';
import { RolesGuard } from '../../auth/roles.guard.js';
import { CurrentTenant } from '../../tenant/current-tenant.decorator.js';
import { ProgramsService, type ProgramMatchDecision } from './programs.service.js';

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

  @Get()
  search(@Query() query: ProgramSearchDto) {
    return this.service.searchPrograms(query.q, query.limit);
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.service.getProgram(id);
  }
}
