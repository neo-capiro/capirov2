import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App as AntApp, Button, Empty, Input, Skeleton, Typography } from 'antd';
import {
  ArrowLeftOutlined,
  BulbOutlined,
  DownloadOutlined,
  PlusOutlined,
  RedoOutlined,
  SaveOutlined,
} from '@ant-design/icons';
import { useApi } from '../../lib/use-api.js';
import type { WorkflowInstance } from './workflowTypes.js';

type SaveState = 'saved' | 'saving' | 'dirty' | 'error';

type ToneValue = 'professional_neutral' | 'editorial_narrative' | 'technical_dense' | 'conversational_plain';

interface WhitePaperSection {
  id: string;
  heading: string;
  body: string;
}

interface WhitePaperContextItem {
  id: string;
  title: string;
  kind: string;
  tag?: string;
}

interface StrategyLite {
  id: string;
  fiscalYear: string | null;
  capability?: { name: string | null } | null;
  targets?: Array<{ id: string; memberName?: string | null; committee?: string | null }>;
}

const DEFAULT_HEADINGS = [
  'Executive Summary',
  'Problem Statement',
  'Program Overview',
  'The Ask',
  'Measurable Outcomes',
  'Team & Qualifications',
] as const;

const TONE_OPTIONS: Array<{ value: ToneValue; label: string }> = [
  { value: 'professional_neutral', label: 'Professional · neutral' },
  { value: 'editorial_narrative', label: 'Editorial · narrative' },
  { value: 'technical_dense', label: 'Technical · dense' },
  { value: 'conversational_plain', label: 'Conversational · plain' },
];

function defaultSections(seedBody = ''): WhitePaperSection[] {
  return DEFAULT_HEADINGS.map((heading, index) => ({
    id: `sec-${index + 1}`,
    heading,
    body: index === 0 ? seedBody : '',
  }));
}

function normalizeSections(raw: unknown, fallbackBody: string): WhitePaperSection[] {
  if (Array.isArray(raw)) {
    const sections = raw
      .map((item, index) => {
        const row = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
        const heading = typeof row.heading === 'string' && row.heading.trim() ? row.heading.trim() : `Section ${index + 1}`;
        const body = typeof row.body === 'string' ? row.body : '';
        const id = typeof row.id === 'string' && row.id.trim() ? row.id.trim() : `sec-${index + 1}`;
        return { id, heading, body };
      })
      .filter((section) => section.heading.length > 0);
    if (sections.length) return sections;
  }
  return defaultSections(fallbackBody);
}

function composeDocument(sections: WhitePaperSection[]): string {
  return sections
    .map((section) => {
      const heading = section.heading.trim();
      const body = section.body.trim();
      if (!heading && !body) return '';
      if (!body) return heading;
      return `${heading}\n${body}`;
    })
    .filter(Boolean)
    .join('\n\n');
}

function safeItems(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => item && typeof item === 'object') as Record<string, unknown>[];
}

function parseContextIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function inferSectionDraft(args: {
  sectionHeading: string;
  clientName: string;
  capabilityName: string;
  fiscalYear: string;
  selectedContext: WhitePaperContextItem[];
  steerNote: string;
  tone: ToneValue;
}): string {
  const { sectionHeading, clientName, capabilityName, fiscalYear, selectedContext, steerNote, tone } = args;
  const contextLine = selectedContext.length
    ? selectedContext.map((item) => `${item.kind}: ${item.title}`).join(' | ')
    : 'No specific context selected; use strategy baseline assumptions.';

  const toneGuidance: Record<ToneValue, string> = {
    professional_neutral: 'Use concise, neutral, decision-ready language with clear claims and no rhetorical filler.',
    editorial_narrative: 'Use a concise narrative arc: operating context, risk, action, and expected gain.',
    technical_dense: 'Use dense technical framing, explicit assumptions, and quantifiable statements.',
    conversational_plain: 'Use plain-language brief style while preserving precision and policy relevance.',
  };

  return [
    `${sectionHeading}`,
    `${clientName} should position ${capabilityName || 'the program'} as a high-confidence priority for FY${fiscalYear || 'current cycle'}.`,
    `Context anchors: ${contextLine}`,
    `Recommended framing: define concrete impact, responsible stakeholders, likely objections, and leverage points tied to this section's purpose.`,
    `Tone directive: ${toneGuidance[tone]}`,
    steerNote ? `Steer note: ${steerNote}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

function formatSavedAt(value: string | null): string {
  if (!value) return '';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function asTone(value: unknown): ToneValue {
  if (typeof value !== 'string') return 'professional_neutral';
  if (TONE_OPTIONS.some((option) => option.value === value)) return value as ToneValue;
  return 'professional_neutral';
}

export function WhitePaperEditorPage() {
  const api = useApi();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { message } = AntApp.useApp();
  const { id: routeStrategyId, instanceId } = useParams<{ id?: string; instanceId: string }>();

  const instanceQuery = useQuery<WorkflowInstance>({
    queryKey: ['workflow-instance', instanceId],
    queryFn: async () => (await api.get<WorkflowInstance>(`/api/workflows/instances/${instanceId}`)).data,
    enabled: Boolean(instanceId),
    staleTime: 15_000,
  });

  const strategyId = routeStrategyId || instanceQuery.data?.strategyId || undefined;

  const strategyQuery = useQuery<StrategyLite>({
    queryKey: ['strategy', strategyId],
    queryFn: async () => (await api.get<StrategyLite>(`/api/strategies/${strategyId}`)).data,
    enabled: Boolean(strategyId),
    staleTime: 30_000,
  });

  const [title, setTitle] = useState('');
  const [sections, setSections] = useState<WhitePaperSection[]>([]);
  const [steerNote, setSteerNote] = useState('');
  const [tone, setTone] = useState<ToneValue>('professional_neutral');
  const [activeSectionId, setActiveSectionId] = useState('sec-1');
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [showClio, setShowClio] = useState(true);
  const [selectedContextIds, setSelectedContextIds] = useState<string[]>([]);
  const [generatingSectionId, setGeneratingSectionId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const contextPool = useMemo<WhitePaperContextItem[]>(() => {
    const instance = instanceQuery.data;
    if (!instance) return [];

    const formData = (instance.formData ?? {}) as Record<string, unknown>;
    const pool = new Map<string, WhitePaperContextItem>();

    const pushItem = (item: WhitePaperContextItem) => {
      if (!pool.has(item.id)) pool.set(item.id, item);
    };

    safeItems(formData.research_sources).slice(0, 8).forEach((row, idx) => {
      const title = typeof row.title === 'string' ? row.title : typeof row.name === 'string' ? row.name : `Research ${idx + 1}`;
      const tag = typeof row.sourceType === 'string' ? row.sourceType : typeof row.source === 'string' ? row.source : undefined;
      pushItem({ id: `research-${idx}-${title}`, title, kind: 'Research', tag });
    });

    safeItems(formData.intel_digest).slice(0, 8).forEach((row, idx) => {
      const title = typeof row.title === 'string' ? row.title : `Intel ${idx + 1}`;
      const tag = typeof row.category === 'string' ? row.category : undefined;
      pushItem({ id: `intel-${idx}-${title}`, title, kind: 'Intel', tag });
    });

    (strategyQuery.data?.targets ?? []).slice(0, 8).forEach((target, idx) => {
      if (!target.memberName) return;
      pushItem({
        id: `target-${target.id || idx}`,
        title: target.memberName,
        kind: 'Meeting',
        tag: target.committee || undefined,
      });
    });

    if (pool.size === 0) {
      const fallbackClient = instance.client?.name ?? 'Client context';
      pushItem({ id: 'fallback-client', title: fallbackClient, kind: 'Client', tag: 'Baseline' });
      pushItem({ id: 'fallback-template', title: instance.template?.name ?? 'White Paper', kind: 'Template', tag: 'Workflow' });
    }

    return Array.from(pool.values()).slice(0, 12);
  }, [instanceQuery.data, strategyQuery.data]);

  const selectedContext = useMemo(
    () => contextPool.filter((item) => selectedContextIds.includes(item.id)),
    [contextPool, selectedContextIds],
  );

  useEffect(() => {
    const valid = new Set(contextPool.map((item) => item.id));
    setSelectedContextIds((prev) => prev.filter((id) => valid.has(id)));
  }, [contextPool]);

  useEffect(() => {
    const instance = instanceQuery.data;
    if (!instance) return;
    const formData = (instance.formData ?? {}) as Record<string, unknown>;
    const generated = typeof formData.generated_document === 'string' ? formData.generated_document : '';
    const hydratedSections = normalizeSections(formData.whitepaper_sections, generated);

    const initialContextIds = parseContextIds(formData.whitepaper_context_items);
    const availableIds = new Set(contextPool.map((item) => item.id));

    setTitle(instance.title ?? instance.template?.name ?? 'White Paper');
    setSections(hydratedSections);
    setActiveSectionId(hydratedSections[0]?.id ?? 'sec-1');
    setSteerNote(typeof formData.whitepaper_steer_note === 'string' ? formData.whitepaper_steer_note : '');
    setTone(asTone(formData.whitepaper_tone));
    setSelectedContextIds(initialContextIds.filter((id) => availableIds.has(id)));
    setLastSavedAt(instance.updatedAt ?? null);
    setShowClio(typeof formData.whitepaper_show_clio === 'boolean' ? formData.whitepaper_show_clio : true);
    setSaveState('saved');
    setHydrated(true);
  }, [contextPool, instanceQuery.data]);

  const updateInstance = useMutation({
    mutationFn: async (payload: {
      title: string;
      sections: WhitePaperSection[];
      steerNote: string;
      tone: ToneValue;
      contextIds: string[];
      showClio: boolean;
    }) => {
      const instance = instanceQuery.data;
      if (!instance) throw new Error('Workflow instance unavailable');
      const baseFormData = (instance.formData ?? {}) as Record<string, unknown>;
      const formData = {
        ...baseFormData,
        generated_document: composeDocument(payload.sections),
        whitepaper_sections: payload.sections,
        whitepaper_steer_note: payload.steerNote,
        whitepaper_tone: payload.tone,
        whitepaper_context_items: payload.contextIds,
        whitepaper_show_clio: payload.showClio,
      };
      return (
        await api.patch<WorkflowInstance>(`/api/workflows/instances/${instance.id}`, {
          title: payload.title,
          formData,
        })
      ).data;
    },
    onSuccess: (updated) => {
      setSaveState('saved');
      setLastSavedAt(new Date().toISOString());
      qc.setQueryData(['workflow-instance', updated.id], updated);
      qc.invalidateQueries({ queryKey: ['workflow-instances'] });
      if (updated.strategyId) qc.invalidateQueries({ queryKey: ['strategy', updated.strategyId] });
    },
    onError: (err) => {
      setSaveState('error');
      message.error(err instanceof Error ? err.message : 'Save failed');
    },
  });

  const markDirty = () => {
    setSaveState((prev) => (prev === 'saving' ? prev : 'dirty'));
  };

  const saveNow = () => {
    if (!instanceQuery.data) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaveState('saving');
    updateInstance.mutate({
      title,
      sections,
      steerNote,
      tone,
      contextIds: selectedContextIds,
      showClio,
    });
  };

  useEffect(() => {
    if (!hydrated || !instanceQuery.data) return;
    if (saveState !== 'dirty') return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveNow();
    }, 900);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, saveState, title, sections, steerNote, tone, selectedContextIds, showClio]);

  const generateDoc = useMutation({
    mutationFn: async () => {
      const id = instanceQuery.data?.id;
      if (!id) throw new Error('Workflow instance unavailable');
      return (await api.post<{ generated_document: string }>(`/api/workflows/instances/${id}/generate-document`)).data;
    },
    onSuccess: (result) => {
      const freshSections = defaultSections(result.generated_document ?? '');
      setSections(freshSections);
      setActiveSectionId(freshSections[0]?.id ?? 'sec-1');
      setGeneratingSectionId(null);
      markDirty();
      message.success('White paper draft regenerated');
    },
    onError: (err) => {
      setGeneratingSectionId(null);
      message.error(err instanceof Error ? err.message : 'Generate failed');
    },
  });

  const markCompleteMutation = useMutation({
    mutationFn: async () => {
      const id = instanceQuery.data?.id;
      if (!id) throw new Error('Workflow instance unavailable');
      return (await api.patch<WorkflowInstance>(`/api/workflows/instances/${id}`, { status: 'review' })).data;
    },
    onSuccess: (updated) => {
      qc.setQueryData(['workflow-instance', updated.id], updated);
      qc.invalidateQueries({ queryKey: ['workflow-instances'] });
      if (updated.strategyId) qc.invalidateQueries({ queryKey: ['strategy', updated.strategyId] });
      message.success('Draft marked complete');
    },
    onError: (err) => message.error(err instanceof Error ? err.message : 'Unable to mark complete'),
  });

  const totalWords = useMemo(
    () =>
      sections.reduce((sum, section) => {
        const count = section.body.trim().split(/\s+/).filter(Boolean).length;
        return sum + count;
      }, 0),
    [sections],
  );

  const completedSections = useMemo(
    () => sections.filter((section) => section.body.trim().length > 40).length,
    [sections],
  );

  const readingMinutes = Math.max(1, Math.ceil(totalWords / 200));

  const recommendations = useMemo(() => {
    const list: string[] = [];
    if (selectedContext.length === 0) {
      list.push('Select at least 2 context items before drafting to increase specificity.');
    } else {
      list.push(`Use ${selectedContext.length} selected context item${selectedContext.length === 1 ? '' : 's'} to anchor claims.`);
    }

    if (steerNote.trim().length < 18) {
      list.push('Add a tighter steer note with audience + length constraints for better draft control.');
    }

    if (tone === 'technical_dense') {
      list.push('Include explicit metrics, assumptions, and validation points in each section.');
    } else if (tone === 'editorial_narrative') {
      list.push('Lead each section with operating risk, then close with the ask and leverage path.');
    } else if (tone === 'conversational_plain') {
      list.push('Keep paragraphs short and remove acronyms unless required by committee context.');
    } else {
      list.push('Use short declarative sentences and keep each paragraph decision-oriented.');
    }

    const emptySections = sections.filter((section) => section.body.trim().length === 0).length;
    if (emptySections > 0) {
      list.push(`${emptySections} section${emptySections === 1 ? '' : 's'} still blank, run Draft with Clio on each before final pass.`);
    }

    return list.slice(0, 4);
  }, [sections, selectedContext.length, steerNote, tone]);

  const clientName = instanceQuery.data?.client?.name ?? 'Client';
  const capabilityName = strategyQuery.data?.capability?.name ?? 'Capability';
  const fiscalYear = strategyQuery.data?.fiscalYear?.replace(/^FY/i, '') ?? '';

  const updateHeading = (id: string, heading: string) => {
    setSections((prev) => prev.map((section) => (section.id === id ? { ...section, heading } : section)));
    markDirty();
  };

  const updateBody = (id: string, body: string) => {
    setSections((prev) => prev.map((section) => (section.id === id ? { ...section, body } : section)));
    markDirty();
  };

  const addSection = () => {
    const nextId = `sec-${Date.now()}`;
    const next = [...sections, { id: nextId, heading: 'New section', body: '' }];
    setSections(next);
    setActiveSectionId(nextId);
    markDirty();
  };

  const generateOneSection = (sectionId: string) => {
    const section = sections.find((item) => item.id === sectionId);
    if (!section) return;
    setGeneratingSectionId(sectionId);
    const drafted = inferSectionDraft({
      sectionHeading: section.heading,
      clientName,
      capabilityName,
      fiscalYear,
      selectedContext,
      steerNote,
      tone,
    });
    setSections((prev) => prev.map((item) => (item.id === sectionId ? { ...item, body: drafted } : item)));
    setGeneratingSectionId(null);
    markDirty();
  };

  const clearSection = (sectionId: string) => {
    setSections((prev) => prev.map((item) => (item.id === sectionId ? { ...item, body: '' } : item)));
    markDirty();
  };

  const toggleContext = (id: string) => {
    setSelectedContextIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
    markDirty();
  };

  const handleBack = () => {
    if (strategyId) {
      navigate(`/workspace/strategy/${strategyId}`);
      return;
    }
    navigate('/workspace/workflows');
  };

  const exportDocument = () => {
    const docText = composeDocument(sections);
    const blob = new Blob([docText], { type: 'application/msword;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const sanitized = (title || 'white-paper').replace(/[^a-z0-9-_]+/gi, '-').replace(/-+/g, '-').toLowerCase();
    anchor.href = url;
    anchor.download = `${sanitized || 'white-paper'}.doc`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  };

  if (instanceQuery.isLoading) {
    return (
      <div style={{ padding: 24 }}>
        <Skeleton active paragraph={{ rows: 8 }} />
      </div>
    );
  }

  if (!instanceQuery.data) {
    return (
      <div style={{ padding: 24 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={handleBack} style={{ marginBottom: 12 }}>
          Back
        </Button>
        <Empty description="White paper workflow not found" />
      </div>
    );
  }

  return (
    <section className="wp-shell">
      <header className="wp-topbar">
        <button className="back" type="button" onClick={handleBack}>
          <ArrowLeftOutlined />
          Back to strategy
        </button>

        <span className="crumb">
          Strategy / <b>{clientName}</b> · {capabilityName} {fiscalYear ? `· FY${fiscalYear}` : ''}
        </span>

        <input
          className="title-input"
          value={title}
          onChange={(event) => {
            setTitle(event.target.value);
            markDirty();
          }}
          aria-label="White paper title"
        />

        <span className="saved">
          {saveState === 'saving' && 'Saving…'}
          {saveState === 'saved' && `Saved${formatSavedAt(lastSavedAt) ? ` · ${formatSavedAt(lastSavedAt)}` : ''}`}
          {saveState === 'dirty' && 'Unsaved changes'}
          {saveState === 'error' && 'Save failed'}
        </span>

        <div className="actions">
          <Button size="small" onClick={() => {
            setShowClio((prev) => !prev);
            markDirty();
          }}>
            {showClio ? 'Hide Clio' : 'Show Clio'}
          </Button>
          <Button size="small" icon={<DownloadOutlined />} onClick={exportDocument}>
            Export DOCX
          </Button>
          <Button size="small" onClick={() => markCompleteMutation.mutate()} loading={markCompleteMutation.isPending}>
            Mark draft complete
          </Button>
          <Button size="small" icon={<RedoOutlined />} loading={generateDoc.isPending} onClick={() => generateDoc.mutate()}>
            Draft full paper
          </Button>
          <Button size="small" type="primary" icon={<SaveOutlined />} loading={updateInstance.isPending} onClick={saveNow}>
            Save
          </Button>
        </div>
      </header>

      <div className="wp-body" style={!showClio ? { gridTemplateColumns: '240px minmax(0, 1fr)' } : undefined}>
        <aside className="wp-sidebar">
          <h4>Outline</h4>
          <div className="wp-outline">
            {sections.map((section) => (
              <button
                key={section.id}
                type="button"
                className={`wp-outline-item${activeSectionId === section.id ? ' active' : ''}${
                  section.body.trim().length > 0 ? ' has-content' : ''
                }`}
                onClick={() => {
                  setActiveSectionId(section.id);
                  const el = document.getElementById(`wp-sec-${section.id}`);
                  if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' });
                }}
              >
                <span className="dot" />
                <span>{section.heading}</span>
              </button>
            ))}
          </div>

          <div className="wp-stats">
            <div className="row">
              <span>Sections done</span>
              <b>
                {completedSections}/{sections.length}
              </b>
            </div>
            <div className="row">
              <span>Words</span>
              <b>{totalWords.toLocaleString()}</b>
            </div>
            <div className="row">
              <span>Reading time</span>
              <b>~{readingMinutes} min</b>
            </div>
          </div>

          <Button block size="small" style={{ marginTop: 14 }} icon={<PlusOutlined />} onClick={addSection}>
            Add section
          </Button>
          <Button block size="small" type="primary" style={{ marginTop: 8 }} loading={generateDoc.isPending} onClick={() => generateDoc.mutate()}>
            Draft full paper
          </Button>
        </aside>

        <div className="wp-paper-wrap">
          <div className="wp-paper">
            <Input
              className="wp-paper-h1"
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
                markDirty();
              }}
            />

            <div className="wp-paper-meta">
              <span>{clientName}</span>
              <span>{capabilityName}</span>
              {fiscalYear ? <span>FY{fiscalYear}</span> : null}
              <span>Draft</span>
            </div>

            {sections.map((section) => (
              <div key={section.id} id={`wp-sec-${section.id}`} className="wp-section">
                <Input
                  className="wp-section-h"
                  value={section.heading}
                  onFocus={() => setActiveSectionId(section.id)}
                  onChange={(event) => updateHeading(section.id, event.target.value)}
                />

                <Input.TextArea
                  className="wp-section-body"
                  autoSize={{ minRows: 8 }}
                  value={section.body}
                  onFocus={() => setActiveSectionId(section.id)}
                  onChange={(event) => updateBody(section.id, event.target.value)}
                  placeholder={`Write or draft "${section.heading.toLowerCase()}"`}
                />

                <div className="wp-section-actions">
                  <button
                    type="button"
                    className="wp-section-action clio"
                    onClick={() => generateOneSection(section.id)}
                    disabled={generatingSectionId === section.id}
                  >
                    {generatingSectionId === section.id ? 'Drafting…' : 'Draft with Clio'}
                  </button>
                  <button
                    type="button"
                    className="wp-section-action"
                    onClick={() => generateOneSection(section.id)}
                    disabled={generatingSectionId === section.id}
                  >
                    Rewrite
                  </button>
                  <button type="button" className="wp-section-action" onClick={() => clearSection(section.id)}>
                    Clear
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {showClio && (
          <aside className="wp-clio">
            <div className="wp-clio-head">
              <BulbOutlined />
              <div>
                <div className="title">Draft with Clio</div>
                <div className="sub">Pick context, steer voice, and generate.</div>
              </div>
            </div>

            <div className="wp-clio-section">
              <h5>Context</h5>
              <div className="wp-ctx-list">
                {contextPool.map((item) => {
                  const on = selectedContextIds.includes(item.id);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={`wp-ctx-item${on ? ' on' : ''}`}
                      onClick={() => toggleContext(item.id)}
                    >
                      <span className="cb">{on ? '✓' : ''}</span>
                      <span className="txt">
                        <span className="t">{item.title}</span>
                        <span className="s">
                          {item.kind}
                          {item.tag ? ` · ${item.tag}` : ''}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="wp-clio-section">
              <h5>Steer the voice</h5>
              <Input.TextArea
                className="wp-clio-note"
                autoSize={{ minRows: 4 }}
                value={steerNote}
                onChange={(event) => {
                  setSteerNote(event.target.value);
                  markDirty();
                }}
                placeholder="Example: lead with pilot outcomes, keep under 2 pages, optimize for HASC staff context."
              />
            </div>

            <div className="wp-clio-section">
              <h5>Tone</h5>
              <select
                className="sw-select"
                value={tone}
                onChange={(event) => {
                  setTone(asTone(event.target.value));
                  markDirty();
                }}
              >
                {TONE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="wp-clio-section">
              <h5>Recommendations</h5>
              <ul className="wp-reco-list">
                {recommendations.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>

            <div className="wp-clio-cta">
              <Button type="primary" block loading={generateDoc.isPending} onClick={() => generateDoc.mutate()}>
                Draft full paper
              </Button>
            </div>

            <Typography.Text type="secondary" style={{ fontSize: 11 }}>
              Clio drafts from selected context and your steer note. Review and edit before filing.
            </Typography.Text>
          </aside>
        )}
      </div>
    </section>
  );
}
