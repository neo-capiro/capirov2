import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { IsOptional, IsString, Length, MaxLength } from 'class-validator';
import type { TenantContext } from '@capiro/shared';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { CurrentTenant } from '../tenant/current-tenant.decorator.js';
import { DirectoryService } from './directory.service.js';

class CreateDirectoryContactNoteDto {
  @IsString()
  @Length(1, 4000)
  body!: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  directoryContactName?: string;
}

@Controller('directory')
@UseGuards(RolesGuard)
@Roles('standard_user')
export class DirectoryController {
  constructor(private readonly service: DirectoryService) {}

  @Get('contacts')
  contacts(
    @Query('q') q?: string,
    @Query('freshman') freshman?: string,
    @Query('chamber') chamber?: string,
    @Query('party') party?: string | string[],
    @Query('gender') gender?: string,
    @Query('leadership') leadership?: string | string[],
    @Query('caucus') caucus?: string | string[],
    @Query('region') region?: string,
    @Query('state') state?: string | string[],
    @Query('district') district?: string | string[],
    @Query('education') education?: string | string[],
    @Query('sort') sort?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.service.getContacts({
      q,
      freshman,
      chamber,
      party,
      gender,
      leadership,
      caucus,
      region,
      state,
      district,
      education,
      sort,
      page,
      pageSize,
    });
  }

  @Get('contacts/:contactId/notes')
  contactNotes(@CurrentTenant() ctx: TenantContext, @Param('contactId') contactId: string) {
    return this.service.listContactNotes(ctx, contactId);
  }

  @Post('contacts/:contactId/notes')
  createContactNote(
    @CurrentTenant() ctx: TenantContext,
    @Param('contactId') contactId: string,
    @Body() body: CreateDirectoryContactNoteDto,
  ) {
    return this.service.createContactNote(ctx, contactId, body);
  }
}
