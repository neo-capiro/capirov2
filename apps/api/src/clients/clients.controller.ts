import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import {
  IsEmail,
  IsObject,
  IsOptional,
  IsPhoneNumber,
  IsString,
  IsUrl,
  Length,
  MinLength,
} from 'class-validator';
import type { TenantContext } from '@capiro/shared';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { CurrentTenant } from '../tenant/current-tenant.decorator.js';
import { ClientsService } from './clients.service.js';

class CreateClientDto {
  @IsString()
  @Length(1, 200)
  name!: string;

  @IsOptional()
  @IsUrl({ require_protocol: false })
  website?: string;

  @IsOptional()
  @IsString()
  @MinLength(0)
  description?: string;

  @IsOptional()
  @IsString()
  productDescription?: string;

  @IsOptional()
  @IsString()
  primaryContactName?: string;

  @IsOptional()
  @IsEmail()
  primaryContactEmail?: string;

  @IsOptional()
  @IsString()
  primaryContactPhone?: string;

  @IsOptional()
  @IsObject()
  intakeData?: Record<string, unknown>;
}

class UpdateClientDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsUrl({ require_protocol: false })
  website?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  productDescription?: string;

  @IsOptional()
  @IsString()
  primaryContactName?: string;

  @IsOptional()
  @IsEmail()
  primaryContactEmail?: string;

  @IsOptional()
  @IsString()
  primaryContactPhone?: string;

  @IsOptional()
  @IsObject()
  intakeData?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  status?: string;
}

/**
 * Clients API — the lobbying firm's customer records.
 *
 * Read access: any tenant member (standard_user and above).
 * Create: any standard_user and above.
 * Update / archive: user_admin or capiro_admin only.
 */
@Controller('clients')
@UseGuards(RolesGuard)
@Roles('standard_user')
export class ClientsController {
  constructor(private readonly service: ClientsService) {}

  @Get()
  list(@CurrentTenant() ctx: TenantContext) {
    return this.service.list(ctx);
  }

  @Get(':id')
  get(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    return this.service.get(ctx, id);
  }

  @Post()
  create(@CurrentTenant() ctx: TenantContext, @Body() body: CreateClientDto) {
    return this.service.create(ctx, body);
  }

  @Put(':id')
  @Roles('user_admin')
  update(
    @CurrentTenant() ctx: TenantContext,
    @Param('id') id: string,
    @Body() body: UpdateClientDto,
  ) {
    return this.service.update(ctx, id, body);
  }

  @Delete(':id')
  @Roles('user_admin')
  archive(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    return this.service.archive(ctx, id);
  }
}
