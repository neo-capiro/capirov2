import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { IsEmail, IsOptional, IsString } from 'class-validator';
import type { TenantContext } from '@capiro/shared';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { CurrentTenant } from '../tenant/current-tenant.decorator.js';
import { ClientPeopleService } from './client-people.service.js';

class CreatePersonDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  role?: string;

  @IsOptional()
  @IsString()
  lastContact?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

class UpdatePersonDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  role?: string;

  @IsOptional()
  @IsString()
  lastContact?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

@Controller('clients/:clientId/people')
@UseGuards(RolesGuard)
@Roles('standard_user')
export class ClientPeopleController {
  constructor(private readonly service: ClientPeopleService) {}

  @Get()
  listPeople(@CurrentTenant() ctx: TenantContext, @Param('clientId') clientId: string) {
    return this.service.listPeople(ctx, clientId);
  }

  @Post()
  createPerson(
    @CurrentTenant() ctx: TenantContext,
    @Param('clientId') clientId: string,
    @Body() body: CreatePersonDto,
  ) {
    return this.service.createPerson(ctx, clientId, body);
  }

  @Patch(':id')
  updatePerson(
    @CurrentTenant() ctx: TenantContext,
    @Param('clientId') clientId: string,
    @Param('id') id: string,
    @Body() body: UpdatePersonDto,
  ) {
    return this.service.updatePerson(ctx, clientId, id, body);
  }

  @Delete(':id')
  deletePerson(
    @CurrentTenant() ctx: TenantContext,
    @Param('clientId') clientId: string,
    @Param('id') id: string,
  ) {
    return this.service.deletePerson(ctx, clientId, id);
  }
}
