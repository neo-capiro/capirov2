// Intelligence Center — "Coming Soon" preview.
//
// The production Intelligence Center is still being built. Until it ships we
// surface a banner + an embedded mockup pack (a static HTML preview under
// /public/mockups) so the team can see what's coming: actionable insights and
// market intelligence rather than a raw data feed.
//
// The underlying data Explorer (/explorer) is intentionally left intact — it
// still backs bill detail views and other deep links — we just point the
// "Intelligence Center" menu item here instead.
import { Typography } from 'antd';

const PREVIEW_SRC = '/mockups/intelligence-center-preview.html';

export function ComingSoonIntelligence() {
  return (
    <div style={{ padding: 24, maxWidth: 1480, margin: '0 auto' }}>
      <div
        style={{
          background: 'linear-gradient(135deg, #eef1ff 0%, #f6f8fb 100%)',
          border: '1px solid #d7dcff',
          borderRadius: 18,
          padding: '24px 28px',
          marginBottom: 18,
          boxShadow: '0 8px 24px rgba(16, 32, 51, 0.06)',
        }}
      >
        <div
          style={{
            textTransform: 'uppercase',
            letterSpacing: '0.14em',
            fontWeight: 800,
            fontSize: 12,
            color: '#2447ff',
            marginBottom: 8,
          }}
        >
          Coming Soon
        </div>
        <Typography.Title level={2} style={{ margin: '0 0 8px', letterSpacing: '-0.02em' }}>
          Intelligence Center
        </Typography.Title>
        <Typography.Paragraph style={{ margin: 0, color: '#65758b', fontSize: 15, maxWidth: 900 }}>
          What you&rsquo;re seeing below are mock-ups of what&rsquo;s coming &mdash; designed as{' '}
          <strong style={{ color: '#344054' }}>actionable insights and market intelligence</strong>:
          what changed, why it matters, who to contact, what to say, by when, and what proves it.
          These are previews of the experience, not live data yet.
        </Typography.Paragraph>
      </div>
      <iframe
        title="Intelligence Center preview"
        src={PREVIEW_SRC}
        style={{
          width: '100%',
          height: '82vh',
          minHeight: 700,
          border: '1px solid #d8e0ea',
          borderRadius: 18,
          background: '#fff',
        }}
      />
    </div>
  );
}
