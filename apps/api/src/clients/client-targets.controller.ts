import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import type { TenantContext } from '@capiro/shared';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { CurrentTenant } from '../tenant/current-tenant.decorator.js';
import { ClientTargetsService } from './client-targets.service.js';

class AddTargetDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  memberId!: string;

  // "manual" (added from search results) | "meri" (added from the Meri sidebar).
  @IsOptional()
  @IsIn(['manual', 'meri'])
  source?: string;
}

@Controller('clients/:clientId/targets')
@UseGuards(RolesGuard)
@Roles('standard_user')
export class ClientTargetsController {
  constructor(private readonly service: ClientTargetsService) {}

  @Get()
  listTargets(@CurrentTenant() ctx: TenantContext, @Param('clientId') clientId: string) {
    return this.service.listTargets(ctx, clientId);
  }

  @Post()
  addTarget(
    @CurrentTenant() ctx: TenantContext,
    @Param('clientId') clientId: string,
    @Body() body: AddTargetDto,
  ) {
    return this.service.addTarget(ctx, clientId, body);
  }

  // Remove by member id (not row id) — the UI only knows the member it added.
  @Delete(':memberId')
  removeTarget(
    @CurrentTenant() ctx: TenantContext,
    @Param('clientId') clientId: string,
    @Param('memberId') memberId: string,
  ) {
    return this.service.removeTarget(ctx, clientId, memberId);
  }
}
