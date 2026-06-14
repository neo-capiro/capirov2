import { useNavigate } from 'react-router-dom';
import { Alert, Button, Card, Col, Progress, Row, Space, Statistic, Tag, Typography } from 'antd';
import type { BillingStatus } from '@capiro/shared';
import { useBilling, usePortal } from '../../lib/billing.js';

const STATUS_TAG: Record<BillingStatus, { color: string; label: string }> = {
  none: { color: 'default', label: 'Not subscribed' },
  trialing: { color: 'blue', label: 'Trialing' },
  active: { color: 'green', label: 'Active' },
  past_due: { color: 'red', label: 'Past due' },
  canceled: { color: 'volcano', label: 'Canceled' },
  comped: { color: 'gold', label: 'Complimentary' },
};

const money = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

export function BillingPage() {
  const navigate = useNavigate();
  const billing = useBilling();
  const portal = usePortal();

  if (billing.isError) {
    return (
      <Card title="Billing">
        <Alert
          type="warning"
          showIcon
          message="Billing isn't available for your account"
          description="Only tenant admins can view billing. If you are an admin and still see this, billing may not be configured on this environment yet."
        />
      </Card>
    );
  }

  const s = billing.data;

  // Billing dormant on this environment (Stripe not configured) — no paywall,
  // no plan to manage yet.
  if (s && !s.billingEnabled) {
    return (
      <Card title="Billing">
        <Alert
          type="info"
          showIcon
          message="Billing isn't enabled yet"
          description="Subscriptions and usage billing will appear here once billing is turned on for your account."
        />
      </Card>
    );
  }

  const status = s?.status ?? 'none';
  const tag = STATUS_TAG[status];
  const monthly = s ? s.slots * s.pricePerSlotUsd : 0;
  const usagePct =
    s && s.llmAllowanceUsd > 0 ? Math.min(100, (s.llmUsedUsd / s.llmAllowanceUsd) * 100) : 0;
  const slotsPct = s && s.slots > 0 ? Math.min(100, (s.usedSlots / s.slots) * 100) : 0;
  const notSubscribed = status === 'none' || status === 'canceled';

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card
        title="Billing & plan"
        loading={billing.isLoading}
        extra={<Tag color={tag.color}>{tag.label}</Tag>}
      >
        {status === 'past_due' && (
          <Alert
            type="error"
            showIcon
            style={{ marginBottom: 16 }}
            message="Your last payment failed"
            description="Update your payment method to avoid losing access."
          />
        )}
        {notSubscribed ? (
          <Space direction="vertical" style={{ width: '100%' }}>
            <Typography.Paragraph>
              {status === 'canceled'
                ? 'Your subscription is canceled. Resubscribe to continue adding clients.'
                : "You haven't subscribed yet."}
            </Typography.Paragraph>
            <Button type="primary" onClick={() => navigate('/onboarding/subscribe')}>
              Choose a plan
            </Button>
          </Space>
        ) : (
          <>
            <Row gutter={[16, 16]}>
              <Col xs={12} md={6}>
                <Statistic title="Client slots" value={`${s?.usedSlots ?? 0} / ${s?.slots ?? 0}`} />
                <Progress percent={Math.round(slotsPct)} showInfo={false} size="small" />
              </Col>
              <Col xs={12} md={6}>
                <Statistic title="Price / slot" value={money(s?.pricePerSlotUsd ?? 0)} />
              </Col>
              <Col xs={12} md={6}>
                <Statistic title="Monthly (slots)" value={money(monthly)} />
              </Col>
              <Col xs={12} md={6}>
                <Statistic
                  title="Renews"
                  value={
                    s?.currentPeriodEnd ? new Date(s.currentPeriodEnd).toLocaleDateString() : '—'
                  }
                />
              </Col>
            </Row>
            <Space style={{ marginTop: 20 }}>
              <Button type="primary" loading={portal.isPending} onClick={() => portal.mutate()}>
                Manage billing & payment
              </Button>
              <Button loading={portal.isPending} onClick={() => portal.mutate()}>
                Add client slots
              </Button>
            </Space>
          </>
        )}
      </Card>

      {!notSubscribed && (
        <Card title="AI usage this period" loading={billing.isLoading}>
          {s?.llmWarn && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
              message="Approaching your AI usage allowance"
              description="Usage beyond your included allowance is billed at 2× cost."
            />
          )}
          <Row gutter={[16, 16]}>
            <Col xs={24} md={12}>
              <Typography.Text type="secondary">
                {money(s?.llmUsedUsd ?? 0)} used of {money(s?.llmAllowanceUsd ?? 0)} included
              </Typography.Text>
              <Progress
                percent={Math.round(usagePct)}
                status={usagePct >= 100 ? 'exception' : 'active'}
              />
            </Col>
            <Col xs={12} md={6}>
              <Statistic title="Billable overage" value={money(s?.llmOverageUsd ?? 0)} />
            </Col>
          </Row>
          <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
            Allowance is $20 per client slot per month, pooled across your team. Detailed usage is
            on the <a onClick={() => navigate('/settings/ai-usage')}>AI Usage</a> tab.
          </Typography.Paragraph>
        </Card>
      )}
    </Space>
  );
}
