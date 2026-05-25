import { useNavigate } from 'react-router-dom';
import { ArrowRightOutlined } from '@ant-design/icons';

const AUTHORIZATION_TRACKS = [
  { code: 'NDAA', name: 'National Defense Authorization Act', cycle: 'Annual' },
  { code: 'FAA', name: 'FAA Reauthorization', cycle: '5-year' },
  { code: 'Farm', name: 'Farm Bill', cycle: '5-year' },
  { code: 'WRDA', name: 'Water Resources Development Act', cycle: '2-year' },
  { code: 'Higher', name: 'Higher Education Act', cycle: 'Periodic' },
  { code: 'IIJA', name: 'Surface Transportation Reauthorization', cycle: '5-year' },
] as const;

const APPROPRIATIONS_TRACKS = [
  'HAC-D',
  'HAC-MC',
  'HAC-HS',
  'HAC-AG',
  'HAC-CJS',
  'HAC-EW',
  'HAC-FS',
  'HAC-IE',
  'HAC-LHHS',
  'HAC-Leg',
  'HAC-SFO',
  'HAC-THUD',
] as const;

const SUPPORTING_DOCS = [
  { code: 'SUB', label: 'Formal submission', detail: 'NDAA / HAC / CPF' },
  { code: 'WP', label: 'Program white paper', detail: '2-4 pages' },
  { code: 'TP', label: 'Talking points', detail: '3-5 bullets' },
  { code: 'Q&A', label: 'Member office brief', detail: 'Internal prep' },
] as const;

const FLOW = [
  {
    title: 'Strategy setup',
    detail: 'Pick the client, capability, and fiscal year. Capiro creates the strategy container.',
  },
  {
    title: 'Library selection',
    detail: 'Select authorization, appropriations, and supporting templates from the library.',
  },
  {
    title: 'Workflow execution',
    detail: 'Run each request through drafting, review, and submission inside Workflows.',
  },
  {
    title: 'Targeting + outreach',
    detail: 'Map member offices and staffers, then coordinate follow-through in Engagement.',
  },
  {
    title: 'Track completion',
    detail: 'Monitor progress and deadlines until every ask is filed and closed.',
  },
] as const;

export function WorkspaceOverview() {
  const navigate = useNavigate();

  return (
    <div className="workspace-overview">
      <section className="workspace-overview-hero">
        <div>
          <span className="workspace-overview-eyebrow">Workspace</span>
          <h2>Where strategy turns into Hill-ready deliverables.</h2>
          <p>
            Build complete fiscal-year packages in one place: template library, active workflows, and
            strategy tracking. Keep execution tight without jumping across disconnected tools.
          </p>
          <div className="workspace-overview-hero-actions">
            <button type="button" className="workspace-cta workspace-cta-primary" onClick={() => navigate('/workspace/strategies')}>
              Open Strategies <ArrowRightOutlined />
            </button>
            <button type="button" className="workspace-cta" onClick={() => navigate('/workspace/library')}>
              Browse Library
            </button>
          </div>
        </div>
      </section>

      <section>
        <div className="workspace-section-head">
          <h3>Three places to execute</h3>
        </div>
        <div className="workspace-pillars">
          <button type="button" className="workspace-pillar" onClick={() => navigate('/workspace/library')}>
            <h4>Library</h4>
            <p>Catalog of submission templates across authorization, appropriations, and supporting docs.</p>
          </button>
          <button type="button" className="workspace-pillar" onClick={() => navigate('/workspace/workflows')}>
            <h4>Workflows</h4>
            <p>Operational execution view of active requests by status, client, and deadline pressure.</p>
          </button>
          <button type="button" className="workspace-pillar" onClick={() => navigate('/workspace/strategies')}>
            <h4>Strategies</h4>
            <p>FY-scoped plans linking submissions, targets, and progress for each client capability.</p>
          </button>
        </div>
      </section>

      <section className="workspace-tracks">
        <div className="workspace-section-head">
          <h3>How tracks are organized</h3>
        </div>
        <div className="workspace-track-grid">
          <article className="workspace-track-card">
            <h4>Track 1 · Authorization</h4>
            <div className="workspace-chip-grid">
              {AUTHORIZATION_TRACKS.map((track) => (
                <div key={track.code} className="workspace-chip">
                  <strong>{track.code}</strong>
                  <span>{track.name}</span>
                  <em>{track.cycle}</em>
                </div>
              ))}
            </div>
          </article>
          <article className="workspace-track-card">
            <h4>Track 2 · Appropriations</h4>
            <div className="workspace-subcommittee-grid">
              {APPROPRIATIONS_TRACKS.map((code) => (
                <span key={code} className="workspace-subcommittee-chip">
                  {code}
                </span>
              ))}
            </div>
          </article>
          <article className="workspace-track-card">
            <h4>Track 3 · Supporting docs</h4>
            <div className="workspace-doc-stack">
              {SUPPORTING_DOCS.map((item) => (
                <div key={item.code} className="workspace-doc-row">
                  <span>{item.code}</span>
                  <div>
                    <strong>{item.label}</strong>
                    <small>{item.detail}</small>
                  </div>
                </div>
              ))}
            </div>
          </article>
        </div>
      </section>

      <section>
        <div className="workspace-section-head">
          <h3>Typical FY execution flow</h3>
        </div>
        <div className="workspace-flow">
          {FLOW.map((step, index) => (
            <article key={step.title} className="workspace-flow-step">
              <span>{index + 1}</span>
              <h4>{step.title}</h4>
              <p>{step.detail}</p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
