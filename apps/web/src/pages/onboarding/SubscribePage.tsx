import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { App, Button, Card, Col, Input, InputNumber, Row, Statistic, Tag, Typography } from 'antd';
import { useClerk } from '@clerk/clerk-react';
import {
  CLIENT_SLOT_TIERS,
  LLM_ALLOWANCE_USD_PER_SLOT,
  LLM_OVERAGE_MULTIPLIER,
  MIN_CLIENT_SLOTS,
  isBillingEntitled,
  monthlySlotCostUsd,
  pricePerSlotUsd,
} from '@capiro/shared';
import { useBilling, useCheckout } from '../../lib/billing.js';

const BASE_PRICE = CLIENT_SLOT_TIERS[CLIENT_SLOT_TIERS.length - 1]!.pricePerSlotUsd; // $200 @ 10+

// Marketing tiers for the three plan cards, derived from the shared price ladder
// so copy can never drift from what Stripe actually charges.
const SORTED_TIERS = [...CLIENT_SLOT_TIERS].sort((a, b) => a.minSlots - b.minSlots);
const PLAN_CARDS = SORTED_TIERS.map((t, i) => {
  const upper = i < SORTED_TIERS.length - 1 ? SORTED_TIERS[i + 1]!.minSlots - 1 : null;
  return {
    name: ['Starter', 'Growth', 'Scale'][i] ?? `Tier ${i + 1}`,
    minSlots: t.minSlots,
    pricePerSlotUsd: t.pricePerSlotUsd,
    savePct: Math.round((1 - t.pricePerSlotUsd / BASE_PRICE) * 100),
    rangeLabel: upper ? `${t.minSlots}–${upper} client slots` : `${t.minSlots}+ client slots`,
  };
});

export function SubscribePage() {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const { signOut } = useClerk();
  const [params] = useSearchParams();
  const justReturned = params.get('status'); // 'success' | 'cancelled' | null

  const billing = useBilling();
  const checkout = useCheckout();
  const [quantity, setQuantity] = useState<number>(MIN_CLIENT_SLOTS);
  const [promoCode, setPromoCode] = useState('');

  const entitled = billing.data ? isBillingEntitled(billing.data.status) : false;
  // Leave the paywall when already entitled OR when billing is dormant on this
  // environment (Stripe not configured) — there is nothing to subscribe to.
  const shouldLeave = billing.data ? entitled || !billing.data.billingEnabled : false;

  useEffect(() => {
    if (shouldLeave) navigate('/', { replace: true });
  }, [shouldLeave, navigate]);

  // After returning from Checkout, poll until the webhook flips us to active.
  useEffect(() => {
    if (justReturned === 'success' && !entitled) {
      const id = setInterval(() => void billing.refetch(), 2500);
      return () => clearInterval(id);
    }
    return undefined;
  }, [justReturned, entitled, billing]);

  useEffect(() => {
    if (justReturned === 'cancelled')
      message.info('Checkout cancelled — your card was not charged.');
  }, [justReturned, message]);

  const pricePerSlot = pricePerSlotUsd(quantity);
  const monthlyTotal = monthlySlotCostUsd(quantity);
  const includedLlm = quantity * LLM_ALLOWANCE_USD_PER_SLOT;

  const onSubscribe = () => {
    checkout.mutate(
      { quantity, promoCode: promoCode.trim() || undefined },
      { onError: (e) => message.error((e as Error).message || 'Could not start checkout') },
    );
  };

  const waiting = justReturned === 'success' && !entitled;

  return (
    <main style={{ minHeight: '100vh', background: '#0b1f3a', padding: '48px 16px' }}>
      <div style={{ maxWidth: 1000, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 8 }}>
          <img src="/logo.png" alt="Capiro" style={{ height: 44, marginBottom: 16 }} />
          <Typography.Title level={2} style={{ color: '#fff', margin: 0 }}>
            Welcome to Capiro
          </Typography.Title>
          <Typography.Paragraph style={{ color: '#b9c6da', marginTop: 8 }}>
            Choose how many client slots you need to get started. ${BASE_PRICE} per client / month,{' '}
            {MIN_CLIENT_SLOTS} client minimum — volume discounts kick in as you grow.
          </Typography.Paragraph>
        </div>

        {waiting ? (
          <Card style={{ maxWidth: 520, margin: '24px auto', textAlign: 'center' }} loading>
            Finalizing your subscription…
          </Card>
        ) : (
          <>
            <Row gutter={[16, 16]} justify="center" style={{ marginBottom: 24 }}>
              {PLAN_CARDS.map((card) => {
                const selected = quantity >= card.minSlots && pricePerSlot === card.pricePerSlotUsd;
                return (
                  <Col xs={24} sm={8} key={card.name}>
                    <Card
                      hoverable
                      onClick={() => setQuantity((q) => Math.max(q, card.minSlots))}
                      style={{
                        borderColor: selected ? '#1677ff' : undefined,
                        borderWidth: selected ? 2 : 1,
                        height: '100%',
                      }}
                    >
                      <Typography.Title level={4} style={{ marginTop: 0 }}>
                        {card.name}{' '}
                        {card.savePct > 0 && <Tag color="green">Save {card.savePct}%</Tag>}
                      </Typography.Title>
                      <Statistic
                        value={card.pricePerSlotUsd}
                        prefix="$"
                        suffix="/ slot / mo"
                        valueStyle={{ fontSize: 28 }}
                      />
                      <Typography.Paragraph type="secondary" style={{ marginTop: 8 }}>
                        {card.rangeLabel}
                      </Typography.Paragraph>
                    </Card>
                  </Col>
                );
              })}
            </Row>

            <Card style={{ maxWidth: 560, margin: '0 auto' }}>
              <Row gutter={16} align="bottom">
                <Col flex="auto">
                  <Typography.Text strong>Client slots</Typography.Text>
                  <InputNumber
                    min={MIN_CLIENT_SLOTS}
                    max={100000}
                    value={quantity}
                    onChange={(v) =>
                      setQuantity(Math.max(MIN_CLIENT_SLOTS, Math.floor(v ?? MIN_CLIENT_SLOTS)))
                    }
                    style={{ width: '100%' }}
                    size="large"
                  />
                </Col>
                <Col>
                  <Statistic
                    title={`$${pricePerSlot} / slot`}
                    value={monthlyTotal}
                    prefix="$"
                    suffix="/ mo"
                  />
                </Col>
              </Row>

              <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 12 }}>
                Includes <strong>${includedLlm.toLocaleString()}/mo</strong> of AI usage ($
                {LLM_ALLOWANCE_USD_PER_SLOT} per slot, pooled). Beyond that, AI usage is billed at{' '}
                {LLM_OVERAGE_MULTIPLIER}× cost. Cancel or change anytime.
              </Typography.Paragraph>

              <Typography.Text strong>Promo code (optional)</Typography.Text>
              <Input
                placeholder="Enter a promotion code"
                value={promoCode}
                onChange={(e) => setPromoCode(e.target.value)}
                style={{ marginBottom: 16, marginTop: 4 }}
              />

              <Button
                type="primary"
                size="large"
                block
                loading={checkout.isPending}
                onClick={onSubscribe}
              >
                Continue to payment
              </Button>
              <Typography.Paragraph
                type="secondary"
                style={{ textAlign: 'center', marginTop: 12, marginBottom: 0, fontSize: 12 }}
              >
                Pay with card, Apple&nbsp;Pay, Google&nbsp;Pay, Link, PayPal or Cash&nbsp;App.
                Secure checkout by Stripe.
              </Typography.Paragraph>
            </Card>
          </>
        )}

        <div style={{ textAlign: 'center', marginTop: 24 }}>
          <Button type="link" style={{ color: '#b9c6da' }} onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </div>
    </main>
  );
}
