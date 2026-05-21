import {
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Body,
  UseGuards,
} from '@nestjs/common';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import type { TenantContext } from '@capiro/shared';
import { CurrentTenant } from '../tenant/current-tenant.decorator.js';
import { IntelligenceService } from './intelligence.service.js';

class ChangesQueryDto {
  @IsOptional()
  @IsString()
  since?: string;

  @IsOptional()
  @IsString()
  clientId?: string;

  @IsOptional()
  @IsString()
  source?: string;
}

class ConfirmMappingDto {
  @IsBoolean()
  @Type(() => Boolean)
  confirmed!: boolean;
}

@Controller('intelligence')
@UseGuards(RolesGuard)
@Roles('standard_user')
export class IntelligenceController {
  constructor(private readonly service: IntelligenceService) {}

  @Get('client-profile/:clientId')
  getClientProfile(
    @CurrentTenant() ctx: TenantContext,
    @Param('clientId') clientId: string,
  ) {
    return this.service.getClientProfile(clientId, ctx.tenantId);
  }

  @Get('changes')
  getChanges(@Query() q: ChangesQueryDto) {
    return this.service.getChanges(q.since, q.clientId, q.source);
  }

  @Get('mappings/:clientId')
  getMappings(@Param('clientId') clientId: string) {
    return this.service.getMappings(clientId);
  }

  @Post('mappings/:clientId/resolve')
  resolveMapping(
    @CurrentTenant() ctx: TenantContext,
    @Param('clientId') clientId: string,
  ) {
    return this.service.resolveMapping(clientId, ctx.tenantId);
  }

  @Patch('mappings/:mappingId')
  confirmMapping(
    @Param('mappingId') mappingId: string,
    @Body() body: ConfirmMappingDto,
  ) {
    return this.service.confirmMapping(mappingId, body.confirmed);
  }
}
