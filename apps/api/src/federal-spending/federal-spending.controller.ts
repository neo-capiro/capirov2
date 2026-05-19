import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { FederalSpendingService } from './federal-spending.service.js';

class SearchDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;
}

/**
 * Read-only federal spending intelligence API.
 * Auth required (standard_user+), but data is global / cross-tenant.
 */
@Controller('federal-spending')
@UseGuards(RolesGuard)
@Roles('standard_user')
export class FederalSpendingController {
  constructor(private readonly service: FederalSpendingService) {}

  @Get('overview')
  overview() {
    return this.service.overview();
  }

  @Get('agencies')
  agencies() {
    return this.service.listAgencies();
  }

  @Get('agencies/:slug')
  agency(@Param('slug') slug: string) {
    return this.service.getAgency(slug);
  }

  @Get('contractors')
  contractors() {
    return this.service.listContractors();
  }

  @Get('contractors/search')
  searchContractors(@Query() query: SearchDto) {
    return this.service.searchContractors(query.q ?? '');
  }

  @Get('contractors/lookup')
  lookup(@Query('name') name: string) {
    if (!name) return null;
    return this.service.lookupByClientName(name);
  }

  @Get('contractors/:slug')
  contractor(@Param('slug') slug: string) {
    return this.service.getContractor(slug);
  }

  @Get('industries')
  industries() {
    return this.service.listIndustries();
  }
}
