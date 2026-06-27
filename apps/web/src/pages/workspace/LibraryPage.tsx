import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { App as AntApp, Spin } from 'antd';
import { FileTextOutlined, PlusOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { useIndustries, useProductsFor, useCreateDraft } from './api.js';

/**
 * Workspace Library — the entry point. Sector chips filter the work-product
 * cards; clicking a card seeds a new draft (industry + product) and enters
 * Setup. Mirrors the prototype WsLibrary.
 */
export function LibraryPage() {
  const navigate = useNavigate();
  const { message } = AntApp.useApp();
  const [sector, setSector] = useState<string | null>(null);
  const { data: industries } = useIndustries();
  const { data: products, isLoading } = useProductsFor(sector, sector === null);
  const createDraft = useCreateDraft();

  const sectors = useMemo(() => industries ?? [], [industries]);

  const startProduct = async (product: string) => {
    try {
      const draft = await createDraft.mutateAsync({
        industry: sector ?? undefined,
        product,
      });
      navigate(`/workspace/setup/${draft.id}`);
    } catch {
      message.error('Could not start a new document. Please try again.');
    }
  };

  return (
    <div className="ws-stage" style={{ maxWidth: 1180, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Workspace</h1>
        <a onClick={() => navigate('/workspace/documents')} style={{ color: 'var(--ws-accent)', fontWeight: 600, cursor: 'pointer', fontSize: 13 }}>
          View all documents →
        </a>
      </div>
      <p style={{ color: 'var(--ws-ink-2)', marginTop: 0, marginBottom: 20, fontSize: 13.5 }}>
        Produce any government-affairs work product with Meri — white papers, justifications,
        testimony, letters, and more.
      </p>

      <div className="ws-meri-callout" style={{ marginBottom: 22 }}>
        <span className="ws-meri-label">
          <ThunderboltOutlined /> Meri
        </span>
        <span style={{ flex: 1, fontSize: 13, color: 'var(--ws-ink-1)' }}>
          Pick a work product to start, or describe what you need and I'll set it up.
        </span>
      </div>

      {/* Sector filter chips */}
      <div className="ws-chip-row" style={{ marginBottom: 18 }}>
        <button className={`ws-chip${sector === null ? ' on' : ''}`} onClick={() => setSector(null)}>
          All sectors
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
              <div className="ws-product-icon">
                <FileTextOutlined />
              </div>
              <div style={{ fontWeight: 700, fontSize: 14.5 }}>{p}</div>
            </div>
          ))}

          {/* "Don't see it?" card */}
          <div
            className="ws-product-card"
            style={{ borderStyle: 'dashed', justifyContent: 'center', alignItems: 'flex-start' }}
            onClick={() => message.info('Request a product — coming soon.')}
          >
            <div className="ws-product-icon" style={{ background: 'var(--ws-bg-sunken)', color: 'var(--ws-ink-3)' }}>
              <PlusOutlined />
            </div>
            <div style={{ fontWeight: 700, fontSize: 14.5 }}>Don't see it?</div>
            <div style={{ fontSize: 12.5, color: 'var(--ws-ink-3)' }}>
              Build a custom product with Meri, or request one from Capiro.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
