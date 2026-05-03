import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import type { TenantContext } from '@capiro/shared';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { CurrentTenant } from '../tenant/current-tenant.decorator.js';
import { CapiroAdminService } from './capiro-admin.service.js';
import { IsEmail, IsOptional, IsString, IsUrl, IsUUID, Length, Matches } from 'class-validator';

class CreateTenantDto {
  @IsString()
  @Length(2, 63)
  @Matches(/^[a-z0-9][a-z0-9-]*$/, { message: 'slug must be lowercase [a-z0-9-]' })
  slug!: string;

  @IsString()
  @Length(2, 200)
  name!: string;

  @IsEmail()
  adminEmail!: string;

  @IsOptional()
  @IsUrl()
  redirectUrl?: string;
}

class ResendInvitationDto {
  @IsEmail()
  email!: string;

  @IsOptional()
  @IsUrl()
  redirectUrl?: string;
}

class ImpersonateDto {
  @IsUUID()
  tenantId!: string;

  @IsString()
  @Length(10, 500)
  reason!: string;
}

/**
 * Capiro Admin console API. Every route is gated by the capiro_admin role.
 * Routes here run cross-tenant — the caller's TenantContext is the
 * `capiro-internal` synthetic tenant; data access is via prisma.withSystem.
 */
@Controller('capiro-admin')
@UseGuards(RolesGuard)
@Roles('capiro_admin')
export class CapiroAdminController {
  constructor(private readonly service: CapiroAdminService) {}

  @Get('tenants')
  listTenants() {
    return this.service.listTenants();
  }

  @Post('tenants')
  createTenant(@CurrentTenant() ctx: TenantContext, @Body() body: CreateTenantDto) {
    return this.service.createTenantWithFirstAdmin(body, ctx);
  }

  @Get('tenants/:tenantId')
  getTenant(@Param('tenantId') tenantId: string) {
    return this.service.getTenant(tenantId);
  }

  @Post('tenants/:tenantId/admins/resend')
  resendAdminInvitation(@Param('tenantId') tenantId: string, @Body() body: ResendInvitationDto) {
    return this.service.resendAdminInvitation(tenantId, body.email, body.redirectUrl);
  }

  @Delete('tenants/:tenantId/users/:userId')
  removeUser(@Param('tenantId') tenantId: string, @Param('userId') userId: string) {
    return this.service.removeUserFromTenant(tenantId, userId);
  }

  @Post('users/:clerkUserId/password-reset')
  sendPasswordReset(@Param('clerkUserId') clerkUserId: string) {
    return this.service.sendPasswordReset(clerkUserId);
  }

  @Post('impersonate')
  startImpersonation(@CurrentTenant() ctx: TenantContext, @Body() body: ImpersonateDto) {
    return this.service.startImpersonation(ctx.userId, body.tenantId, body.reason);
  }

  @Post('impersonate/end')
  endImpersonation(@CurrentTenant() ctx: TenantContext) {
    return this.service.endImpersonation(ctx.userId);
  }
}
