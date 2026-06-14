# Billing (Stripe-direct) — setup & deploy runbook

Stripe-direct billing: our API drives Checkout + Customer Portal + webhooks; Clerk stays the identity layer. Pricing is the single source of truth in `packages/shared` (`CLIENT_SLOT_TIERS`, `LLM_ALLOWANCE_USD_PER_SLOT`, `LLM_OVERAGE_MULTIPLIER`).

## Pricing recap

- **Client slots:** $200/slot/mo, **10 minimum**. Volume tiers (all-units): 10–49 = $200, 50–99 = $180, 100+ = $160.
- **Slot cap:** creating a client beyond purchased slots → HTTP 402 `CLIENT_SLOT_LIMIT` → one-click "Add client slots" (portal). `comped` tenants bypass.
- **LLM usage:** included allowance = **$20 × slots/mo, pooled**. Above it, overage billed at **2× our real cost**; soft warning at 80%. Optional admin hard cap (`Tenant.llmHardCapUsd`, off by default) blocks generation instead of billing.
- **Comp/promo:** Stripe promo code `CAPIRO-INTERNAL` (100% off) + per-tenant `comped` status (admin toggle).

## One-time Stripe setup

1. **Create resources (idempotent):**
   ```
   STRIPE_SECRET_KEY=sk_live_... BILLING_RETURN_URL=https://app.capiro.ai \
     pnpm --filter @capiro/api exec tsx scripts/setup-stripe.ts
   ```
   Prints `STRIPE_PRICE_SLOTS`, `STRIPE_PRICE_OVERAGE`, `STRIPE_OVERAGE_METER_EVENT`, `STRIPE_WEBHOOK_SECRET`. It creates the slots product/price (tiered volume), the LLM-overage meter + metered price, the `CAPIRO-INTERNAL` promo code, and the `…/webhooks/stripe` webhook endpoint.
2. **Dashboard (not scriptable):**
   - **Payment methods** → enable `card`, `link`, `paypal`, `cashapp`. Apple Pay / Google Pay are automatic on hosted Checkout (no domain registration needed).
   - **Customer Portal** → allow: update payment method, change quantity on the slots price, view invoices; set the return to `https://app.capiro.ai/settings/billing`.

## Secrets to wire (Secrets Manager → API env, out-of-band like the AI keys)

| Var                          | Source                                             |
| ---------------------------- | -------------------------------------------------- |
| `STRIPE_SECRET_KEY`          | Stripe dashboard (restricted key OK)               |
| `STRIPE_WEBHOOK_SECRET`      | from `setup-stripe.ts` output / dashboard endpoint |
| `STRIPE_PRICE_SLOTS`         | `setup-stripe.ts` output                           |
| `STRIPE_PRICE_OVERAGE`       | `setup-stripe.ts` output                           |
| `STRIPE_OVERAGE_METER_EVENT` | `llm_overage_cents` (default)                      |
| `BILLING_RETURN_URL`         | `https://app.capiro.ai` (per env)                  |

All are **optional** in config — with `STRIPE_SECRET_KEY` unset the app boots and billing is simply inactive (checkout/portal 503, webhook 204-ignored, overage job no-ops).

## Dormant by default

Billing is **OFF until `STRIPE_SECRET_KEY` is set** (`billingEnabled=false`). While dormant there is **no paywall, no client-slot cap, and no overage metering** — the app behaves exactly as before. This lets the code ship to staging/prod inert and be activated later. Surfaces gated on this: the web `BillingGate`, `ClientsService` slot cap, `BillingService.getSummary().billingEnabled`, the overage job, and the Stripe webhook.

## Initial deploy (dormant — safe, no user impact)

1. `prisma migrate deploy` (applies `20260614120000_billing`). **Never `migrate dev` on the local `capiro` DB** (known drift).
2. Roll API + web (`scripts/deploy-dev.sh`). Build is **arm64** (`docker buildx --platform linux/arm64`). No secrets needed yet; billing stays dormant.
3. The ALB already routes `/webhooks/*` → API (out-of-band rule, priority 15), so `/webhooks/stripe` is covered — don't drop that rule on a `cdk deploy`.

## Activation (later — turning billing ON)

Order matters: comp first, then wire the key (flipping `STRIPE_SECRET_KEY` activates the paywall for every `none` tenant).

1. Run `setup-stripe` (above) and complete the dashboard steps.
2. **Comp existing tenants so nobody is locked out:**
   ```
   pnpm --filter @capiro/api exec tsx scripts/comp-existing-tenants.ts          # dry-run
   pnpm --filter @capiro/api exec tsx scripts/comp-existing-tenants.ts --commit # apply
   ```
   New tenants created after this default to `none` and must subscribe.
3. Wire the Stripe secrets (incl. `STRIPE_SECRET_KEY`) and roll the API → billing goes live; schedule the daily overage job.

## Scheduled overage job

Run **daily** as a one-off ECS task (same pattern as the `sync:*` scheduled tasks), e.g. EventBridge → RunTask:

```
pnpm --filter @capiro/api exec tsx scripts/report-llm-overage.ts
```

Computes MTD cost vs allowance per paying tenant and reports the incremental 2× overage to the Stripe meter. Idempotent via `tenant_usage_meters` (no double-billing on re-run).

## Local testing

```
# 1. env: STRIPE_SECRET_KEY=sk_test_…, STRIPE_PRICE_SLOTS/OVERAGE, BILLING_RETURN_URL=http://localhost:5173
# 2. forward webhooks and capture the signing secret it prints into STRIPE_WEBHOOK_SECRET
stripe listen --forward-to localhost:4000/webhooks/stripe
# 3. sign up a fresh tenant → redirected to /onboarding/subscribe → pay with test card 4242 4242 4242 4242
#    → webhook flips billing_status=active → add clients up to N → N+1 → 402 + upgrade modal
# 4. apply promo CAPIRO-INTERNAL at checkout → $0
```

## Files

- API: `apps/api/src/billing/*` (stripe client, service, controller, webhook, overage service), enforcement in `clients.service.ts`, hard cap in `engagement/ai-credential-resolver.service.ts`, admin endpoints in `capiro-admin.controller.ts`.
- Web: `pages/onboarding/SubscribePage.tsx`, `pages/admin/BillingPage.tsx`, `pages/admin/CustomersPage.tsx`, `lib/billing.ts`, `BillingGate` in `App.tsx`.
- Shared: pricing/types in `packages/shared/src/index.ts`.
- Migration: `apps/api/prisma/migrations/20260614120000_billing/`.
