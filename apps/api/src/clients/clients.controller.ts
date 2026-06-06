import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Max,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
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

  @IsOptional()
  @IsString()
  profileType?: string;

  @IsOptional()
  @IsString()
  sectorTag?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  submissionTracks?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  issueCodes?: string[];

  @IsOptional()
  @IsString()
  profileStatus?: string;
}

class BulkImportClientsDto {
  // 500 cap is a sanity bound, most CSV imports we expect are <50 rows.
  // class-validator's array limits guard against accidental gigabyte
  // pastes that would otherwise OOM the per-tenant transaction.
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => CreateClientDto)
  rows!: CreateClientDto[];
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

  @IsOptional()
  @IsString()
  profileType?: string;

  @IsOptional()
  @IsString()
  sectorTag?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  submissionTracks?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  issueCodes?: string[];

  @IsOptional()
  @IsString()
  profileStatus?: string;
}

class ListClientsQueryDto {
  @IsOptional()
  @IsString()
  profileStatus?: string;

  @IsOptional()
  @IsString()
  sectorTag?: string;

  // Query params arrive as strings; compared against 'true' in the handler.
  @IsOptional()
  @IsString()
  includeArchived?: string;
}

class ClientLogoUploadUrlDto {
  @IsString()
  @IsIn(['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'])
  contentType!: string;

  @IsInt()
  @Min(1)
  @Max(2 * 1024 * 1024)
  contentLength!: number;
}

class ConfirmClientLogoUploadDto {
  @IsString()
  s3Key!: string;

  @IsString()
  @IsIn(['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'])
  contentType!: string;
}

class AppendClientNoteDto {
  @IsString()
  @Length(1, 4000)
  body!: string;
}

/**
 * Clients API, the lobbying firm's customer records.
 *
 * Read access: any tenant member (standard_user and above).
 * Create: any standard_user and above.
 * Update: user_admin or capiro_admin only.
 * Archive/remove: any standard_user and above.
 */
@Controller('clients')
@UseGuards(RolesGuard)
@Roles('standard_user')
export class ClientsController {
  constructor(private readonly service: ClientsService) {}

  @Get()
  list(@CurrentTenant() ctx: TenantContext, @Query() query: ListClientsQueryDto) {
    return this.service.list(ctx, {
      profileStatus: query.profileStatus,
      sectorTag: query.sectorTag,
      includeArchived: query.includeArchived === 'true',
    });
  }

  @Get(':id')
  get(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    return this.service.get(ctx, id);
  }

  @Post()
  create(@CurrentTenant() ctx: TenantContext, @Body() body: CreateClientDto) {
    return this.service.create(ctx, body);
  }

  // Bulk CSV import. The frontend parses the CSV client-side and POSTs the
  // already-typed row array, keeping multipart out of this controller.
  // Per-row errors are returned in the response (NOT thrown) so a single
  // bad row doesn't abort the whole import; the UI surfaces them inline.
  @Post('bulk-import')
  bulkImport(@CurrentTenant() ctx: TenantContext, @Body() body: BulkImportClientsDto) {
    return this.service.bulkImport(ctx, body.rows);
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
  @Roles('standard_user')
  archive(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    return this.service.archive(ctx, id);
  }

  // Quick Log: append a timestamped personal note to the client's profile
  // notes (intakeData.profileNotes), shown in the profile Documents → Notes.
  @Post(':id/notes')
  appendNote(
    @CurrentTenant() ctx: TenantContext,
    @Param('id') id: string,
    @Body() body: AppendClientNoteDto,
  ) {
    return this.service.appendClientNote(ctx, id, body.body);
  }

  @Post(':id/logo/upload-url')
  createLogoUploadUrl(
    @CurrentTenant() ctx: TenantContext,
    @Param('id') id: string,
    @Body() body: ClientLogoUploadUrlDto,
  ) {
    return this.service.createLogoUploadUrl(ctx, id, body.contentType, body.contentLength);
  }

  @Post(':id/logo/confirm')
  confirmLogoUpload(
    @CurrentTenant() ctx: TenantContext,
    @Param('id') id: string,
    @Body() body: ConfirmClientLogoUploadDto,
  ) {
    return this.service.confirmLogoUpload(ctx, id, body.s3Key, body.contentType);
  }
}
