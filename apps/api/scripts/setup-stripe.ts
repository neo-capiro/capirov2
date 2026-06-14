/**
 * One-shot, idempotent Stripe resource bootstrap for Capiro billing.
 *
 *   STRIPE_SECRET_KEY=sk_test_... BILLING_RETURN_URL=http://localhost:5173 \
 *     pnpm --filter @capiro/api exec tsx scripts/setup-stripe.ts
 *
 * Creates (or reuses, keyed by price lookup_key / promo code / webhook url):
 *   • Product "Capiro Client Slots"  → recurring monthly, tiered VOLUME price
 *       10–49 = $200, 50–99 = $180, 100+ = $160   (lookup_key capiro_client_slots)
 *   • Product "Capiro LLM Overage"   → metered price, $0.01 per unit, bound to a
 *       Billing Meter "llm_overage_cents" (sum)    (lookup_key capiro_llm_overage)
 *   • 100%-off forever coupon + promotion code CAPIRO-INTERNAL (staff / comp)
 *   • Webhook endpoint → {BILLING_RETURN_URL}/webhooks/stripe (prints the secret)
 *
 * Prints the env values to wire into Secrets Manager. Safe to re-run.
 *
 * NOT done here (must be set in the Stripe Dashboard once):
 *   • Enable payment methods: card, link, paypal, cashapp (Apple/Google Pay are
 *     automatic on hosted Checkout — no domain registration needed).
 *   • Customer Portal: allow quantity changes, payment-method updates, invoices.
 */
import { config as dotenvConfig } from 'dotenv';
import Stripe from 'stripe';

dotenvConfig();

const PROMO_CODE = 'CAPIRO-INTERNAL';
const METER_EVENT = process.env.STRIPE_OVERAGE_METER_EVENT ?? 'llm_overage_cents';
const SLOTS_LOOKUP = 'capiro_client_slots';
const OVERAGE_LOOKUP = 'capiro_llm_overage';

async function main(): Promise<void> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is required');
  const returnUrl = process.env.BILLING_RETURN_URL ?? 'https://app.capiro.ai';
  const stripe = new Stripe(key, { appInfo: { name: 'Capiro setup' } });
  const log = (...a: unknown[]) => console.log(...a);

  // --- Slots price (tiered volume) ------------------------------------------
  let slotsPrice = (await stripe.prices.list({ lookup_keys: [SLOTS_LOOKUP], limit: 1 })).data[0];
  if (!slotsPrice) {
    const product = await stripe.products.create({
      name: 'Capiro Client Slots',
      metadata: { capiro_role: 'client_slots' },
    });
    slotsPrice = await stripe.prices.create({
      currency: 'usd',
      product: product.id,
      lookup_key: SLOTS_LOOKUP,
      recurring: { interval: 'month' },
      billing_scheme: 'tiered',
      tiers_mode: 'volume',
      tiers: [
        { up_to: 49, unit_amount: 20_000 },
        { up_to: 99, unit_amount: 18_000 },
        { up_to: 'inf', unit_amount: 16_000 },
      ],
    });
    log(`✓ created slots price ${slotsPrice.id}`);
  } else {
    log(`= reusing slots price ${slotsPrice.id}`);
  }

  // --- Overage meter + metered price ----------------------------------------
  let overagePrice = (await stripe.prices.list({ lookup_keys: [OVERAGE_LOOKUP], limit: 1 }))
    .data[0];
  if (!overagePrice) {
    const meters = await stripe.billing.meters.list({ status: 'active', limit: 100 });
    const meter =
      meters.data.find((m) => m.event_name === METER_EVENT) ??
      (await stripe.billing.meters.create({
        display_name: 'Capiro LLM overage (cents)',
        event_name: METER_EVENT,
        default_aggregation: { formula: 'sum' },
        customer_mapping: { type: 'by_id', event_payload_key: 'stripe_customer_id' },
        value_settings: { event_payload_key: 'value' },
      }));
    const product = await stripe.products.create({
      name: 'Capiro LLM Overage',
      metadata: { capiro_role: 'llm_overage' },
    });
    overagePrice = await stripe.prices.create({
      currency: 'usd',
      product: product.id,
      lookup_key: OVERAGE_LOOKUP,
      unit_amount: 1, // 1¢ per reported unit; we report cents of billable overage
      recurring: { interval: 'month', usage_type: 'metered', meter: meter.id },
    });
    log(`✓ created overage meter ${meter.id} + price ${overagePrice.id}`);
  } else {
    log(`= reusing overage price ${overagePrice.id}`);
  }

  // --- Comp promo code -------------------------------------------------------
  const existingPromo = (await stripe.promotionCodes.list({ code: PROMO_CODE, limit: 1 })).data[0];
  if (!existingPromo) {
    const coupon = await stripe.coupons.create({
      percent_off: 100,
      duration: 'forever',
      name: 'Capiro Internal / Comp',
    });
    const promo = await stripe.promotionCodes.create({ coupon: coupon.id, code: PROMO_CODE });
    log(`✓ created promo code ${promo.code} (coupon ${coupon.id})`);
  } else {
    log(`= reusing promo code ${existingPromo.code}`);
  }

  // --- Webhook endpoint ------------------------------------------------------
  const webhookUrl = `${returnUrl.replace(/\/$/, '')}/webhooks/stripe`;
  const endpoints = await stripe.webhookEndpoints.list({ limit: 100 });
  const existingHook = endpoints.data.find((e) => e.url === webhookUrl);
  let webhookSecret = '(unchanged — secret only shown at creation)';
  if (!existingHook) {
    const hook = await stripe.webhookEndpoints.create({
      url: webhookUrl,
      enabled_events: [
        'checkout.session.completed',
        'customer.subscription.created',
        'customer.subscription.updated',
        'customer.subscription.deleted',
        'invoice.payment_failed',
      ],
    });
    webhookSecret = hook.secret ?? '(none)';
    log(`✓ created webhook endpoint ${hook.id} → ${webhookUrl}`);
  } else {
    log(`= reusing webhook endpoint ${existingHook.id} → ${webhookUrl}`);
  }

  log('\n──────────── wire these into the API env / Secrets Manager ────────────');
  log(`STRIPE_PRICE_SLOTS=${slotsPrice.id}`);
  log(`STRIPE_PRICE_OVERAGE=${overagePrice.id}`);
  log(`STRIPE_OVERAGE_METER_EVENT=${METER_EVENT}`);
  log(`STRIPE_WEBHOOK_SECRET=${webhookSecret}`);
  log('(STRIPE_SECRET_KEY is the key you ran this with.)');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('setup-stripe failed', err);
  process.exit(1);
});
