import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { IsIn, IsInt, IsOptional, IsString, Length, Matches, Min } from 'class-validator';
import type { TenantContext } from '@capiro/shared';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { CurrentTenant } from '../tenant/current-tenant.decorator.js';
import { ClientFacilitiesService } from './client-facilities.service.js';

// Bare district number ("12") or the at-large sentinel "00"; the state is
// carried separately. `/^[0-9]{1,2}$/` admits "00" already, so a single
// regex covers both the numbered-district and at-large cases.
const DISTRICT_PATTERN = /^[0-9]{1,2}$/;

export class CreateFacilityDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  addressLine?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  @Length(2, 2)
  state?: string;

  @IsOptional()
  @IsString()
  zip?: string;

  @IsOptional()
  @IsString()
  @Matches(DISTRICT_PATTERN, {
    message: 'congressionalDistrict must be a 1-2 digit number (bare, e.g. "12" or "00")',
  })
  congressionalDistrict?: string;

  @IsOptional()
  @IsIn(['user', 'geocoded'])
  districtSource?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  employeeCount?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateFacilityDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  addressLine?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  @Length(2, 2)
  state?: string;

  @IsOptional()
  @IsString()
  zip?: string;

  @IsOptional()
  @IsString()
  @Matches(DISTRICT_PATTERN, {
    message: 'congressionalDistrict must be a 1-2 digit number (bare, e.g. "12" or "00")',
  })
  congressionalDistrict?: string;

  @IsOptional()
  @IsIn(['user', 'geocoded'])
  districtSource?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  employeeCount?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

@Controller('clients/:clientId/facilities')
@UseGuards(RolesGuard)
@Roles('standard_user')
export class ClientFacilitiesController {
  constructor(private readonly service: ClientFacilitiesService) {}

  @Get()
  listFacilities(@CurrentTenant() ctx: TenantContext, @Param('clientId') clientId: string) {
    return this.service.listFacilities(ctx, clientId);
  }

  @Post()
  createFacility(
    @CurrentTenant() ctx: TenantContext,
    @Param('clientId') clientId: string,
    @Body() body: CreateFacilityDto,
  ) {
    return this.service.createFacility(ctx, clientId, body);
  }

  @Patch(':id')
  updateFacility(
    @CurrentTenant() ctx: TenantContext,
    @Param('clientId') clientId: string,
    @Param('id') id: string,
    @Body() body: UpdateFacilityDto,
  ) {
    return this.service.updateFacility(ctx, clientId, id, body);
  }

  @Delete(':id')
  deleteFacility(
    @CurrentTenant() ctx: TenantContext,
    @Param('clientId') clientId: string,
    @Param('id') id: string,
  ) {
    return this.service.deleteFacility(ctx, clientId, id);
  }
}
