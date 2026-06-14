import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Stripe from 'stripe';
import {
  type BillingStatus,
  type BillingSummary,
  type TenantContext,
  MIN_CLIENT_SLOTS,
  LLM_OVERAGE_MULTIPLIER,
  LLM_WARN_THRESHOLD,
  monthlySlotCostUsd,
  pricePerSlotUsd,
} from '@capiro/shared';
import type { AppConfig } from '../config/config.schema.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AiUsageService } from '../ai-usage/ai-usage.service.js';
import { StripeClient } from './stripe.client.js';

/**
 * Maps a Stripe subscription status to our coarser BillingStatus. We never map
 * to 'comped' — that is a manual, Capiro-set state that must not be clobbered
 * by webhook syncs (see syncSubscription's guard).
 */
function mapStripeStatus(status: Stripe.Subscription.Status): BillingStatus {
  switch (status) {
    case 'active':
      return 'active';
    case 'trialing':
      return 'trialing';
    case 'past_due':
    case 'unpaid':
      return 'past_due';
    case 'canceled':
    case 'incomplete_expired':
      return 'canceled';
    case 'incomplete':
    case 'paused':
    default:
      return 'none';
  }
}

/**
 * Start of the current billing period for usage/allowance math. Aligns to the
 * Stripe period when known (monthly), else the first of the calendar month
 * (UTC). Day-aligned so it is a stable key for tenant_usage_meters.
 */
export function billingPeriodStart(currentPeriodEnd: Date | null | undefined): Date {
  if (currentPeriodEnd) {
    const start = new Date(currentPeriodEnd);
    start.setUTCMonth(start.getUTCMonth() - 1);
    start.setUTCHours(0, 0, 0, 0);
    return start;
  }
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeClient,
    private readonly aiUsage: AiUsageService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  private get slotsPriceId(): string {
    const id = this.config.get('STRIPE_PRICE_SLOTS', { infer: true });
    if (!id) throw new BadRequestException('Slot price is not configured (STRIPE_PRICE_SLOTS).');
    return id;
  }

  private get overagePriceId(): string | undefined {
    return this.config.get('STRIPE_PRICE_OVERAGE', { infer: true });
  }

  private get returnBase(): string {
    return this.config.get('BILLING_RETURN_URL', { infer: true });
  }

  // ---------------------------------------------------------------------------
  // Checkout (pay at sign-up + add slots)
  // ---------------------------------------------------------------------------

  /**
   * Create a Stripe Checkout Session for a subscription with `quantity` client
   * slots (clamped to the minimum) plus the metered LLM-overage line. Returns
   * the hosted Checkout URL. Payment methods (card/Apple Pay/Google Pay/Link/
   * PayPal/Cash App) are NOT pinned here — they are taken from the dashboard's
   * configured methods, so enabling a new method needs no code change.
   */
  async createCheckoutSession(
    ctx: TenantContext,
    opts: { quantity: number; promoCode?: string },
  ): Promise<{ url: string }> {
    const stripe = this.stripe.require();
    const quantity = Math.max(MIN_CLIENT_SLOTS, Math.floor(opts.quantity || 0));

    const customerId = await this.ensureCustomer(ctx, stripe);

    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
      { price: this.slotsPriceId, quantity },
    ];
    if (this.overagePriceId) {
      // Metered prices carry no quantity.
      lineItems.push({ price: this.overagePriceId });
    }

    // Promotion code: if the caller supplied one, resolve it to a promotion-code
    // id and apply it directly (Checkout forbids combining an explicit discount
    // with allow_promotion_codes). Otherwise let the customer type one in.
    let discounts: Stripe.Checkout.SessionCreateParams.Discount[] | undefined;
    let allowPromotionCodes: boolean | undefined = true;
    if (opts.promoCode?.trim()) {
      const code = opts.promoCode.trim();
      const found = await stripe.promotionCodes.list({ code, active: true, limit: 1 });
      const promo = found.data[0];
      if (!promo) throw new BadRequestException(`Promo code "${code}" is not valid.`);
      discounts = [{ promotion_code: promo.id }];
      allowPromotionCodes = undefined;
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      client_reference_id: ctx.tenantId,
      line_items: lineItems,
      discounts,
      allow_promotion_codes: allowPromotionCodes,
      subscription_data: {
        metadata: { tenantId: ctx.tenantId, tenantSlug: ctx.tenantSlug },
      },
      metadata: { tenantId: ctx.tenantId, tenantSlug: ctx.tenantSlug },
      success_url: `${this.returnBase}/onboarding/subscribe?status=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${this.returnBase}/onboarding/subscribe?status=cancelled`,
    });

    if (!session.url) throw new BadRequestException('Stripe did not return a Checkout URL.');
    return { url: session.url };
  }

  /**
   * Create a Stripe Customer Portal session (manage card, change slot quantity,
   * view invoices). This is the "payment/billing" link surfaced under Settings
   * and behind the slot-limit upgrade CTA.
   */
  async createPortalSession(ctx: TenantContext): Promise<{ url: string }> {
    const stripe = this.stripe.require();
    const tenant = await this.prisma.withTenant(ctx.tenantId, (tx) =>
      tx.tenant.findUnique({ where: { id: ctx.tenantId }, select: { stripeCustomerId: true } }),
    );
    if (!tenant?.stripeCustomerId) {
      throw new BadRequestException('No billing account yet — subscribe first.');
    }
    const session = await stripe.billingPortal.sessions.create({
      customer: tenant.stripeCustomerId,
      return_url: `${this.returnBase}/settings/billing`,
    });
    return { url: session.url };
  }

  /** Find-or-create the tenant's Stripe customer, persisting the id. */
  private async ensureCustomer(ctx: TenantContext, stripe: Stripe): Promise<string> {
    const { tenant, email } = await this.prisma.withTenant(ctx.tenantId, async (tx) => {
      const tenant = await tx.tenant.findUnique({
        where: { id: ctx.tenantId },
        select: { name: true, slug: true, stripeCustomerId: true },
      });
      let email: string | undefined;
      try {
        const user = await tx.user.findUnique({
          where: { id: ctx.userId },
          select: { email: true },
        });
        email = user?.email ?? undefined;
      } catch {
        email = undefined;
      }
      return { tenant, email };
    });
    if (tenant?.stripeCustomerId) return tenant.stripeCustomerId;

    const customer = await stripe.customers.create({
      name: tenant?.name,
      email,
      metadata: { tenantId: ctx.tenantId, tenantSlug: ctx.tenantSlug },
    });
    await this.prisma.withTenant(ctx.tenantId, (tx) =>
      tx.tenant.update({
        where: { id: ctx.tenantId },
        data: { stripeCustomerId: customer.id },
      }),
    );
    return customer.id;
  }

  // ---------------------------------------------------------------------------
  // Summary (powers Settings billing page, subscribe screen, slot CTA)
  // ---------------------------------------------------------------------------

  async getSummary(ctx: TenantContext): Promise<BillingSummary> {
    const [tenant, usedSlots] = await this.prisma.withTenant(ctx.tenantId, async (tx) => {
      const tenant = await tx.tenant.findUnique({
        where: { id: ctx.tenantId },
        select: {
          billingStatus: true,
          clientSlots: true,
          llmAllowanceUsdPerSlot: true,
          llmHardCapUsd: true,
          currentPeriodEnd: true,
          stripeCustomerId: true,
          stripeSubscriptionId: true,
        },
      });
      const usedSlots = await tx.client.count({
        where: { tenantId: ctx.tenantId, status: { not: 'archived' } },
      });
      return [tenant, usedSlots] as const;
    });

    const slots = tenant?.clientSlots ?? 0;
    const allowancePerSlot = Number(tenant?.llmAllowanceUsdPerSlot ?? 20);
    const llmAllowanceUsd = slots * allowancePerSlot;

    const periodStart = billingPeriodStart(tenant?.currentPeriodEnd ?? null);
    const usage = await this.aiUsage.tenantSummaryByTenantId(ctx.tenantId, { from: periodStart });
    const llmUsedUsd = usage.totalCostUsd;
    const llmOverageUsd =
      llmAllowanceUsd > 0 ? Math.max(0, llmUsedUsd - llmAllowanceUsd) * LLM_OVERAGE_MULTIPLIER : 0;
    const llmWarn = llmAllowanceUsd > 0 && llmUsedUsd >= llmAllowanceUsd * LLM_WARN_THRESHOLD;

    return {
      billingEnabled: this.stripe.enabled,
      status: (tenant?.billingStatus ?? 'none') as BillingStatus,
      slots,
      usedSlots,
      pricePerSlotUsd: pricePerSlotUsd(slots || MIN_CLIENT_SLOTS),
      llmAllowanceUsd,
      llmUsedUsd,
      llmOverageUsd,
      llmWarn,
      llmHardCapUsd: tenant?.llmHardCapUsd != null ? Number(tenant.llmHardCapUsd) : null,
      currentPeriodEnd: tenant?.currentPeriodEnd ? tenant.currentPeriodEnd.toISOString() : null,
      hasSubscription: Boolean(tenant?.stripeCustomerId),
    };
  }

  // ---------------------------------------------------------------------------
  // Webhook sync (source of truth = Stripe)
  // ---------------------------------------------------------------------------

  /** Resolve + sync the subscription referenced by a completed Checkout Session. */
  async handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
    const stripe = this.stripe.require();
    const subId =
      typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
    if (!subId) {
      this.logger.warn(`checkout.session.completed ${session.id} had no subscription`);
      return;
    }
    const sub = await stripe.subscriptions.retrieve(subId);
    await this.syncSubscription(sub);
  }

  /**
   * Write subscription state onto the owning tenant. Tenant is located by
   * Stripe customer id, falling back to the tenantId we stamp in metadata.
   * Never downgrades a 'comped' tenant.
   */
  async syncSubscription(sub: Stripe.Subscription): Promise<void> {
    const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
    const metaTenantId = (sub.metadata?.tenantId as string | undefined) ?? undefined;

    const slotsItem = sub.items.data.find(
      (i) => i.price?.id === this.config.get('STRIPE_PRICE_SLOTS', { infer: true }),
    );
    const slots = slotsItem?.quantity ?? undefined;
    const periodEndUnix =
      (sub as unknown as { current_period_end?: number }).current_period_end ??
      (sub.items.data[0] as unknown as { current_period_end?: number } | undefined)
        ?.current_period_end;
    const currentPeriodEnd = periodEndUnix ? new Date(periodEndUnix * 1000) : null;
    const mapped = mapStripeStatus(sub.status);

    await this.prisma.withSystem(async (tx) => {
      const tenant =
        (await tx.tenant.findFirst({ where: { stripeCustomerId: customerId } })) ??
        (metaTenantId ? await tx.tenant.findUnique({ where: { id: metaTenantId } }) : null);
      if (!tenant) {
        this.logger.warn(
          `syncSubscription: no tenant for customer ${customerId} / meta ${metaTenantId ?? '∅'}`,
        );
        return;
      }
      // Don't let a webhook clobber a manually comped tenant.
      const nextStatus = tenant.billingStatus === 'comped' ? 'comped' : mapped;
      await tx.tenant.update({
        where: { id: tenant.id },
        data: {
          stripeCustomerId: customerId,
          stripeSubscriptionId: sub.status === 'canceled' ? null : sub.id,
          billingStatus: nextStatus,
          ...(slots != null ? { clientSlots: slots } : {}),
          currentPeriodEnd,
        },
      });
      this.logger.log(
        `Synced subscription ${sub.id} → tenant ${tenant.slug}: status=${nextStatus} slots=${slots ?? 'unchanged'}`,
      );
    });
  }

  // ---------------------------------------------------------------------------
  // Capiro-admin: cross-tenant customer list + comp toggle
  // ---------------------------------------------------------------------------

  /**
   * Every tenant with its billing posture + month-to-date LLM spend, for the
   * capiro-admin "Customers" console. Cross-tenant (withSystem) — only reachable
   * behind the capiro_admin guard at the controller layer. MRR is the recurring
   * slot revenue for paying statuses (comped/none/canceled contribute $0).
   */
  async adminListCustomers(): Promise<AdminCustomerRow[]> {
    const { tenants, slotCounts } = await this.prisma.withSystem(async (tx) => {
      const tenants = await tx.tenant.findMany({
        select: {
          id: true,
          slug: true,
          name: true,
          billingStatus: true,
          clientSlots: true,
          llmAllowanceUsdPerSlot: true,
          currentPeriodEnd: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      });
      const slotCounts = await tx.client.groupBy({
        by: ['tenantId'],
        where: { status: { not: 'archived' } },
        _count: { _all: true },
      });
      return { tenants, slotCounts };
    });

    const usage = await this.aiUsage.adminAllTenantsSummary();
    const usedByTenant = new Map(usage.map((u) => [u.tenantId, u.totalCostUsd]));
    const slotsUsedByTenant = new Map(slotCounts.map((s) => [s.tenantId, s._count._all]));

    return tenants.map((t) => {
      const status = t.billingStatus as BillingStatus;
      const paying = status === 'active' || status === 'trialing' || status === 'past_due';
      const allowanceUsd = t.clientSlots * Number(t.llmAllowanceUsdPerSlot);
      const llmUsedUsd = usedByTenant.get(t.id) ?? 0;
      const llmOverageUsd =
        allowanceUsd > 0 ? Math.max(0, llmUsedUsd - allowanceUsd) * LLM_OVERAGE_MULTIPLIER : 0;
      return {
        tenantId: t.id,
        slug: t.slug,
        name: t.name,
        status,
        slots: t.clientSlots,
        usedSlots: slotsUsedByTenant.get(t.id) ?? 0,
        pricePerSlotUsd: pricePerSlotUsd(t.clientSlots || MIN_CLIENT_SLOTS),
        mrrUsd: paying ? monthlySlotCostUsd(t.clientSlots) : 0,
        llmUsedUsd,
        llmOverageUsd,
        currentPeriodEnd: t.currentPeriodEnd ? t.currentPeriodEnd.toISOString() : null,
        createdAt: t.createdAt.toISOString(),
      };
    });
  }

  /**
   * Comp (or un-comp) a tenant. Comped tenants bypass slot enforcement and LLM
   * overage; un-comping returns them to 'none' (they must subscribe). Used by
   * the capiro-admin console for Capiro's own + courtesy accounts.
   */
  async setComped(tenantId: string, comped: boolean): Promise<{ status: BillingStatus }> {
    const status: BillingStatus = comped ? 'comped' : 'none';
    await this.prisma.withSystem((tx) =>
      tx.tenant.update({ where: { id: tenantId }, data: { billingStatus: status } }),
    );
    this.logger.log(`Tenant ${tenantId} billing set to ${status}`);
    return { status };
  }
}

export interface AdminCustomerRow {
  tenantId: string;
  slug: string;
  name: string;
  status: BillingStatus;
  slots: number;
  usedSlots: number;
  pricePerSlotUsd: number;
  mrrUsd: number;
  llmUsedUsd: number;
  llmOverageUsd: number;
  currentPeriodEnd: string | null;
  createdAt: string;
}
