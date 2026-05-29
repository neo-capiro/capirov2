/**
 * Engagement Overview, landing/orientation surface for the Engagement workspace.
 * Matches the capiro redesign v2 style system (theme.css tokens, Ant Design).
 */

import { Typography } from 'antd';
import {
  CalendarOutlined,
  MailOutlined,
  BarChartOutlined,
  ArrowRightOutlined,
} from '@ant-design/icons';

const { Title, Paragraph, Text } = Typography;

interface OverviewTabProps {
  onNavigate: (tab: 'meetings' | 'outreach' | 'reports') => void;
  stats?: { meetingsThisWeek: number; debriefsPending: number; draftsOpen: number };
}

export function OverviewTab({ onNavigate, stats }: OverviewTabProps) {
  const m = stats?.meetingsThisWeek ?? 12;
  const d = stats?.debriefsPending ?? 3;
  const o = stats?.draftsOpen ?? 0;

  return (
    <section className="engagement-overview">
      {/* ──────── HERO ──────────────────────────────────────── */}
      <div className="eo-hero">
        <div className="eo-hero-text">
          <span className="eo-eyebrow">The Engagement workspace</span>
          <Title className="eo-hero-title" level={2}>
            Turn every meeting and email into <em>momentum.</em>
          </Title>
          <Paragraph className="eo-hero-sub">
            Engagement is where your day-to-day Hill work happens. Capture meetings, send personalized outreach
            to congressional offices and your own clients, and keep a clean record of every touch, without
            updating a single spreadsheet.
          </Paragraph>
          <div className="eo-hero-cta">
            <button type="button" className="eo-btn eo-btn-primary" onClick={() => onNavigate('meetings')}>
              Browse meetings <ArrowRightOutlined style={{ fontSize: 12 }} />
            </button>
            <button type="button" className="eo-btn" onClick={() => onNavigate('outreach')}>
              Start an outreach campaign
            </button>
          </div>
          <div className="eo-hero-meta">
            <span><b className="num">{m}</b> meetings this week</span>
            <span className="sep">·</span>
            <span><b className="num">{d}</b> debriefs pending</span>
            <span className="sep">·</span>
            <span><b className="num">{o}</b> outreach drafts open</span>
          </div>
        </div>
        <div className="eo-hero-vis">
          <EOHeroIllustration />
        </div>
      </div>

      {/* ──────── TRIPTYCH ──────────────────────────────────── */}
      <div className="eo-triptych">
        <FeatureCard
          icon={<CalendarOutlined style={{ fontSize: 22 }} />}
          iconTone="meetings"
          title="Meetings"
          desc="Every meeting from your calendar lands here automatically. Clio writes a prep packet before, then a clean debrief after, from your notes, a voice memo, or an uploaded transcript."
          cta="See your meetings"
          onClick={() => onNavigate('meetings')}
        />
        <FeatureCard
          icon={<MailOutlined style={{ fontSize: 22 }} />}
          iconTone="outreach"
          title="Outreach"
          desc="Send personalized emails to dozens of congressional offices or your clients in minutes. You pick the recipients and what context Clio should use, it drafts a unique email for each person."
          cta="Start a campaign"
          onClick={() => onNavigate('outreach')}
        />
        <FeatureCard
          icon={<BarChartOutlined style={{ fontSize: 22 }} />}
          iconTone="reports"
          title="Reports"
          desc="Track every Hill office, what you've done with them, and what's outstanding. Status pills update themselves from your meetings and outreach, you only touch them to override."
          cta="Open the tracker"
          onClick={() => onNavigate('reports')}
        />
      </div>

      {/* ──────── HOW IT WORKS ──────────────────────────────── */}
      <div className="eo-flow">
        <div className="eo-section-head">
          <Title className="eo-section-title" level={4}>How a typical week works</Title>
          <span className="eo-section-sub">Four moves. No spreadsheets.</span>
        </div>
        <div className="eo-flow-steps">
          <FlowStep num={1} title="Calendar syncs in" desc="Your Outlook or Google meetings appear in Meetings, with attendees already linked to the right client." />
          <FlowArrow />
          <FlowStep num={2} title="Clio preps & debriefs" desc="Before each meeting, Clio drafts a prep pack from client context. After, it turns your notes into a clean recap." />
          <FlowArrow />
          <FlowStep num={3} title="Outreach goes out" desc="Build a context plan, pick recipients, and Clio drafts a personalized email per person. You review before anything sends." />
          <FlowArrow />
          <FlowStep num={4} title="Reports stay current" desc="Every meeting, outreach, and follow-up rolls into the Office Engagement Tracker, automatically." />
        </div>
      </div>

      {/* ──────── CLIO CARD ────────────────────────────────── */}
      <div className="eo-clio">
        <div className="eo-clio-glyph">
          <div className="eo-clio-avatar" />
          <div className="eo-clio-pulse" />
        </div>
        <div>
          <span className="eo-eyebrow" style={{ color: 'rgba(255,255,255,0.7)' }}>The AI inside</span>
          <Title className="eo-clio-title" level={3}>Meet Clio</Title>
          <Text className="eo-clio-desc">
            Clio is the assistant woven through every screen in Engagement. It prepares meeting notes,
            drafts outreach emails, summarizes debriefs, and routes the right intelligence to the right
            recipient. <strong>Every draft is yours to review and edit, Clio never sends without your approval.</strong>
          </Text>
          <div className="eo-clio-quotes">
            <span className="eo-clio-quote">"I'll draft your prep."</span>
            <span className="eo-clio-quote">"I'll personalize each email."</span>
            <span className="eo-clio-quote">"I'll keep your records clean."</span>
          </div>
        </div>
      </div>

      {/* ──────── TESTIMONIAL ──────────────────────────────── */}
      <div className="eo-quote">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M9 7H5a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h2v3a2 2 0 0 1-2 2H4v2h1a4 4 0 0 0 4-4V7Zm12 0h-4a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h2v3a2 2 0 0 1-2 2h-1v2h1a4 4 0 0 0 4-4V7Z" />
        </svg>
        <blockquote>
          We replaced four tools and a shared spreadsheet with this one tab. Onboarding our new associate
          took an afternoon instead of two weeks.
        </blockquote>
        <cite>- Government affairs lead, mid-size firm</cite>
      </div>

      {/* ──────── PICK WHERE TO START ──────────────────────── */}
      <div className="eo-pick">
        <div className="eo-section-head">
          <Title className="eo-section-title" level={4}>Pick where to start</Title>
          <span className="eo-section-sub">You can always come back to this view from the Overview tab.</span>
        </div>
        <div className="eo-pick-grid">
          <PickCard
            label="Most common opener"
            heading="I have a meeting today"
            desc="Open the meeting in your calendar and let Clio prep you."
            onClick={() => onNavigate('meetings')}
          />
          <PickCard
            label="Power move"
            heading="I need to send 20 emails"
            desc="Build context once, send personalized outreach in minutes."
            onClick={() => onNavigate('outreach')}
          />
          <PickCard
            label="Status check"
            heading="I need a status snapshot"
            desc="See every target office and where each one stands this cycle."
            onClick={() => onNavigate('reports')}
          />
        </div>
      </div>
    </section>
  );
}

/* ────────────────────────────────────────────────────────────────
   Sub-components
   ──────────────────────────────────────────────────────────────── */

const TONE_BG: Record<string, string> = {
  meetings: 'var(--info-soft)',
  outreach: 'var(--accent-soft)',
  reports:  'var(--success-soft)',
};

const TONE_COLOR: Record<string, string> = {
  meetings: 'var(--info)',
  outreach: 'var(--accent-ink)',
  reports:  'var(--success)',
};

function FeatureCard({ icon, iconTone, title, desc, cta, onClick }: {
  icon: React.ReactNode;
  iconTone: string;
  title: string;
  desc: string;
  cta: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className="eo-feature" onClick={onClick}>
      <div className="eo-feature-ico" data-tone={iconTone}>{icon}</div>
      <Title className="eo-feature-title" level={5}>{title}</Title>
      <Text className="eo-feature-desc">{desc}</Text>
      <span className="eo-feature-cta">{cta} <ArrowRightOutlined style={{ fontSize: 11 }} /></span>
    </button>
  );
}

function FlowStep({ num, title, desc }: { num: number; title: string; desc: string }) {
  return (
    <div className="eo-flow-step">
      <div className="eo-flow-num">{num}</div>
      <div>
        <Text strong>{title}</Text>
        <Text type="secondary" className="eo-flow-desc">{desc}</Text>
      </div>
    </div>
  );
}

function FlowArrow() {
  return (
    <div className="eo-flow-arrow" aria-hidden="true">
      <ArrowRightOutlined style={{ fontSize: 20, color: 'var(--ink-3)' }} />
    </div>
  );
}

function PickCard({ label, heading, desc, onClick }: {
  label: string;
  heading: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className="eo-pick-card" onClick={onClick}>
      <div>
        <div className="eo-pick-l">{label}</div>
        <div className="eo-pick-h">{heading}</div>
        <Text type="secondary">{desc}</Text>
      </div>
      <span className="eo-pick-arr" aria-hidden="true">→</span>
    </button>
  );
}

/* ────────────────────────────────────────────────────────────────
   Hero SVG illustration, three floating cards orbiting a Clio core
   ──────────────────────────────────────────────────────────────── */

function EOHeroIllustration() {
  return (
    <svg viewBox="0 0 420 360" width="100%" style={{ maxWidth: 420, display: 'block' }} aria-hidden="true">
      <defs>
        <radialGradient id="eo-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#2A57CE" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#2A57CE" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="eo-clio-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#4E78D8" />
          <stop offset="100%" stopColor="#1A3F9F" />
        </linearGradient>
      </defs>
      {/* Glow */}
      <circle cx="210" cy="180" r="170" fill="url(#eo-glow)" />
      {/* Connection lines */}
      <g stroke="#2A57CE" strokeWidth="1.2" strokeDasharray="3 4" fill="none" opacity="0.55">
        <path d="M 210 180 L 90 90" />
        <path d="M 210 180 L 350 110" />
        <path d="M 210 180 L 220 320" />
      </g>
      {/* Meetings card (top left) */}
      <g transform="translate(40, 50)">
        <rect width="120" height="80" rx="10" fill="var(--bg-surface, #fff)" stroke="var(--border-1, #e6e1d6)" strokeWidth="1.5" />
        <rect x="10" y="10" width="100" height="6" rx="2" fill="var(--info-soft, #dce4f8)" />
        <rect x="10" y="22" width="60" height="5" rx="2" fill="var(--border-1, #e6e1d6)" />
        <rect x="10" y="34" width="80" height="5" rx="2" fill="var(--border-1, #e6e1d6)" />
        <rect x="10" y="46" width="40" height="5" rx="2" fill="var(--border-1, #e6e1d6)" />
        <rect x="10" y="60" width="48" height="12" rx="3" fill="var(--success-soft, #ddebde)" />
        <text x="14" y="69" fontFamily="Hanken Grotesk, sans-serif" fontSize="7" fontWeight="700" fill="var(--success, #2e6b43)" letterSpacing="0.4">DEBRIEFED</text>
        <rect x="-10" y="-10" width="32" height="14" rx="3" fill="var(--accent, #2a57ce)" />
        <text x="-3" y="0" fontFamily="Hanken Grotesk, sans-serif" fontSize="7" fontWeight="700" fill="#fff" letterSpacing="0.5">MEETING</text>
      </g>
      {/* Outreach card (top right) */}
      <g transform="translate(290, 60)">
        <rect width="100" height="100" rx="10" fill="var(--bg-surface, #fff)" stroke="var(--border-1, #e6e1d6)" strokeWidth="1.5" />
        <path d="M 10 14 L 50 36 L 90 14 L 90 60 L 10 60 Z" fill="var(--info-soft, #dce4f8)" stroke="var(--accent, #2a57ce)" strokeWidth="1.2" />
        <path d="M 10 14 L 50 36 L 90 14" fill="none" stroke="var(--accent, #2a57ce)" strokeWidth="1.2" />
        <rect x="10" y="70" width="80" height="4" rx="2" fill="var(--border-1, #e6e1d6)" />
        <rect x="10" y="80" width="50" height="4" rx="2" fill="var(--border-1, #e6e1d6)" />
        <rect x="-8" y="-10" width="38" height="14" rx="3" fill="var(--notable, #a26913)" />
        <text x="-1" y="0" fontFamily="Hanken Grotesk, sans-serif" fontSize="7" fontWeight="700" fill="#fff" letterSpacing="0.5">OUTREACH</text>
      </g>
      {/* Reports card (bottom) */}
      <g transform="translate(155, 270)">
        <rect width="130" height="70" rx="10" fill="var(--bg-surface, #fff)" stroke="var(--border-1, #e6e1d6)" strokeWidth="1.5" />
        <line x1="10" y1="55" x2="120" y2="55" stroke="var(--border-1, #e6e1d6)" strokeWidth="1" />
        <rect x="14" y="36" width="10" height="19" rx="2" fill="var(--success, #2e6b43)" />
        <rect x="30" y="28" width="10" height="27" rx="2" fill="var(--success, #2e6b43)" />
        <rect x="46" y="20" width="10" height="35" rx="2" fill="var(--accent, #2a57ce)" />
        <rect x="62" y="32" width="10" height="23" rx="2" fill="var(--accent, #2a57ce)" />
        <rect x="78" y="16" width="10" height="39" rx="2" fill="var(--notable, #a26913)" />
        <rect x="94" y="24" width="10" height="31" rx="2" fill="var(--accent, #2a57ce)" />
        <rect x="-8" y="-10" width="34" height="14" rx="3" fill="var(--success, #2e6b43)" />
        <text x="-1" y="0" fontFamily="Hanken Grotesk, sans-serif" fontSize="7" fontWeight="700" fill="#fff" letterSpacing="0.5">REPORTS</text>
      </g>
      {/* Clio core */}
      <circle cx="210" cy="180" r="46" fill="url(#eo-clio-grad)" />
      <circle cx="210" cy="180" r="54" fill="none" stroke="var(--accent, #2a57ce)" strokeWidth="1" strokeDasharray="2 4" opacity="0.5" />
      <g transform="translate(210, 180)" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" fill="none">
        <path d="M0 -16 L0 -8" /><path d="M0 8 L0 16" />
        <path d="M-16 0 L-8 0" /><path d="M8 0 L16 0" />
        <path d="M-11 -11 L-6 -6" /><path d="M6 6 L11 11" />
        <path d="M-11 11 L-6 6" /><path d="M6 -6 L11 -11" />
      </g>
      <text x="210" y="248" textAnchor="middle" fontFamily="Hanken Grotesk, sans-serif" fontSize="11" fontWeight="700" fill="var(--accent-ink, #1a3f9f)" letterSpacing="2.5">CLIO</text>
    </svg>
  );
}
