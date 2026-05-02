import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  MinLength,
} from 'class-validator';
import type { TenantContext } from '@capiro/shared';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { CurrentTenant } from '../tenant/current-tenant.decorator.js';
import { TenantAdminService } from './tenant-admin.service.js';

class InviteDto {
  @IsEmail()
  email!: string;

  @IsString()
  @IsIn(['user_admin', 'standard_user'])
  role!: 'user_admin' | 'standard_user';

  @IsOptional()
  @IsUrl()
  redirectUrl?: string;
}

class UpdateBrandingDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsString()
  logoS3Key?: string;

  @IsOptional()
  @IsString()
  logoContentType?: string;
}

/**
 * Per-tenant admin endpoints. Caller must be `user_admin` (own tenant) or
 * `capiro_admin` (any tenant). The TenantContext is set by middleware; all
 * data access goes through prisma.withTenant which applies RLS.
 */
@Controller('tenant-admin')
@UseGuards(RolesGuard)
@Roles('user_admin')
export class TenantAdminController {
  constructor(private readonly service: TenantAdminService) {}

  @Get('team')
  team(@CurrentTenant() ctx: TenantContext) {
    return this.service.listTeam(ctx);
  }

  @Get('team/invitations')
  invitations(@CurrentTenant() ctx: TenantContext) {
    return this.service.listPendingInvitations(ctx);
  }

  @Post('team/invite')
  invite(@CurrentTenant() ctx: TenantContext, @Body() body: InviteDto) {
    return this.service.inviteTeamMember(ctx, body);
  }

  @Post('team/invitations/:invitationId/resend')
  resend(@CurrentTenant() ctx: TenantContext, @Param('invitationId') invitationId: string) {
    return this.service.resendInvitation(ctx, invitationId);
  }

  @Delete('team/:userId')
  remove(@CurrentTenant() ctx: TenantContext, @Param('userId') userId: string) {
    return this.service.removeMember(ctx, userId);
  }

  @Put('branding')
  branding(@CurrentTenant() ctx: TenantContext, @Body() body: UpdateBrandingDto) {
    return this.service.updateBranding(ctx, body);
  }

  @Get('billing')
  billing(@CurrentTenant() ctx: TenantContext) {
    return this.service.getBilling(ctx);
  }
}
