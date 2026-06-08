import { Body, Controller, Get, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsString, Length, Min } from 'class-validator';
import type { TenantContext } from '@capiro/shared';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { CurrentTenant } from '../tenant/current-tenant.decorator.js';
import { FirmOnboardingService } from './firm-onboarding.service.js';

class SearchRegistrantsQueryDto {
  @IsString()
  @Length(2, 200)
  q!: string;
}

class SetRegistrantDto {
  @IsInt()
  @Min(1)
  registrantId!: number;
}

class ImportClientsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsInt({ each: true })
  ldaClientIds!: number[];
}

/**
 * Firm-registrant onboarding + "import your clients". Reads are open to any
 * member; mutating the firm anchor and importing clients are user_admin (the
 * same bar as client create/update).
 */
@Controller('firm')
@UseGuards(RolesGuard)
@Roles('standard_user')
export class FirmOnboardingController {
  constructor(private readonly svc: FirmOnboardingService) {}

  @Get('lda-registrants')
  searchRegistrants(@Query() query: SearchRegistrantsQueryDto) {
    return this.svc.searchRegistrants(query.q);
  }

  @Get('registrant')
  getRegistrant(@CurrentTenant() ctx: TenantContext) {
    return this.svc.getTenantRegistrant(ctx);
  }

  @Put('registrant')
  @Roles('user_admin')
  setRegistrant(@CurrentTenant() ctx: TenantContext, @Body() body: SetRegistrantDto) {
    return this.svc.setTenantRegistrant(ctx, body.registrantId);
  }

  @Get('import-candidates')
  importCandidates(@CurrentTenant() ctx: TenantContext) {
    return this.svc.listImportCandidates(ctx);
  }

  @Post('import')
  @Roles('user_admin')
  importClients(@CurrentTenant() ctx: TenantContext, @Body() body: ImportClientsDto) {
    return this.svc.importClients(ctx, body.ldaClientIds);
  }
}
