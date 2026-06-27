import { useNavigate, useParams } from 'react-router-dom';
import { App as AntApp, Button, Segmented, Spin } from 'antd';
import { ArrowLeftOutlined, DownloadOutlined, FilePdfOutlined, FileWordOutlined } from '@ant-design/icons';
import { useState } from 'react';
import { StepsRail } from './StepsRail.js';
import { useDraft } from './api.js';

/** Preview & Save — paginated print preview + export options. */
export function PreviewPage() {
  const { draftId } = useParams();
  const navigate = useNavigate();
  const { message } = AntApp.useApp();
  const { data: draft, isLoading } = useDraft(draftId ?? null);
  const [bundle, setBundle] = useState<'Separate files' | 'Combined packet'>('Separate files');

  if (isLoading || !draft) {
    return (
      <div className="ws-shell">
        <StepsRail active="preview" draftId={draftId} />
        <div className="ws-stage" style={{ textAlign: 'center', padding: 60 }}><Spin /></div>
      </div>
    );
  }

  const cfg = draft.config;
  return (
    <div className="ws-shell">
      <StepsRail active="preview" draftId={draftId} product={draft.product} />
      <div className="ws-stage" style={{ maxWidth: 900, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Preview & Save</h1>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(`/workspace/draft/${draftId}`)}>
            Back to editor
          </Button>
        </div>

        {/* Export controls */}
        <div className="ws-card" style={{ padding: 16, marginBottom: 18, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          {draft.isPacket && (
            <Segmented
              value={bundle}
              options={['Separate files', 'Combined packet']}
              onChange={(v) => setBundle(v as typeof bundle)}
            />
          )}
          <div style={{ flex: 1 }} />
          <Button icon={<FilePdfOutlined />} onClick={() => message.info('PDF export — wiring in Phase 6')}>
            Export PDF
          </Button>
          <Button icon={<FileWordOutlined />} onClick={() => message.info('Word export — wiring in Phase 6')}>
            Export Word
          </Button>
          <Button type="primary" icon={<DownloadOutlined />} onClick={() => message.info('Download — wiring in Phase 6')}>
            Download
          </Button>
        </div>

        {/* Paginated preview */}
        <div className="ws-doc-canvas" style={{ margin: '0 auto' }}>
          {cfg.letterhead?.custom && (
            <div style={{ textAlign: 'center', borderBottom: '2px solid var(--ws-ink-1)', paddingBottom: 10, marginBottom: 24 }}>
              <div style={{ fontWeight: 700, fontSize: 16 }}>{cfg.letterhead.firmName || 'Firm name'}</div>
              <div style={{ fontSize: 11.5, color: 'var(--ws-ink-3)' }}>{cfg.letterhead.firmAddr}</div>
            </div>
          )}
          <h1>{draft.docTitle}</h1>
          {(cfg.sections ?? []).map((s, i) => (
            <div key={i}>
              <h3>{s}</h3>
              <p style={{ color: 'var(--ws-ink-2)', fontSize: 13.5, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                {(cfg.sectionContent as Record<string, string> | undefined)?.[s] || `[${s} content]`}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
