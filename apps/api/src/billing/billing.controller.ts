/**
 * Tenant-facing billing endpoints (/api/billing). Gated to tenant admins
 * (user_admin and above) and scoped to the caller's own tenant via ctx — there
 * is no tenantId input on this surface. Capiro-admin cross-tenant views live on
 * the capiro-admin console instead.
 */
import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { MIN_CLIENT_SLOTS, type TenantContext } from '@capiro/shared';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { CurrentTenant } from '../tenant/current-tenant.decorator.js';
import { BillingService } from './billing.service.js';

class CheckoutDto {
  @Type(() => Number)
  @IsInt()
  @Min(MIN_CLIENT_SLOTS)
  @Max(100_000)
  quantity!: number;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  promoCode?: string;
}

@Controller('billing')
@UseGuards(RolesGuard)
@Roles('user_admin')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  /** Current plan / slots / LLM usage — powers the settings page + subscribe gate. */
  @Get('summary')
  summary(@CurrentTenant() ctx: TenantContext) {
    return this.billing.getSummary(ctx);
  }

  /** Start a Checkout flow to subscribe or add slots; returns a hosted URL. */
  @Post('checkout')
  checkout(@CurrentTenant() ctx: TenantContext, @Body() body: CheckoutDto) {
    return this.billing.createCheckoutSession(ctx, {
      quantity: body.quantity,
      promoCode: body.promoCode,
    });
  }

  /** Open the Stripe Customer Portal (manage payment, change quantity, invoices). */
  @Post('portal')
  portal(@CurrentTenant() ctx: TenantContext) {
    return this.billing.createPortalSession(ctx);
  }
}
