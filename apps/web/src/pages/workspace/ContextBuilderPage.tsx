import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { App as AntApp, Button, Input, Spin } from 'antd';
import { ArrowRightOutlined, CloseOutlined, PlusOutlined } from '@ant-design/icons';
import { StepsRail } from './StepsRail.js';
import {
  useDraft,
  useContextSources,
  useDraftContext,
  useAddContextItem,
  useRemoveContextItem,
} from './api.js';

/** Build Context — pull sources/news + free-text grounding for Meri. */
export function ContextBuilderPage() {
  const { draftId } = useParams();
  const navigate = useNavigate();
  const { message } = AntApp.useApp();
  const { data: draft, isLoading } = useDraft(draftId ?? null);
  const { data: sources } = useContextSources(draft?.client ?? null, draft?.config.offices ?? []);
  const { data: items } = useDraftContext(draftId ?? null);
  const addItem = useAddContextItem(draftId ?? '');
  const removeItem = useRemoveContextItem(draftId ?? '');
  const [freeText, setFreeText] = useState('');

  if (isLoading || !draft) {
    return (
      <div className="ws-shell">
        <StepsRail active="context" draftId={draftId} />
        <div className="ws-stage" style={{ textAlign: 'center', padding: 60 }}><Spin /></div>
      </div>
    );
  }

  const sourceGroups = (sources?.groups ?? []) as { type: string; label: string; items: { id: string; label: string }[] }[];

  return (
    <div className="ws-shell">
      <StepsRail active="context" draftId={draftId} product={draft.product} />
      <div className="ws-stage" style={{ maxWidth: 960, margin: '0 auto' }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, marginTop: 0 }}>Build context</h1>
        <p style={{ color: 'var(--ws-ink-2)', marginTop: 0, fontSize: 13 }}>
          Add the sources and notes Meri should ground the draft in. Everything is scoped to
          {draft.client ? ` ${draft.client}` : ' this client'} and the selected offices.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 18 }}>
          {/* Left: available sources */}
          <div>
            {sourceGroups.map((g) => (
              <div key={g.type} className="ws-card" style={{ padding: 16, marginBottom: 14 }}>
                <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 10 }}>{g.label}</div>
                {g.items.length === 0 ? (
                  <div style={{ fontSize: 12.5, color: 'var(--ws-ink-3)' }}>No items.</div>
                ) : (
                  g.items.map((it) => (
                    <div key={it.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0' }}>
                      <span style={{ fontSize: 13 }}>{it.label}</span>
                      <Button
                        size="small"
                        icon={<PlusOutlined />}
                        onClick={() =>
                          addItem.mutate(
                            { kind: 'source', payload: { sourceType: g.type, refId: it.id, label: it.label } },
                            { onSuccess: () => message.success('Added to context plan') },
                          )
                        }
                      >
                        Add to context plan
                      </Button>
                    </div>
                  ))
                )}
              </div>
            ))}

            {/* Free-text additional context */}
            <div className="ws-card" style={{ padding: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 8 }}>Additional context for Meri</div>
              <Input.TextArea
                rows={3}
                value={freeText}
                onChange={(e) => setFreeText(e.target.value)}
                placeholder="Talking points, constraints, emphasis areas…"
              />
              <Button
                style={{ marginTop: 8 }}
                disabled={!freeText.trim()}
                onClick={() =>
                  addItem.mutate(
                    { kind: 'free-text', payload: { text: freeText.trim() } },
                    {
                      onSuccess: () => {
                        setFreeText('');
                        message.success('Added to context plan');
                      },
                    },
                  )
                }
              >
                Add to context plan
              </Button>
            </div>
          </div>

          {/* Right: context plan */}
          <div className="ws-card" style={{ padding: 16, alignSelf: 'flex-start' }}>
            <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 10 }}>Context plan</div>
            {(items ?? []).length === 0 ? (
              <div style={{ fontSize: 12.5, color: 'var(--ws-ink-3)' }}>Nothing added yet.</div>
            ) : (
              (items ?? []).map((it) => (
                <div key={it.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid var(--ws-border-1)' }}>
                  <span style={{ fontSize: 12.5 }}>
                    {it.kind === 'free-text'
                      ? String((it.payload as { text?: string }).text ?? 'Note')
                      : String((it.payload as { label?: string }).label ?? it.kind)}
                  </span>
                  <CloseOutlined
                    style={{ cursor: 'pointer', color: 'var(--ws-ink-3)' }}
                    onClick={() => removeItem.mutate(it.id)}
                  />
                </div>
              ))
            )}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
          <Button type="primary" size="large" icon={<ArrowRightOutlined />} onClick={() => navigate(`/workspace/draft/${draftId}`)}>
            Continue to Draft
          </Button>
        </div>
      </div>
    </div>
  );
}
