import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { IsIn, IsInt, IsString, Max, Min } from 'class-validator';
import type { TenantContext } from '@capiro/shared';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { CurrentTenant } from '../tenant/current-tenant.decorator.js';
import { BrandingService } from './branding.service.js';

class UploadUrlDto {
  @IsString()
  @IsIn(['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'])
  contentType!: 'image/png' | 'image/jpeg' | 'image/svg+xml' | 'image/webp';

  @IsInt()
  @Min(1)
  @Max(2 * 1024 * 1024)
  contentLength!: number;
}

class ConfirmUploadDto {
  @IsString()
  s3Key!: string;

  @IsString()
  @IsIn(['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'])
  contentType!: 'image/png' | 'image/jpeg' | 'image/svg+xml' | 'image/webp';
}

@Controller('tenant-admin/branding')
@UseGuards(RolesGuard)
@Roles('user_admin')
export class BrandingController {
  constructor(private readonly service: BrandingService) {}

  @Get()
  get(@CurrentTenant() ctx: TenantContext) {
    return this.service.getBranding(ctx);
  }

  @Post('logo/upload-url')
  uploadUrl(@CurrentTenant() ctx: TenantContext, @Body() body: UploadUrlDto) {
    return this.service.createLogoUploadUrl(ctx, body.contentType, body.contentLength);
  }

  @Post('logo/confirm')
  confirm(@CurrentTenant() ctx: TenantContext, @Body() body: ConfirmUploadDto) {
    return this.service.confirmLogoUpload(ctx, body.s3Key, body.contentType);
  }
}
