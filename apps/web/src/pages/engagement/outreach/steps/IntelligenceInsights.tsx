import { Badge, Button, Card, Col, Collapse, Input, Row, Spin, Switch, Tag, Typography } from 'antd';
import { BulbOutlined, DollarOutlined, FileTextOutlined, RiseOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useApi } from '../../../../lib/use-api.js';

interface InsightCard {
  id: string;
  category: 'lobbying' | 'spending' | 'legislative' | 'lda';
  title: string;
  detail: string;
  text: string;
}

interface InsightsData {
  surgingIssues: Array<{ code: string; name: string; surgePct: number | null }>;
  trendingTopics: Array<{ word: string; growthPct: number | null }>;
  clientSpending: unknown;
  topAgencies: Array<{ agencyName: string; totalAmount: number }>;
  recentBills: Array<{
    id: string;
    billNumber: string;
    title: string;
    policyArea: string | null;
    status: string | null;
    latestAction: string | null;
  }>;
  clientLdaHistory: Array<{ year: number; filingCount: number; issueAreas: string[] }>;
  latestQuarter: string | null;
}

interface IntelligenceInsightsProps {
  clientId: string | null;
  selectedInsights: string[];
  insightsNotes: string;
  onChange: (patch: { selectedInsights?: string[]; insightsNotes?: string }) => void;
}

const CATEGORY_META = {
  lobbying: { label: 'Lobbying Trends', icon: <RiseOutlined />, color: '#1c2e4a' },
  spending: { label: 'Federal Spending', icon: <DollarOutlined />, color: '#52c41a' },
  legislative: { label: 'Legislative Activity', icon: <FileTextOutlined />, color: '#722ed1' },
  lda: { label: 'Client LDA History', icon: <BulbOutlined />, color: '#fa8c16' },
};

function buildInsightCards(data: InsightsData): InsightCard[] {
  const cards: InsightCard[] = [];

  for (const issue of data.surgingIssues.slice(0, 6)) {
    const pct = issue.surgePct != null ? ` (+${issue.surgePct.toFixed(0)}%)` : '';
    const text = `Surging lobbying issue: ${issue.name}${pct}`;
    cards.push({ id: `surging-${issue.code}`, category: 'lobbying', title: issue.name, detail: `Surge${pct}`, text });
  }

  for (const topic of data.trendingTopics.slice(0, 6)) {
    const pct = topic.growthPct != null ? ` (+${topic.growthPct.toFixed(0)}%)` : '';
    const text = `Trending lobbying topic: ${topic.word}${pct}`;
    cards.push({ id: `trend-${topic.word}`, category: 'lobbying', title: topic.word, detail: `Trending${pct}`, text });
  }

  for (const bill of data.recentBills.slice(0, 6)) {
    const text = `Recent legislation: ${bill.billNumber} — ${bill.title}${bill.status ? ` (${bill.status})` : ''}`;
    cards.push({
      id: `bill-${bill.id}`,
      category: 'legislative',
      title: bill.billNumber,
      detail: bill.title.slice(0, 80),
      text,
    });
  }

  for (const agency of data.topAgencies.slice(0, 4)) {
    const amount = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact' }).format(
      agency.totalAmount,
    );
    const text = `Federal spending — ${agency.agencyName}: ${amount}`;
    cards.push({
      id: `agency-${agency.agencyName}`,
      category: 'spending',
      title: agency.agencyName,
      detail: amount,
      text,
    });
  }

  for (const year of data.clientLdaHistory.slice(0, 3)) {
    const areas = year.issueAreas.slice(0, 3).join(', ');
    const text = `Client LDA ${year.year}: ${year.filingCount} filings — ${areas}`;
    cards.push({
      id: `lda-${year.year}`,
      category: 'lda',
      title: `LDA ${year.year}`,
      detail: `${year.filingCount} filings${areas ? ` · ${areas}` : ''}`,
      text,
    });
  }

  return cards;
}

export function IntelligenceInsights({
  clientId,
  selectedInsights,
  insightsNotes,
  onChange,
}: IntelligenceInsightsProps) {
  const api = useApi();
  const [enrichContext, setEnrichContext] = useState<string | null>(null);
  const [enrichOpen, setEnrichOpen] = useState(false);

  const insights = useQuery<InsightsData>({
    queryKey: ['outreach-wizard-insights', clientId],
    queryFn: async () =>
      (
        await api.get<InsightsData>('/api/engagement/outreach/insights', {
          params: clientId ? { clientId } : {},
        })
      ).data,
  });

  const enrichMutation = useMutation({
    mutationFn: async () => {
      const res = await api.get<{ context: string }>(
        `/api/intelligence/clients/${clientId!}/outreach-context`,
      );
      return res.data.context;
    },
    onSuccess: (ctx) => {
      setEnrichContext(ctx);
      setEnrichOpen(true);
    },
  });

  const talkingPoints = useMutation({
    mutationFn: async () =>
      (
        await api.post<{ talkingPoints: string[] }>('/api/engagement/outreach/insights/talking-points', {
          insights: selectedInsights,
          clientId: clientId ?? undefined,
          additionalContext: insightsNotes || undefined,
        })
      ).data,
    onSuccess: (result) => {
      const points = result.talkingPoints.map((p) => `• ${p}`).join('\n');
      onChange({ insightsNotes: insightsNotes ? `${insightsNotes}\n\n${points}` : points });
    },
  });

  const toggleInsight = (text: string) => {
    if (selectedInsights.includes(text)) {
      onChange({ selectedInsights: selectedInsights.filter((s) => s !== text) });
    } else {
      onChange({ selectedInsights: [...selectedInsights, text] });
    }
  };

  if (insights.isLoading) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <Spin size="large" />
        <Typography.Paragraph type="secondary" style={{ marginTop: 16 }}>
          Loading intelligence insights...
        </Typography.Paragraph>
      </div>
    );
  }

  const cards = insights.data ? buildInsightCards(insights.data) : [];

  const categories = Object.entries(CATEGORY_META) as Array<
    [InsightCard['category'], (typeof CATEGORY_META)[InsightCard['category']]]
  >;

  return (
    <div className="outreach-flow-stack">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>
            Intelligence insights
          </Typography.Title>
          <Typography.Text type="secondary">
            Toggle insights to include them in email generation. Clio will weave them into each
            recipient&apos;s email.
          </Typography.Text>
        </div>
        {selectedInsights.length > 0 && (
          <Badge count={selectedInsights.length} style={{ backgroundColor: '#1c2e4a' }} />
        )}
      </div>

      {cards.length === 0 ? (
        <Typography.Text type="secondary">
          No intelligence data available. Clio will use client context from your intake data.
        </Typography.Text>
      ) : (
        categories.map(([category, meta]) => {
          const categoryCards = cards.filter((c) => c.category === category);
          if (!categoryCards.length) return null;
          return (
            <div key={category} style={{ marginBottom: 20 }}>
              <Typography.Text
                strong
                style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, color: meta.color }}
              >
                {meta.icon} {meta.label}
              </Typography.Text>
              <Row gutter={[8, 8]}>
                {categoryCards.map((card) => {
                  const active = selectedInsights.includes(card.text);
                  return (
                    <Col key={card.id} xs={24} sm={12} lg={8}>
                      <Card
                        size="small"
                        style={{
                          cursor: 'pointer',
                          borderColor: active ? meta.color : undefined,
                          background: active ? `${meta.color}08` : undefined,
                        }}
                        onClick={() => toggleInsight(card.text)}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <div style={{ flex: 1, marginRight: 8 }}>
                            <div style={{ fontWeight: 500, fontSize: 13 }}>{card.title}</div>
                            <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>{card.detail}</div>
                          </div>
                          <Switch
                            size="small"
                            checked={active}
                            onChange={(checked) => {
                              if (checked !== active) toggleInsight(card.text);
                            }}
                            onClick={(_, e) => e.stopPropagation()}
                          />
                        </div>
                      </Card>
                    </Col>
                  );
                })}
              </Row>
            </div>
          );
        })
      )}

      {/* Enrich with Intelligence Context */}
      {clientId && (
        <div style={{ marginTop: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <Typography.Text strong style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <ThunderboltOutlined style={{ color: '#f59e0b' }} />
              Live Intelligence Context
            </Typography.Text>
            <Button
              size="small"
              icon={<ThunderboltOutlined />}
              loading={enrichMutation.isPending}
              onClick={() => void enrichMutation.mutateAsync()}
            >
              {enrichContext ? 'Refresh' : 'Enrich with Intelligence'}
            </Button>
          </div>
          {enrichContext && (
            <Collapse
              activeKey={enrichOpen ? ['ctx'] : []}
              onChange={(keys) => setEnrichOpen(Array.isArray(keys) ? keys.includes('ctx') : keys === 'ctx')}
              items={[
                {
                  key: 'ctx',
                  label: 'Current intelligence context (click to expand)',
                  extra: (
                    <Button
                      size="small"
                      type="link"
                      onClick={(e) => {
                        e.stopPropagation();
                        onChange({ insightsNotes: insightsNotes ? `${insightsNotes}\n\n${enrichContext}` : enrichContext });
                      }}
                    >
                      Inject into notes →
                    </Button>
                  ),
                  children: (
                    <pre style={{ fontSize: 11, whiteSpace: 'pre-wrap', margin: 0, color: '#374151' }}>
                      {enrichContext}
                    </pre>
                  ),
                },
              ]}
            />
          )}
        </div>
      )}

      <div style={{ marginTop: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <Typography.Text strong>Custom intelligence notes</Typography.Text>
          <Button
            size="small"
            loading={talkingPoints.isPending}
            disabled={selectedInsights.length === 0}
            onClick={() => void talkingPoints.mutateAsync()}
          >
            Suggest talking points
          </Button>
        </div>
        <Input.TextArea
          rows={4}
          value={insightsNotes}
          placeholder="Add your own context, talking points, or specific intelligence Clio should reference..."
          onChange={(e) => onChange({ insightsNotes: e.target.value })}
        />
        {selectedInsights.length === 0 && (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Select at least one insight above to enable talking point suggestions.
          </Typography.Text>
        )}
      </div>

      {insights.data?.latestQuarter && (
        <Typography.Text type="secondary" style={{ fontSize: 11 }}>
          LDA data through {insights.data.latestQuarter}
        </Typography.Text>
      )}
    </div>
  );
}
