import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { App as AntApp, Button, Input, Spin, Tabs } from 'antd';
import {
  CheckOutlined,
  EyeInvisibleOutlined,
  EyeOutlined,
  FileTextOutlined,
  PlusOutlined,
  PictureOutlined,
  TableOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { StepsRail } from './StepsRail.js';
import {
  useDraft,
  useUpdateDraft,
  useComments,
  useCreateComment,
  useUpdateComment,
  useGenerateSection,
} from './api.js';
import type { WsConfig } from './types.js';

/** Editor — three-zone shell: insert rail | document canvas | Meri/Comments. */
export function EditorPage() {
  const { draftId } = useParams();
  const navigate = useNavigate();
  const { message } = AntApp.useApp();
  const { data: draft, isLoading } = useDraft(draftId ?? null);
  const update = useUpdateDraft(draftId ?? '');
  const [activeTab, setActiveTab] = useState<string>('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (draft && !activeTab && draft.documents[0]) setActiveTab(draft.documents[0].id);
  }, [draft, activeTab]);

  if (isLoading || !draft) {
    return (
      <div className="ws-shell">
        <StepsRail active="draft" draftId={draftId} />
        <div className="ws-stage" style={{ textAlign: 'center', padding: 60 }}><Spin /></div>
      </div>
    );
  }

  const cfg = draft.config;
  const sections = cfg.sections ?? [];

  const patchConfig = (partial: Partial<WsConfig>) => {
    setSaving(true);
    update.mutate({ config: partial }, { onSettled: () => setSaving(false) });
  };

  const renameSection = (i: number, name: string) => {
    const next = [...sections];
    next[i] = name;
    patchConfig({ sections: next });
  };
  const removeSection = (i: number) => patchConfig({ sections: sections.filter((_, j) => j !== i) });
  const addSection = () => patchConfig({ sections: [...sections, 'New section'] });

  return (
    <div className="ws-shell">
      <StepsRail active="draft" draftId={draftId} product={draft.product}>
        <SectionOutline sections={sections} />
      </StepsRail>

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {/* Toolbar */}
        <EditorToolbar
          title={draft.docTitle}
          saving={saving}
          anonymize={cfg.anonymize}
          onTitle={(docTitle) => update.mutate({ docTitle })}
          onAnonymize={() => patchConfig({ anonymize: !cfg.anonymize })}
          onSave={() => { update.mutate({}); message.success('Draft saved'); }}
          onPreview={() => navigate(`/workspace/preview/${draftId}`)}
        />

        {/* Packet tabs */}
        {draft.documents.length > 1 && (
          <Tabs
            activeKey={activeTab}
            onChange={setActiveTab}
            type="card"
            style={{ padding: '6px 16px 0' }}
            items={draft.documents.map((d) => ({ key: d.id, label: d.name }))}
          />
        )}

        <div className="ws-editor-grid">
          {/* Insert rail */}
          <InsertRail onAddSection={addSection} />

          {/* Document canvas */}
          <div style={{ overflow: 'auto', padding: '24px 16px' }}>
            <div className="ws-doc-canvas">
              {cfg.letterhead?.custom && (
                <div style={{ textAlign: 'center', borderBottom: '2px solid var(--ws-ink-1)', paddingBottom: 10, marginBottom: 24 }}>
                  <div style={{ fontWeight: 700, fontSize: 16 }}>{cfg.letterhead.firmName || 'Firm name'}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--ws-ink-3)' }}>{cfg.letterhead.firmAddr}</div>
                </div>
              )}
              <h1
                contentEditable
                suppressContentEditableWarning
                onBlur={(e) => update.mutate({ docTitle: e.currentTarget.textContent ?? '' })}
              >
                {draft.docTitle}
              </h1>
              {sections.map((s, i) => (
                <SectionBlock
                  key={i}
                  name={s}
                  content={(cfg.sectionContent as Record<string, string> | undefined)?.[s] ?? ''}
                  draftId={draftId!}
                  onRename={(name) => renameSection(i, name)}
                  onGenerated={(content) =>
                    patchConfig({
                      sectionContent: {
                        ...((cfg.sectionContent as Record<string, string> | undefined) ?? {}),
                        [s]: content,
                      },
                    })
                  }
                />
              ))}
            </div>
          </div>

          {/* Meri / Comments rail */}
          <MeriCommentsRail documentId={activeTab} />
        </div>
      </div>
    </div>
  );
}

function SectionBlock({
  name,
  content,
  draftId,
  onRename,
  onGenerated,
}: {
  name: string;
  content: string;
  draftId: string;
  onRename: (name: string) => void;
  onGenerated: (content: string) => void;
}) {
  const { message } = AntApp.useApp();
  const generate = useGenerateSection(draftId);
  return (
    <div>
      <h3
        contentEditable
        suppressContentEditableWarning
        onBlur={(e) => onRename(e.currentTarget.textContent ?? name)}
      >
        {name}
      </h3>
      {content ? (
        <p
          contentEditable
          suppressContentEditableWarning
          style={{ fontSize: 14, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}
          onBlur={(e) => onGenerated(e.currentTarget.textContent ?? content)}
        >
          {content}
        </p>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <p style={{ color: 'var(--ws-ink-3)', fontStyle: 'italic', fontSize: 13, margin: 0 }}>
            Draft with Meri — generated from your setup and context.
          </p>
          <Button
            size="small"
            type="primary"
            ghost
            loading={generate.isPending}
            icon={<ThunderboltOutlined />}
            onClick={() =>
              generate.mutate(name, {
                onSuccess: (r) => {
                  onGenerated(r.content);
                  message.success(
                    `Drafted with ${r.model}${r.usedTenantKey ? ' (your key)' : ''}${r.anonymized ? ' · anonymized' : ''}`,
                  );
                },
                onError: (e: unknown) => {
                  const msg =
                    (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
                    'Generation failed';
                  message.error(msg);
                },
              })
            }
          >
            Draft with Meri
          </Button>
        </div>
      )}
    </div>
  );
}

function SectionOutline({ sections }: { sections: string[] }) {
  return (
    <div style={{ margin: '2px 0 6px 19px', paddingLeft: 11, borderLeft: '1px solid var(--ws-border-1)' }}>
      {sections.map((s, j) => (
        <div key={j} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 6px', fontSize: 12 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', border: '1.5px solid var(--ws-ink-4)', flex: 'none' }} />
          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s}</span>
        </div>
      ))}
    </div>
  );
}

function EditorToolbar({
  title,
  saving,
  anonymize,
  onTitle,
  onAnonymize,
  onSave,
  onPreview,
}: {
  title: string;
  saving: boolean;
  anonymize: boolean;
  onTitle: (t: string) => void;
  onAnonymize: () => void;
  onSave: () => void;
  onPreview: () => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '10px 24px', borderBottom: '1px solid var(--ws-border-1)', background: 'var(--ws-bg-surface)' }}>
      <div style={{ minWidth: 0, maxWidth: 360 }}>
        <div style={{ fontWeight: 600, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
        <div style={{ fontSize: 11, color: 'var(--ws-ink-3)', display: 'flex', alignItems: 'center', gap: 5 }}>
          {saving ? 'Saving…' : (<><CheckOutlined style={{ color: 'var(--ws-success)' }} /> Saved · just now</>)}
        </div>
      </div>
      <div style={{ flex: 1 }} />
      <Button size="small" type={anonymize ? 'primary' : 'default'} icon={anonymize ? <EyeInvisibleOutlined /> : <EyeOutlined />} onClick={onAnonymize}>
        {anonymize ? 'Anonymized' : 'Anonymize'}
      </Button>
      <Button size="small" onClick={onSave}>Save draft</Button>
      <Button size="small" type="primary" icon={<FileTextOutlined />} onClick={onPreview}>Preview & Save</Button>
    </div>
  );
}

function InsertRail({ onAddSection }: { onAddSection: () => void }) {
  const tiles = [
    { icon: <PlusOutlined />, label: 'Section', onClick: onAddSection },
    { icon: <PictureOutlined />, label: 'Photo', onClick: () => {} },
    { icon: <TableOutlined />, label: 'Table', onClick: () => {} },
  ];
  return (
    <div className="ws-insert-rail">
      <div className="ws-kicker" style={{ marginBottom: 10 }}>Insert</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {tiles.map((t) => (
          <button
            key={t.label}
            onClick={t.onClick}
            className="ws-card"
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 11px', cursor: 'pointer', fontSize: 13, fontWeight: 500, border: '1px solid var(--ws-border-1)', background: 'var(--ws-bg-surface)' }}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function MeriCommentsRail({ documentId }: { documentId: string }) {
  const [tab, setTab] = useState<'meri' | 'comments'>('meri');
  const { data: comments } = useComments(documentId || null);
  const create = useCreateComment(documentId);
  const updateComment = useUpdateComment(documentId);
  const [draft, setDraft] = useState('');

  return (
    <div className="ws-meri-rail">
      <Tabs
        activeKey={tab}
        onChange={(k) => setTab(k as 'meri' | 'comments')}
        items={[
          { key: 'meri', label: (<span><ThunderboltOutlined /> Meri</span>) },
          { key: 'comments', label: `Comments${comments?.length ? ` (${comments.length})` : ''}` },
        ]}
      />
      {tab === 'meri' ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div style={{ flex: 1, fontSize: 13, color: 'var(--ws-ink-2)' }}>
            Ask Meri to draft a section, tighten the ask, or pull in context. Generation arrives in
            the next pass.
          </div>
          <Input.TextArea rows={3} placeholder="Ask Meri…" disabled />
        </div>
      ) : (
        <div style={{ flex: 1, overflow: 'auto' }}>
          {(comments ?? []).map((c) => (
            <div key={c.id} className="ws-card" style={{ padding: 10, marginBottom: 8 }}>
              {c.quote && <div style={{ fontSize: 11, color: 'var(--ws-accent)', borderLeft: '2px solid var(--ws-accent)', paddingLeft: 6, marginBottom: 4 }}>{c.quote}</div>}
              <div style={{ fontSize: 13 }}>{c.body}</div>
              {!c.resolved && (
                <Button size="small" type="text" icon={<CheckOutlined />} onClick={() => updateComment.mutate({ commentId: c.id, body: { resolved: true } })}>
                  Resolve
                </Button>
              )}
            </div>
          ))}
          <Input.TextArea rows={2} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add a comment…" />
          <Button
            size="small"
            style={{ marginTop: 6 }}
            disabled={!draft.trim() || !documentId}
            onClick={() => create.mutate({ body: draft.trim() }, { onSuccess: () => setDraft('') })}
          >
            Comment
          </Button>
        </div>
      )}
    </div>
  );
}
