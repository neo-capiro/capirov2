import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App as AntApp, Button, Empty, Input, Skeleton, Typography } from 'antd';
import { ArrowLeftOutlined, BulbOutlined, RedoOutlined, SaveOutlined } from '@ant-design/icons';
import { useApi } from '../../lib/use-api.js';
import type { WorkflowInstance } from './workflowTypes.js';

type SaveState = 'saved' | 'saving' | 'dirty' | 'error';

interface WhitePaperSection {
  id: string;
  heading: string;
  body: string;
}

const DEFAULT_HEADINGS = [
  'Executive Summary',
  'Problem Statement',
  'Program Overview',
  'The Ask',
  'Measurable Outcomes',
  'Team & Qualifications',
] as const;

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

export function WhitePaperEditorPage() {
  const api = useApi();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { message } = AntApp.useApp();
  const { id: strategyId, instanceId } = useParams<{ id?: string; instanceId: string }>();

  const instanceQuery = useQuery<WorkflowInstance>({
    queryKey: ['workflow-instance', instanceId],
    queryFn: async () => (await api.get<WorkflowInstance>(`/api/workflows/instances/${instanceId}`)).data,
    enabled: Boolean(instanceId),
    staleTime: 15_000,
  });

  const [title, setTitle] = useState('');
  const [sections, setSections] = useState<WhitePaperSection[]>([]);
  const [steerNote, setSteerNote] = useState('');
  const [activeSectionId, setActiveSectionId] = useState('sec-1');
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const instance = instanceQuery.data;
    if (!instance) return;
    const formData = (instance.formData ?? {}) as Record<string, unknown>;
    const generated = typeof formData.generated_document === 'string' ? formData.generated_document : '';
    const hydratedSections = normalizeSections(formData.whitepaper_sections, generated);
    setTitle(instance.title ?? instance.template?.name ?? 'White Paper');
    setSections(hydratedSections);
    setActiveSectionId(hydratedSections[0]?.id ?? 'sec-1');
    setSteerNote(typeof formData.whitepaper_steer_note === 'string' ? formData.whitepaper_steer_note : '');
    setSaveState('saved');
  }, [instanceQuery.data]);

  const updateInstance = useMutation({
    mutationFn: async (payload: { title: string; sections: WhitePaperSection[]; steerNote: string }) => {
      const instance = instanceQuery.data;
      if (!instance) throw new Error('Workflow instance unavailable');
      const baseFormData = (instance.formData ?? {}) as Record<string, unknown>;
      const formData = {
        ...baseFormData,
        generated_document: composeDocument(payload.sections),
        whitepaper_sections: payload.sections,
        whitepaper_steer_note: payload.steerNote,
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
      qc.setQueryData(['workflow-instance', updated.id], updated);
      qc.invalidateQueries({ queryKey: ['workflow-instances'] });
      if (updated.strategyId) qc.invalidateQueries({ queryKey: ['strategy', updated.strategyId] });
    },
    onError: (err) => {
      setSaveState('error');
      message.error(err instanceof Error ? err.message : 'Save failed');
    },
  });

  const scheduleSave = () => {
    setSaveState('dirty');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      setSaveState('saving');
      updateInstance.mutate({ title, sections, steerNote });
    }, 900);
  };

  useEffect(() => {
    if (!instanceQuery.data) return;
    if (saveState === 'saved') return;
    if (saveState === 'error') return;
    scheduleSave();
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, sections, steerNote]);

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
      setSaveState('dirty');
      message.success('White paper draft regenerated');
    },
    onError: (err) => message.error(err instanceof Error ? err.message : 'Generate failed'),
  });

  const activeSection = useMemo(
    () => sections.find((section) => section.id === activeSectionId) ?? sections[0] ?? null,
    [activeSectionId, sections],
  );

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

  const updateHeading = (id: string, heading: string) => {
    setSections((prev) => prev.map((section) => (section.id === id ? { ...section, heading } : section)));
  };

  const updateBody = (id: string, body: string) => {
    setSections((prev) => prev.map((section) => (section.id === id ? { ...section, body } : section)));
  };

  const handleBack = () => {
    if (strategyId) {
      navigate(`/workspace/strategy/${strategyId}`);
      return;
    }
    navigate('/workspace/workflows');
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
          Workspace / <b>{instanceQuery.data.client?.name ?? 'Client'}</b>
        </span>
        <input
          className="title-input"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          aria-label="White paper title"
        />
        <span className="saved">
          {saveState === 'saving' && <>Saving…</>}
          {saveState === 'saved' && <>Saved</>}
          {saveState === 'dirty' && <>Unsaved changes</>}
          {saveState === 'error' && <>Save failed</>}
        </span>
        <div className="actions">
          <Button size="small" icon={<RedoOutlined />} loading={generateDoc.isPending} onClick={() => generateDoc.mutate()}>
            Regenerate
          </Button>
          <Button
            size="small"
            type="primary"
            icon={<SaveOutlined />}
            loading={updateInstance.isPending}
            onClick={() => {
              setSaveState('saving');
              updateInstance.mutate({ title, sections, steerNote });
            }}
          >
            Save
          </Button>
        </div>
      </header>

      <div className="wp-body">
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
                onClick={() => setActiveSectionId(section.id)}
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
          </div>
        </aside>

        <div className="wp-paper-wrap">
          <div className="wp-paper">
            {activeSection ? (
              <>
                <Input
                  className="wp-paper-h1"
                  value={activeSection.heading}
                  onChange={(event) => updateHeading(activeSection.id, event.target.value)}
                />
                <Input.TextArea
                  className="wp-section-body"
                  autoSize={{ minRows: 22 }}
                  value={activeSection.body}
                  onChange={(event) => updateBody(activeSection.id, event.target.value)}
                  placeholder="Draft or edit this section"
                />
              </>
            ) : (
              <Empty description="No white paper sections" />
            )}
          </div>
        </div>

        <aside className="wp-clio">
          <div className="wp-clio-head">
            <BulbOutlined />
            <div>
              <div className="title">Draft with Clio</div>
              <div className="sub">Steer tone and regenerate to refresh copy.</div>
            </div>
          </div>
          <div className="wp-clio-section">
            <h5>Steer note</h5>
            <Input.TextArea
              className="wp-clio-note"
              autoSize={{ minRows: 4 }}
              value={steerNote}
              onChange={(event) => setSteerNote(event.target.value)}
              placeholder="Example: tighten for HASC staff, keep it under 2 pages, lead with pilot outcomes."
            />
          </div>
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>
            Use Regenerate to draft from current workflow context and this steer note.
          </Typography.Text>
        </aside>
      </div>
    </section>
  );
}
