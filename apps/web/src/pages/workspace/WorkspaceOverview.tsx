import { useNavigate } from 'react-router-dom';
import { ArrowRightOutlined } from '@ant-design/icons';

const CURRENT_FY = 27;

interface AuthTrack {
  code: string;
  name: string;
  cycle: string;
  reauthFY: number | null;
  note: string;
}

const AUTH_TIMELINES: AuthTrack[] = [
  { code: 'NDAA',   name: 'National Defense Authorization Act',  cycle: 'Annual',   reauthFY: null, note: 'Sets DoD policy + authorization levels, the workhorse for defense policy.' },
  { code: 'FAA',    name: 'FAA Reauthorization',                  cycle: '5-year',   reauthFY: 28,   note: 'Aviation safety, NextGen, drones.' },
  { code: 'Farm',   name: 'Farm Bill',                             cycle: '5-year',   reauthFY: 29,   note: 'Ag commodities, conservation, nutrition.' },
  { code: 'WRDA',   name: 'Water Resources Development Act',      cycle: '2-year',   reauthFY: 28,   note: 'Corps of Engineers civil works.' },
  { code: 'Higher', name: 'Higher Education Act',                  cycle: 'Periodic', reauthFY: 30,   note: 'Title IV, student aid, accreditation.' },
  { code: 'IIJA',   name: 'Surface Transportation Reauth',         cycle: '5-year',   reauthFY: 31,   note: 'Roads, transit, rail policy.' },
];

type DomainColor = 'info' | 'notable' | 'success' | 'accent' | 'critical';

interface AppropsItem {
  code: string;
  name: string;
  color: DomainColor;
}

const APPROPS_HOUSE: AppropsItem[] = [
  { code: 'HAC-D',    name: 'Defense',                      color: 'info' },
  { code: 'HAC-MC',   name: 'Mil Construction & VA',         color: 'info' },
  { code: 'HAC-HS',   name: 'Homeland Security',             color: 'info' },
  { code: 'HAC-AG',   name: 'Agriculture, Rural Dev, FDA',   color: 'success' },
  { code: 'HAC-CJS',  name: 'Commerce, Justice, Science',    color: 'success' },
  { code: 'HAC-EW',   name: 'Energy & Water',                color: 'notable' },
  { code: 'HAC-FS',   name: 'Financial Services',            color: 'notable' },
  { code: 'HAC-IE',   name: 'Interior, Environment',         color: 'notable' },
  { code: 'HAC-LHHS', name: 'Labor, HHS, Education',         color: 'accent' },
  { code: 'HAC-Leg',  name: 'Legislative Branch',            color: 'accent' },
  { code: 'HAC-SFO',  name: 'State, Foreign Ops',            color: 'critical' },
  { code: 'HAC-THUD', name: 'Transportation, HUD',           color: 'critical' },
];

const APPROPS_SENATE: AppropsItem[] = [
  { code: 'SAC-D',    name: 'Defense',                      color: 'info' },
  { code: 'SAC-MC',   name: 'Mil Construction & VA',         color: 'info' },
  { code: 'SAC-HS',   name: 'Homeland Security',             color: 'info' },
  { code: 'SAC-AG',   name: 'Agriculture, Rural Dev, FDA',   color: 'success' },
  { code: 'SAC-CJS',  name: 'Commerce, Justice, Science',    color: 'success' },
  { code: 'SAC-EW',   name: 'Energy & Water',                color: 'notable' },
  { code: 'SAC-FS',   name: 'Financial Services',            color: 'notable' },
  { code: 'SAC-IE',   name: 'Interior, Environment',         color: 'notable' },
  { code: 'SAC-LHHS', name: 'Labor, HHS, Education',         color: 'accent' },
  { code: 'SAC-Leg',  name: 'Legislative Branch',            color: 'accent' },
  { code: 'SAC-SFO',  name: 'State, Foreign Ops',            color: 'critical' },
  { code: 'SAC-THUD', name: 'Transportation, HUD',           color: 'critical' },
];

const COLOR_MAP: Record<DomainColor, string> = {
  info:     '#2C5BD4',
  notable:  '#A26913',
  success:  '#2E6B43',
  accent:   '#2A57CE',
  critical: '#B5301B',
};

const SUPPORTING_PYRAMID = [
  { tier: 0, code: 'SUB',  name: 'Formal submission',         sub: 'NDAA / HAC-X / CPF', descr: 'The ask. Authorization or appropriations request filed via member office.' },
  { tier: 1, code: 'WP',   name: 'Program white paper',        sub: '2–4 pages',          descr: 'Narrative: problem, program, value, ask, metrics. The piece lobbyists spend the most time on.' },
  { tier: 2, code: 'TP',   name: 'Leave-behind / talking points', sub: '3–5 bullets',     descr: "Extracted from the WP. Travels in every meeting; left behind on the staffer's desk." },
  { tier: 3, code: 'Q&A',  name: 'Member office Q&A',          sub: 'Internal brief',     descr: "Anticipated questions + answers. Written for staffers to brief their member." },
];

const FLOW = [
  { n: 1, h: 'Strategy',     p: 'Pick the client, the capability, and the fiscal year. Capiro creates the container.' },
  { n: 2, h: 'Submissions',  p: 'Choose the tracks: NDAA? HAC-D? White paper? Capiro suggests by capability.' },
  { n: 3, h: 'Targets',      p: 'Pick the member offices, committees, and staffers each submission goes to.' },
  { n: 4, h: 'Draft',        p: "Meri drafts the long-form pieces (white papers, one-pagers) from your context. You edit." },
  { n: 5, h: 'Send & track', p: 'Submissions go out via Outreach; the strategy page tracks status until everything is filed.' },
];

/* ── Ecosystem mindmap data ─────────────────────────────────────────────── */

type EcoColor = 'gray' | 'blue' | 'teal' | 'amber' | 'pink' | 'purple';

interface EcoNode {
  id: string;
  x: number;
  y: number;
  r: number;
  color: EcoColor;
  label: string;
  sub?: string;
  center?: boolean;
}

const ECO_PALETTE: Record<EcoColor, { fill: string; stroke: string; text: string }> = {
  gray:   { fill: '#FFFFFF', stroke: '#2C2C2A', text: '#15161A' },
  blue:   { fill: '#E6F1FB', stroke: '#185FA5', text: '#042C53' },
  teal:   { fill: '#E1F5EE', stroke: '#0F6E56', text: '#04342C' },
  amber:  { fill: '#FAEEDA', stroke: '#854F0B', text: '#412402' },
  pink:   { fill: '#FBEAF0', stroke: '#993356', text: '#4B1528' },
  purple: { fill: '#EEEDFE', stroke: '#534AB7', text: '#26215C' },
};

const ECO_NODES: EcoNode[] = [
  { id: 'capiro',    x: 100,  y: 410, r: 56, color: 'gray',   label: 'Capiro',     sub: 'Portfolio', center: true },
  { id: 'firms',     x: 280,  y: 260, r: 36, color: 'blue',   label: 'Lobbying',   sub: 'firms & advisors' },
  { id: 'inhouse',   x: 280,  y: 560, r: 36, color: 'blue',   label: 'In-house',   sub: 'GA teams' },
  { id: 'defense',   x: 510,  y: 70,  r: 28, color: 'teal',   label: 'Defense' },
  { id: 'health',    x: 510,  y: 170, r: 28, color: 'teal',   label: 'Health' },
  { id: 'energy',    x: 510,  y: 270, r: 28, color: 'teal',   label: 'Energy' },
  { id: 'transport', x: 510,  y: 370, r: 28, color: 'teal',   label: 'Transport' },
  { id: 'ag',        x: 510,  y: 470, r: 28, color: 'teal',   label: 'Agriculture' },
  { id: 'hs',        x: 510,  y: 570, r: 28, color: 'teal',   label: 'Homeland' },
  { id: 'enviro',    x: 510,  y: 670, r: 28, color: 'teal',   label: 'Environment' },
  { id: 'commerce',  x: 510,  y: 770, r: 28, color: 'teal',   label: 'Commerce' },
  { id: 'ndaa',      x: 770,  y: 120, r: 32, color: 'amber',  label: 'NDAA',       sub: 'authorization' },
  { id: 'approps',   x: 770,  y: 260, r: 32, color: 'amber',  label: 'Approps',    sub: 'plus-up' },
  { id: 'cds',       x: 770,  y: 400, r: 32, color: 'amber',  label: 'CDS',        sub: 'earmarks' },
  { id: 'authbill',  x: 770,  y: 540, r: 32, color: 'amber',  label: 'Auth bill',  sub: 'language' },
  { id: 'whitepaper',x: 770,  y: 680, r: 32, color: 'amber',  label: 'White paper',sub: 'advocacy' },
  { id: 'hasc',      x: 1020, y: 80,  r: 24, color: 'pink',   label: 'HASC' },
  { id: 'sasc',      x: 1020, y: 145, r: 24, color: 'pink',   label: 'SASC' },
  { id: 'ec',        x: 1020, y: 215, r: 22, color: 'pink',   label: 'E&C' },
  { id: 'help',      x: 1020, y: 275, r: 22, color: 'pink',   label: 'HELP' },
  { id: 'ti',        x: 1020, y: 335, r: 22, color: 'pink',   label: 'T&I' },
  { id: 'epw',       x: 1020, y: 395, r: 22, color: 'pink',   label: 'EPW' },
  { id: 'agcm',      x: 1020, y: 455, r: 22, color: 'pink',   label: 'Ag' },
  { id: 'enr',       x: 1020, y: 515, r: 22, color: 'pink',   label: 'ENR' },
  { id: 'sci',       x: 1020, y: 575, r: 22, color: 'pink',   label: 'Science' },
  { id: 'hacd',      x: 1140, y: 110, r: 20, color: 'purple', label: 'HAC-D' },
  { id: 'sacd',      x: 1140, y: 165, r: 20, color: 'purple', label: 'SAC-D' },
  { id: 'lhhs',      x: 1140, y: 245, r: 20, color: 'purple', label: 'L-HHS' },
  { id: 'ew',        x: 1140, y: 305, r: 20, color: 'purple', label: 'E&W' },
  { id: 'thud',      x: 1140, y: 365, r: 20, color: 'purple', label: 'T-HUD' },
  { id: 'agsub',     x: 1140, y: 425, r: 20, color: 'purple', label: 'Ag' },
  { id: 'hssub',     x: 1140, y: 485, r: 20, color: 'purple', label: 'HS' },
  { id: 'int',       x: 1140, y: 545, r: 20, color: 'purple', label: 'Int' },
  { id: 'cjs',       x: 1140, y: 605, r: 20, color: 'purple', label: 'CJS' },
  { id: 'milcon',    x: 1140, y: 665, r: 20, color: 'purple', label: 'MilCon' },
];

const ECO_EDGES: Array<[string, string, number]> = [
  ['capiro', 'firms', 1.6], ['capiro', 'inhouse', 1.6],
  ...(['defense','health','energy','transport','ag','hs','enviro','commerce'] as const).flatMap(
    (id) => ([['firms', id, 0.7], ['inhouse', id, 0.7]] as Array<[string, string, number]>),
  ),
  ['defense','ndaa',1.4], ['defense','approps',1.0], ['defense','whitepaper',0.8],
  ['health','approps',1.2], ['health','authbill',1.2], ['health','whitepaper',0.8],
  ['energy','approps',1.2], ['energy','authbill',1.0], ['energy','cds',0.9],
  ['transport','approps',1.2], ['transport','authbill',1.2], ['transport','cds',1.0],
  ['ag','approps',1.2], ['ag','authbill',1.2], ['ag','cds',1.0],
  ['hs','approps',1.0], ['hs','cds',0.8],
  ['enviro','approps',1.0], ['enviro','authbill',1.0], ['enviro','cds',0.9],
  ['commerce','approps',1.2], ['commerce','authbill',1.0],
  ['ndaa','hasc',1.4], ['ndaa','sasc',1.4],
  ['authbill','ec',1.0], ['authbill','help',1.0], ['authbill','ti',1.0], ['authbill','epw',1.0],
  ['authbill','agcm',1.0], ['authbill','enr',1.0], ['authbill','sci',1.0],
  ['ndaa','hacd',1.2], ['ndaa','sacd',1.2],
  ['approps','hacd',1.0], ['approps','sacd',1.0], ['approps','lhhs',1.0], ['approps','ew',1.0],
  ['approps','thud',1.0], ['approps','agsub',1.0], ['approps','hssub',1.0], ['approps','int',1.0],
  ['approps','cjs',1.0], ['approps','milcon',1.0],
  ['cds','lhhs',0.9], ['cds','ew',0.9], ['cds','thud',1.0], ['cds','agsub',1.0],
  ['cds','hssub',0.9], ['cds','int',0.9], ['cds','cjs',0.9],
];

/* ── Main component ─────────────────────────────────────────────────────── */

export function WorkspaceOverview() {
  const navigate = useNavigate();

  return (
    <div className="workspace-overview">
      <section className="wso-hero">
        <div>
          <span className="wso-eyebrow">The Workspace</span>
          <h2 className="wso-hero-title">Where every <em>strategy</em> becomes a written ask.</h2>
          <p className="wso-hero-sub">
            The Workspace is where you turn a client's program into the documents that travel up the Hill.
            One spot for templates, active workflows, and full fiscal-year strategies, with Meri drafting
            the long-form pieces (white papers, talking points, one-pagers) you'd normally spend a week on.
          </p>
          <div className="wso-hero-cta">
            <button type="button" className="eo-btn eo-btn-primary" onClick={() => navigate('/workspace/strategies')}>
              Open Strategies <ArrowRightOutlined style={{ fontSize: 12 }} />
            </button>
            <button type="button" className="eo-btn" onClick={() => navigate('/workspace/library')}>
              Browse the Library
            </button>
          </div>
        </div>
        <div className="wso-hero-vis">
          <WorkspaceHeroVis />
        </div>
      </section>

      <section>
        <div className="wso-section-head">
          <h3>Three places to do work</h3>
          <span className="sub">Library &nbsp;·&nbsp; Workflows &nbsp;·&nbsp; Strategies</span>
        </div>
        <div className="wso-pillars">
          <button type="button" className="wso-pillar" data-tone="library" onClick={() => navigate('/workspace/library')}>
            <div className="ico">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="7" height="16" rx="1" /><rect x="14" y="4" width="7" height="9" rx="1" /><rect x="14" y="15" width="7" height="5" rx="1" />
              </svg>
            </div>
            <h4>Library</h4>
            <p>The catalog of submission types, every authorization track and all 12 appropriations subcommittees in each chamber, plus supporting docs. Pick a template, drop it into a workflow.</p>
            <span className="link">Open the catalog <ArrowRightOutlined style={{ fontSize: 11 }} /></span>
          </button>
          <button type="button" className="wso-pillar" data-tone="workflows" onClick={() => navigate('/workspace/workflows')}>
            <div className="ico">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="6" height="6" rx="1" /><rect x="15" y="3" width="6" height="6" rx="1" /><rect x="3" y="15" width="6" height="6" rx="1" /><rect x="15" y="15" width="6" height="6" rx="1" /><path d="M9 6h6M9 18h6M6 9v6M18 9v6" />
              </svg>
            </div>
            <h4>Workflows</h4>
            <p>The kanban of every active deliverable across your firm, Triage, In Progress, Done. Drag cards across columns. Each card is a discrete ask owed to one office on one bill.</p>
            <span className="link">See active work <ArrowRightOutlined style={{ fontSize: 11 }} /></span>
          </button>
          <button type="button" className="wso-pillar" data-tone="strategies" onClick={() => navigate('/workspace/strategies')}>
            <div className="ico">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="9" /><path d="M12 3a14 14 0 0 1 0 18M3 12h18" />
              </svg>
            </div>
            <h4>Strategies</h4>
            <p>An FY-scoped plan for one client capability. Bundles every submission, every target office, every supporting doc, and tracks progress against deadlines. This is where you live during a cycle.</p>
            <span className="link">Open strategies <ArrowRightOutlined style={{ fontSize: 11 }} /></span>
          </button>
        </div>
      </section>

      <TracksInfographic />
      <EcosystemMindmap />

      <section>
        <div className="wso-section-head">
          <h3>How a typical FY strategy moves</h3>
          <span className="sub">Five moves from idea to filed submission.</span>
        </div>
        <div className="wso-flow">
          {FLOW.map((step, idx) => (
            <div key={step.n} style={{ display: 'contents' }}>
              <div className="wso-flow-step">
                <div className="wso-flow-num">{step.n}</div>
                <h4>{step.h}</h4>
                <p>{step.p}</p>
              </div>
              {idx < FLOW.length - 1 && (
                <div className="wso-flow-arrow" aria-hidden="true">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <path d="M5 12h14M13 6l6 6-6 6" />
                  </svg>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

/* ── Hero illustration ──────────────────────────────────────────────────── */

function WorkspaceHeroVis() {
  return (
    <svg viewBox="0 0 420 320" width="100%" style={{ maxWidth: 440, display: 'block' }} aria-hidden="true">
      <defs>
        <radialGradient id="ws-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#2A57CE" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#2A57CE" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="ws-meri" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#4E78D8" />
          <stop offset="100%" stopColor="#1A3F9F" />
        </linearGradient>
      </defs>
      <circle cx="210" cy="160" r="160" fill="url(#ws-glow)" />
      {/* Doc 3 (back) */}
      <g transform="translate(230, 60) rotate(8)">
        <rect width="140" height="180" rx="6" fill="#FFFFFF" stroke="#E6E1D6" strokeWidth="1.5" />
        <rect x="16" y="20" width="80" height="8" rx="2" fill="#15161A" />
        {[36,44,52,82,90,98,126,134].map((y, i) => (
          <rect key={i} x="16" y={y} width={i === 0 || i === 7 ? 108 : i === 2 ? 60 : i === 6 ? 86 : 108} height="3" rx="1" fill="#E6E1D6" />
        ))}
        <rect x="16" y="72" width="48" height="4" rx="1" fill="#DCE4F8" />
        <rect x="16" y="116" width="48" height="4" rx="1" fill="#F4E5C3" />
        <rect x="-12" y="6" width="36" height="14" rx="3" fill="#2C5BD4" />
        <text x="-8" y="16" fontFamily="JetBrains Mono, monospace" fontSize="8" fontWeight="700" fill="#fff">NDAA</text>
      </g>
      {/* Doc 2 (mid) */}
      <g transform="translate(150, 80) rotate(-3)">
        <rect width="140" height="180" rx="6" fill="#FFFFFF" stroke="#E6E1D6" strokeWidth="1.5" />
        <rect x="16" y="20" width="90" height="8" rx="2" fill="#15161A" />
        {[36,44,70,78,86].map((y, i) => (
          <rect key={i} x="16" y={y} width={i === 4 ? 80 : 108} height="3" rx="1" fill="#E6E1D6" />
        ))}
        <rect x="16" y="58" width="58" height="4" rx="1" fill="#DEE6F8" />
        <rect x="-12" y="6" width="48" height="14" rx="3" fill="#A26913" />
        <text x="-8" y="16" fontFamily="JetBrains Mono, monospace" fontSize="8" fontWeight="700" fill="#fff">HAC-D</text>
      </g>
      {/* Doc 1 (front) */}
      <g transform="translate(72, 110) rotate(-12)">
        <rect width="140" height="180" rx="6" fill="#FFFFFF" stroke="#E6E1D6" strokeWidth="1.5" />
        <rect x="16" y="20" width="100" height="9" rx="2" fill="#15161A" />
        {[40,48,56,64,90,98,106].map((y, i) => (
          <rect key={i} x="16" y={y} width={i === 2 ? 92 : i === 3 ? 100 : i === 6 ? 82 : 108} height="3" rx="1" fill="#E6E1D6" />
        ))}
        <rect x="16" y="80" width="48" height="4" rx="1" fill="#DDEBDE" />
        <rect x="-12" y="6" width="56" height="14" rx="3" fill="#2E6B43" />
        <text x="-8" y="16" fontFamily="JetBrains Mono, monospace" fontSize="8" fontWeight="700" fill="#fff">WP</text>
      </g>
      {/* Meri core */}
      <g transform="translate(330, 230)">
        <circle r="32" fill="url(#ws-meri)" />
        <g stroke="#fff" strokeWidth="2" strokeLinecap="round" fill="none">
          <path d="M0 -12 L0 -6" /><path d="M0 6 L0 12" />
          <path d="M-12 0 L-6 0" /><path d="M6 0 L12 0" />
          <path d="M-8.5 -8.5 L-4.5 -4.5" /><path d="M4.5 4.5 L8.5 8.5" />
          <path d="M-8.5 8.5 L-4.5 4.5" /><path d="M4.5 -4.5 L8.5 -8.5" />
        </g>
      </g>
    </svg>
  );
}

/* ── Tracks infographic ─────────────────────────────────────────────────── */

function TracksInfographic() {
  return (
    <div className="ig-tracks">
      <div className="ig-tracks-head">
        <h2>How the tracks are organized</h2>
        <span className="sub">Capiro mirrors the Hill's own structure, auth, appropriations, and supporting docs.</span>
      </div>

      {/* AUTHORIZATION */}
      <div className="ig-track">
        <div className="ig-track-head">
          <div className="left">
            <span className="badge auth">Track 1 · Authorization</span>
            <h3>Sets the policy.</h3>
          </div>
          <p className="lede">
            Authorizing bills set policy ceilings, they <b>don't fund anything directly</b>; appropriations does.
            Most reauthorize on a fixed cycle, so timing is everything. <b>FY{CURRENT_FY}</b> is the active cycle.
          </p>
        </div>
        <div className="ig-auth-list">
          {AUTH_TIMELINES.map((t) => (
            <div key={t.code} className="ig-auth-row">
              <div className="ig-auth-name">
                <span className="code">{t.code}</span>
                <span className="name">{t.name}</span>
                <span className="note">{t.note}</span>
              </div>
              <div className="ig-cycle">
                {[CURRENT_FY - 3, CURRENT_FY - 2, CURRENT_FY - 1, CURRENT_FY, CURRENT_FY + 1, CURRENT_FY + 2, CURRENT_FY + 3].map((fy) => {
                  const state =
                    fy === CURRENT_FY ? 'current' :
                    t.reauthFY === fy ? 'reauth' :
                    fy < CURRENT_FY ? 'past' : 'future';
                  return (
                    <div key={fy} className="ig-cycle-cell" data-state={state}>FY{fy}</div>
                  );
                })}
              </div>
              <div className="ig-cycle-meta">
                <b>{t.cycle}</b>
                {t.reauthFY ? <span>Reauth FY{t.reauthFY}</span> : <span>Every Congress</span>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* APPROPRIATIONS, dual pinwheels */}
      <div className="ig-track">
        <div className="ig-track-head">
          <div className="left">
            <span className="badge approps">Track 2 · Appropriations</span>
            <h3>Funds the government.</h3>
          </div>
          <p className="lede">
            Each chamber's Appropriations Committee runs <b>12 subcommittees</b> that mark up the 12 annual bills.
            Programmatic requests (PRs) and community project funding (CPF / earmarks) flow through these
            subcommittees, each with its own deadlines and conventions.
          </p>
        </div>
        <div className="ig-wheels">
          <ApproWheel chamber="House"  short="HAC" items={APPROPS_HOUSE}  hubColor="var(--info)" />
          <ApproWheel chamber="Senate" short="SAC" items={APPROPS_SENATE} hubColor="var(--notable)" />
        </div>
      </div>

      {/* SUPPORTING DOCS, pyramid */}
      <div className="ig-track">
        <div className="ig-track-head">
          <div className="left">
            <span className="badge support">Track 3 · Supporting docs</span>
            <h3>Carry the case.</h3>
          </div>
          <p className="lede">
            Narrative pieces cascade <b>from formal submission down to the staffer's brief</b>. Each layer is
            shorter and more pointed than the one above. Capiro stores them per strategy so the staff who
            read them know exactly which ask they belong to.
          </p>
        </div>
        <div className="ig-pyramid">
          {SUPPORTING_PYRAMID.map((row) => (
            <div key={row.code} className="ig-pyramid-row">
              <div className="ig-pyramid-bar" data-tier={row.tier}>
                <span className="code">{row.code}</span>
                <span className="name">{row.name}</span>
                <span className="sub">{row.sub}</span>
              </div>
              <div className="descr">{row.descr}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── Pinwheel (one per chamber) ─────────────────────────────────────────── */

function ApproWheel({ chamber, short, items, hubColor }: {
  chamber: string;
  short: string;
  items: AppropsItem[];
  hubColor: string;
}) {
  const W = 360;
  const cx = W / 2;
  const cy = W / 2;
  const rOuter = 168;
  const rInner = 64;

  const segments = items.slice(0, 12).map((it, i) => {
    const startA = ((-90 + i * 30) * Math.PI) / 180;
    const endA = ((-90 + (i + 1) * 30) * Math.PI) / 180;
    const gap = 0.012;
    const sA = startA + gap;
    const eA = endA - gap;
    const x1 = cx + rOuter * Math.cos(sA);
    const y1 = cy + rOuter * Math.sin(sA);
    const x2 = cx + rOuter * Math.cos(eA);
    const y2 = cy + rOuter * Math.sin(eA);
    const x3 = cx + rInner * Math.cos(eA);
    const y3 = cy + rInner * Math.sin(eA);
    const x4 = cx + rInner * Math.cos(sA);
    const y4 = cy + rInner * Math.sin(sA);
    const d = `M ${x1} ${y1} A ${rOuter} ${rOuter} 0 0 1 ${x2} ${y2} L ${x3} ${y3} A ${rInner} ${rInner} 0 0 0 ${x4} ${y4} Z`;
    const midA = (startA + endA) / 2;
    const textR = (rInner + rOuter) / 2;
    const tx = cx + textR * Math.cos(midA);
    const ty = cy + textR * Math.sin(midA);
    return { d, color: COLOR_MAP[it.color], code: it.code, tx, ty };
  });

  return (
    <div className="ig-wheel">
      <div className="ig-wheel-head">
        <span className="name">{chamber} Appropriations</span>
        <span className="meta">{short} · 12 subs</span>
      </div>
      <svg viewBox={`0 0 ${W} ${W}`} aria-label={`${chamber} Appropriations wheel`}>
        <circle cx={cx} cy={cy} r={rOuter + 12} fill="none" stroke="rgba(15,25,45,0.05)" strokeWidth="1" strokeDasharray="3 4" />
        {segments.map((seg, i) => (
          <g key={i}>
            <path d={seg.d} fill={seg.color} opacity={0.86} />
            <text
              x={seg.tx}
              y={seg.ty}
              textAnchor="middle"
              dominantBaseline="central"
              fontFamily="JetBrains Mono, monospace"
              fontSize="11"
              fontWeight="700"
              fill="#fff"
              letterSpacing="0.04em"
            >
              {seg.code}
            </text>
          </g>
        ))}
        <circle cx={cx} cy={cy} r={rInner - 4} fill="var(--bg-dark)" />
        <circle cx={cx} cy={cy} r={rInner - 4} fill="none" stroke={hubColor} strokeWidth="2" />
        <text x={cx} y={cy - 4} textAnchor="middle" fontFamily="JetBrains Mono, monospace" fontSize="20" fontWeight="700" fill="#fff" letterSpacing="0.06em">{short}</text>
        <text x={cx} y={cy + 14} textAnchor="middle" fontFamily="Hanken Grotesk, sans-serif" fontSize="9" fontWeight="600" fill="rgba(255,255,255,0.65)" letterSpacing="0.12em">12 SUBS</text>
      </svg>
      <div className="ig-wheel-legend">
        {([
          { color: 'info' as const,    label: 'Security & defense' },
          { color: 'success' as const, label: 'Ag, science, justice' },
          { color: 'notable' as const, label: 'Energy, interior, financial' },
          { color: 'accent' as const,  label: 'Labor, education, leg branch' },
          { color: 'critical' as const, label: 'Foreign ops, transportation' },
        ]).map((g) => (
          <span key={g.color}>
            <span className="swatch" style={{ background: COLOR_MAP[g.color] }} />
            {g.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ── Ecosystem mindmap ──────────────────────────────────────────────────── */

function EcosystemMindmap() {
  const W = 1240;
  const H = 860;
  const nodeMap = Object.fromEntries(ECO_NODES.map((n) => [n.id, n] as const));

  const edgePath = (a: string, b: string) => {
    const A = nodeMap[a];
    const B = nodeMap[b];
    if (!A || !B) return undefined;
    const mx = (A.x + B.x) / 2;
    const sway = (B.y - A.y) * 0.08;
    return `M ${A.x + A.r} ${A.y} Q ${mx} ${(A.y + B.y) / 2 + sway} ${B.x - B.r} ${B.y}`;
  };

  const edgeGradFor = (a: string, b: string): string => {
    const A = nodeMap[a];
    const B = nodeMap[b];
    if (!A || !B) return 'eco-edge-blue';
    if (A.color === 'gray' || A.color === 'blue') return 'eco-edge-blue';
    if (A.color === 'teal') return 'eco-edge-teal';
    if (A.color === 'amber' && B.color === 'pink') return 'eco-edge-amber';
    if (A.color === 'amber' && B.color === 'purple') return 'eco-edge-amber2';
    return 'eco-edge-amber';
  };

  const columnLabels = [
    { x: 100,  label: 'PLATFORM' },
    { x: 280,  label: 'SUBMITTERS' },
    { x: 510,  label: 'INDUSTRIES' },
    { x: 770,  label: 'TRACKS' },
    { x: 1080, label: 'RECEIVERS' },
  ];

  return (
    <div className="eco-map">
      <div className="eco-map-head">
        <div className="ttl">
          <h2>The submission ecosystem</h2>
          <p>
            Who submits, what they submit, and who receives it, at a glance. Trace any sector through to its
            authorization committee and appropriations subcommittee in a single read.
          </p>
        </div>
        <div className="eco-map-legend">
          <span className="item"><span className="swatch" style={{ background: '#185FA5' }} />Submitters</span>
          <span className="item"><span className="swatch" style={{ background: '#0F6E56' }} />Industries</span>
          <span className="item"><span className="swatch" style={{ background: '#854F0B' }} />Submission tracks</span>
          <span className="item"><span className="swatch" style={{ background: '#993356' }} />Receiving committees</span>
          <span className="item"><span className="swatch" style={{ background: '#534AB7' }} />Approps subcomms.</span>
        </div>
      </div>

      <div className="eco-map-canvas">
        <svg viewBox={`0 0 ${W} ${H}`} aria-label="Capiro submission ecosystem">
          <defs>
            <radialGradient id="eco-glow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#2A57CE" stopOpacity="0.18" />
              <stop offset="100%" stopColor="#2A57CE" stopOpacity="0" />
            </radialGradient>
            <linearGradient id="eco-edge-blue" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#185FA5" stopOpacity="0.5" />
              <stop offset="100%" stopColor="#0F6E56" stopOpacity="0.4" />
            </linearGradient>
            <linearGradient id="eco-edge-teal" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#0F6E56" stopOpacity="0.5" />
              <stop offset="100%" stopColor="#854F0B" stopOpacity="0.4" />
            </linearGradient>
            <linearGradient id="eco-edge-amber" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#854F0B" stopOpacity="0.5" />
              <stop offset="100%" stopColor="#993356" stopOpacity="0.45" />
            </linearGradient>
            <linearGradient id="eco-edge-amber2" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#854F0B" stopOpacity="0.5" />
              <stop offset="100%" stopColor="#534AB7" stopOpacity="0.45" />
            </linearGradient>
          </defs>

          {columnLabels.map((l) => (
            <text key={l.label} x={l.x} y={36} textAnchor="middle" fontFamily="Hanken Grotesk, sans-serif" fontSize="10.5" fontWeight="700" letterSpacing="2" fill="#8A8780">
              {l.label}
            </text>
          ))}

          <circle cx="100" cy="410" r="200" fill="url(#eco-glow)" />

          {ECO_EDGES.map(([a, b, w], i) => {
            const d = edgePath(a, b);
            if (!d) return null;
            return (
              <path
                key={i}
                className="eco-edge"
                d={d}
                fill="none"
                stroke={`url(#${edgeGradFor(a, b)})`}
                strokeWidth={w || 1}
                strokeLinecap="round"
              />
            );
          })}

          {ECO_NODES.map((n) => {
            const c = ECO_PALETTE[n.color];
            const isCenter = !!n.center;
            return (
              <g key={n.id} className="eco-node" transform={`translate(${n.x},${n.y})`}>
                {isCenter && (
                  <circle r={n.r + 8} fill="none" stroke="#2A57CE" strokeWidth="1" strokeDasharray="3 5" opacity="0.4" />
                )}
                <circle
                  r={n.r}
                  fill={isCenter ? 'var(--bg-dark)' : c.fill}
                  stroke={c.stroke}
                  strokeWidth={isCenter ? 0 : 1.5}
                />
                <text
                  x="0"
                  y={n.sub ? -2 : 1}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontFamily="Hanken Grotesk, sans-serif"
                  fontSize={n.r > 36 ? 13 : n.r > 26 ? 11 : 9.5}
                  fontWeight="700"
                  letterSpacing="-0.005em"
                  fill={isCenter ? '#fff' : c.text}
                >
                  {n.label}
                </text>
                {n.sub && (
                  <text
                    x="0"
                    y={n.r > 36 ? 14 : 11}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontFamily="Hanken Grotesk, sans-serif"
                    fontSize={n.r > 36 ? 10 : 8.5}
                    fontWeight="500"
                    fill={isCenter ? 'rgba(255,255,255,0.65)' : c.text}
                    opacity={isCenter ? 1 : 0.7}
                  >
                    {n.sub}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
