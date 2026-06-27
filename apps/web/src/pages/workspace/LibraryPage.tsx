import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { App as AntApp, Spin } from 'antd';
import {
  FileTextOutlined,
  MailOutlined,
  AudioOutlined,
  FileOutlined,
  SnippetsOutlined,
  RiseOutlined,
  TeamOutlined,
  BankOutlined,
  DollarOutlined,
  FileProtectOutlined,
  FormOutlined,
  PlusOutlined,
  ThunderboltOutlined,
  ArrowRightOutlined,
} from '@ant-design/icons';
import { useIndustries, useProductsFor, useProductDefaults, useCreateDraft } from './api.js';

/** Per-product icon + one-line description (mirrors the mockup cards). */
const PRODUCT_ICON: Record<string, React.ReactNode> = {
  'Member letter': <MailOutlined />,
  'Written testimony': <AudioOutlined />,
  'One-pager': <FileOutlined />,
  'Strategy memo': <SnippetsOutlined />,
  'NDAA Authorization Request': <RiseOutlined />,
  'Meeting Brief & Advocacy': <TeamOutlined />,
  'Appropriations Justification': <DollarOutlined />,
  'CDS / Earmark Application': <BankOutlined />,
  'Authorization Bill Language': <FileProtectOutlined />,
  'Report Language Request': <FormOutlined />,
  'White paper': <FileTextOutlined />,
};
const PRODUCT_DESC: Record<string, string> = {
  'Member letter': 'Cosponsor request, support letter, or consolidated sign-on letter to a Member.',
  'Written testimony': 'Statement for the record before a committee or agency.',
  'One-pager': 'Meeting leave-behind or fact sheet summarizing the program and ask.',
  'Strategy memo': 'Internal brief covering situation analysis and strategic recommendation.',
  'NDAA Authorization Request': 'Request program authorization or a budget adjustment.',
  'Meeting Brief & Advocacy': 'Leave-behind brief for a member or staff meeting.',
  'Appropriations Justification': "Detail a program's funding need and justification.",
  'CDS / Earmark Application': 'Community project funding application.',
  'Authorization Bill Language': 'Amendatory statutory / authorizing text.',
  'Report Language Request': 'Directive or encouraging committee report language.',
  'White paper': 'Narrative program paper supporting authorization, appropriations, or policy asks.',
};

/**
 * Workspace Library — the landing experience, matching the mockup
 * (Capiro Workspace · White Papers): serif hero, "Start with Meri" prompt box,
 * Library/Documents tabs, sector chips, and the work-product card grid.
 */
export function LibraryPage() {
  const navigate = useNavigate();
  const { message } = AntApp.useApp();
  const [sector, setSector] = useState<string | null>(null);
  const [meriPrompt, setMeriPrompt] = useState('');
  const { data: industries } = useIndustries();
  const { data: products, isLoading } = useProductsFor(sector, sector === null);
  const createDraft = useCreateDraft();

  const sectors = useMemo(() => industries ?? [], [industries]);

  const startProduct = async (product: string) => {
    try {
      const draft = await createDraft.mutateAsync({ industry: sector ?? undefined, product });
      navigate(`/workspace/setup/${draft.id}`);
    } catch {
      message.error('Could not start a new document. Please try again.');
    }
  };

  const draftWithMeri = async () => {
    if (!meriPrompt.trim()) {
      message.info('Describe what you need and Meri will set it up.');
      return;
    }
    try {
      const draft = await createDraft.mutateAsync({ industry: sector ?? undefined });
      navigate(`/workspace/setup/${draft.id}`);
    } catch {
      message.error('Could not start. Please try again.');
    }
  };

  return (
    <div className="ws-stage ws-library">
      {/* Hero */}
      <div className="ws-hero">
        <div style={{ flex: 1 }}>
          <div className="ws-kicker">Workspace</div>
          <h1 className="ws-hero-title">
            Government affairs, <em>drafted</em>
          </h1>
          <p className="ws-hero-sub">
            From NDAA requests to member letters — every work product your program depends on,
            built with Meri.
          </p>
        </div>
        <button className="ws-btn-dark" onClick={draftWithMeri}>
          <PlusOutlined /> New document
        </button>
      </div>

      {/* Tabs */}
      <div className="ws-tabs">
        <button className="ws-tab on">Library</button>
        <button className="ws-tab" onClick={() => navigate('/workspace/documents')}>
          Documents
        </button>
      </div>

      {/* Start with Meri */}
      <div className="ws-meri-panel">
        <div className="ws-meri-label" style={{ marginBottom: 6 }}>
          <ThunderboltOutlined /> Start with Meri
        </div>
        <p className="ws-meri-help">
          Describe the ask in plain language. Meri picks the work product, drafts the outline, and
          pulls in client, offices and program data from the platform.
        </p>
        <div className="ws-meri-input-row">
          <input
            className="ws-meri-input"
            value={meriPrompt}
            onChange={(e) => setMeriPrompt(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && draftWithMeri()}
            placeholder="“$10M plus-up for Aerovance's JaiaBot HYDRO, Navy RDT&E, targeting HAC-D and SASC…”"
          />
          <button className="ws-btn-accent" onClick={draftWithMeri}>
            <ThunderboltOutlined /> Draft it
          </button>
        </div>
      </div>

      {/* Sector filter */}
      <div className="ws-section-head">
        <span className="ws-kicker">Or start from a work product</span>
        <span style={{ fontSize: 11.5, color: 'var(--ws-ink-3)' }}>filtered by sector</span>
      </div>
      <div className="ws-chip-row" style={{ marginBottom: 18 }}>
        <button className={`ws-chip${sector === null ? ' on' : ''}`} onClick={() => setSector(null)}>
          {sector === null ? '✓ ' : ''}All sectors
        </button>
        {sectors.map((s) => (
          <button
            key={s}
            className={`ws-chip${sector === s ? ' on' : ''}`}
            onClick={() => setSector(sector === s ? null : s)}
          >
            {s}
          </button>
        ))}
      </div>

      {/* Product cards */}
      {isLoading ? (
        <div style={{ textAlign: 'center', padding: 60 }}>
          <Spin />
        </div>
      ) : (
        <div className="ws-card-grid">
          {(products ?? []).map((p) => (
            <div key={p} className="ws-product-card" onClick={() => startProduct(p)}>
              <div className="ws-product-icon">{PRODUCT_ICON[p] ?? <FileTextOutlined />}</div>
              <div className="ws-product-name">{p}</div>
              <div className="ws-product-desc">{PRODUCT_DESC[p] ?? ''}</div>
              <div className="ws-product-start">
                Start <ArrowRightOutlined />
              </div>
            </div>
          ))}

          {/* "Don't see it?" card */}
          <div className="ws-product-card ws-product-card--ghost">
            <div className="ws-product-icon ws-product-icon--ghost">
              <PlusOutlined />
            </div>
            <div className="ws-product-name">Don't see it?</div>
            <div className="ws-product-desc">
              Build a custom work product with Meri, or request one Capiro doesn't offer yet.
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button className="ws-btn-accent ws-btn-sm" onClick={draftWithMeri}>
                <ThunderboltOutlined /> Build with Meri
              </button>
              <button
                className="ws-btn-light ws-btn-sm"
                onClick={() => message.info('Request a product — coming soon.')}
              >
                <MailOutlined /> Request
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
