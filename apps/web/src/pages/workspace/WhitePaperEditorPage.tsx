import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  App as AntApp,
  Button,
  Dropdown,
  Empty,
  Input,
  Modal,
  Skeleton,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import {
  ArrowLeftOutlined,
  BulbOutlined,
  CheckCircleOutlined,
  CloudUploadOutlined,
  DownloadOutlined,
  PlusOutlined,
  RedoOutlined,
  SafetyCertificateOutlined,
  SaveOutlined,
  SearchOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { useApi } from '../../lib/use-api.js';
import { setActiveWhitePaper } from '../../components/chat/chat-store.js';
import type { WorkflowInstance } from './workflowTypes.js';

type SaveState = 'saved' | 'saving' | 'dirty' | 'error';

type ToneValue =
  | 'professional_neutral'
  | 'editorial_narrative'
  | 'technical_dense'
  | 'conversational_plain';

type SectionStatus = 'empty' | 'drafted' | 'reviewed';

interface WhitePaperSection {
  id: string;
  heading: string;
  body: string;
  status?: SectionStatus;
}

// MUST stay in sync with WhitePaperContextKind in apps/api/.../whitepaper.types.ts
// and the CONTEXT_KINDS allow-list in whitepaper.dto.ts.
type ContextKind =
  | 'client_profile'
  | 'person'
  | 'facility'
  | 'capability'
  | 'program_element'
  | 'meeting'
  | 'email_thread'
  | 'prior_submission'
  | 'submission_history'
  | 'tracked_bill'
  | 'intel_change'
  | 'client_brief'
  | 'recommendation'
  | 'intel'
  | 'research_report'
  | 'note'
  | 'research'
  | 'lda'
  | 'contract'
  | 'document'
  | 'freeform_note';

type ContextCategory =
  | 'profile'
  | 'program'
  | 'engagement'
  | 'intel'
  | 'research'
  | 'federal'
  | 'documents'
  | 'custom';

interface WhitePaperContextItem {
  id: string;
  kind: ContextKind;
  title: string;
  content: string;
  refId?: string;
  tag?: string;
  category?: ContextCategory;
}

interface WhitePaperVariant {
  slug: string;
  name: string;
  description: string;
  defaultTone: ToneValue;
  wordBudget: number;
  sections: Array<{ heading: string; purpose: string }>;
}

interface StrategyLite {
  id: string;
  fiscalYear: string | null;
  capability?: { name: string | null } | null;
  targets?: Array<{ id: string; memberName?: string | null; committee?: string | null }>;
}

interface LintResult {
  issues: string[];
  wordCount: number;
  wordBudget: number;
}

const TONE_OPTIONS: Array<{ value: ToneValue; label: string }> = [
  { value: 'professional_neutral', label: 'Professional · neutral' },
  { value: 'editorial_narrative', label: 'Editorial · narrative' },
  { value: 'technical_dense', label: 'Technical · dense' },
  { value: 'conversational_plain', label: 'Conversational · plain' },
];

const CONTEXT_KIND_LABELS: Record<ContextKind, string> = {
  client_profile: 'Profile',
  person: 'Contact',
  facility: 'Facility',
  capability: 'Capability',
  program_element: 'PE',
  meeting: 'Meeting',
  email_thread: 'Email',
  prior_submission: 'Prior doc',
  submission_history: 'Outcome',
  tracked_bill: 'Bill',
  intel_change: 'Intel',
  client_brief: 'Brief',
  recommendation: 'Rec',
  intel: 'Intel',
  research_report: 'Research',
  note: 'Note',
  research: 'Research',
  lda: 'LDA',
  contract: 'Contract',
  document: 'Document',
  freeform_note: 'Note',
};

const CONTEXT_KIND_CATEGORY: Record<ContextKind, ContextCategory> = {
  client_profile: 'profile',
  person: 'profile',
  facility: 'profile',
  capability: 'program',
  program_element: 'program',
  meeting: 'engagement',
  email_thread: 'engagement',
  prior_submission: 'engagement',
  submission_history: 'engagement',
  tracked_bill: 'intel',
  intel_change: 'intel',
  client_brief: 'intel',
  recommendation: 'intel',
  intel: 'intel',
  research_report: 'research',
  note: 'research',
  research: 'research',
  lda: 'federal',
  contract: 'federal',
  document: 'documents',
  freeform_note: 'custom',
};

const CONTEXT_CATEGORY_LABELS: Record<ContextCategory, string> = {
  profile: 'Client profile',
  program: 'Program',
  engagement: 'Engagement',
  intel: 'Intelligence',
  research: 'Research',
  federal: 'Federal data',
  documents: 'Documents',
  custom: 'Custom notes',
};

const CONTEXT_CATEGORY_ORDER: ContextCategory[] = [
  'profile',
  'program',
  'engagement',
  'intel',
  'research',
  'federal',
  'documents',
  'custom',
];

function itemCategory(item: WhitePaperContextItem): ContextCategory {
  return item.category ?? CONTEXT_KIND_CATEGORY[item.kind] ?? 'custom';
}

/** Guided refinement presets exposed via the per-section "Improve" menu. */
const IMPROVE_PRESETS: Array<{ key: string; label: string; directive: string }> = [
  {
    key: 'tighten',
    label: 'Tighten & shorten',
    directive: 'Tighten the prose and cut redundancy without losing substance.',
  },
  {
    key: 'metrics',
    label: 'Add data & metrics',
    directive:
      'Strengthen with concrete data, numbers, and metrics drawn only from the provided context.',
  },
  {
    key: 'district',
    label: 'Strengthen district nexus',
    directive: 'Make the district/state economic and constituent impact explicit and concrete.',
  },
  {
    key: 'ask',
    label: 'Sharpen the ask',
    directive:
      'Make the specific request (account, line, dollar amount, or action) explicit and unambiguous.',
  },
  {
    key: 'plain',
    label: 'Plainer language',
    directive:
      'Rewrite in clearer, plainer language for a congressional staffer while keeping precision.',
  },
];

/**
 * Client-side mirror of the server's WHITEPAPER_VARIANTS. Used as a resilient
 * fallback so the format picker, Start guide, and word budget never render an
 * inert empty state when GET /whitepaper/variants is slow, cached empty, or 401s.
 */
const FALLBACK_VARIANTS: WhitePaperVariant[] = [
  {
    slug: 'congressional_program',
    name: 'Congressional Program White Paper',
    description:
      'Default 1-2 page program white paper for congressional authorization/appropriations submission.',
    defaultTone: 'professional_neutral',
    wordBudget: 600,
    sections: [
      {
        heading: 'Problem Statement',
        purpose: 'The specific capability gap or national security need being addressed.',
      },
      { heading: 'Solution', purpose: 'What this program does and how it solves the problem.' },
      {
        heading: 'Current Status',
        purpose: 'Development stage, TRL level, milestones, contracts or endorsements.',
      },
      {
        heading: 'Funding History and Request',
        purpose: 'FY enacted / requested amounts versus the budget request.',
      },
      {
        heading: 'National Security Impact',
        purpose: 'Why this capability matters strategically.',
      },
      {
        heading: 'Economic and District Impact',
        purpose: 'Jobs, districts supported, the Member’s state/district.',
      },
      { heading: 'The Ask', purpose: 'One sentence stating exactly what is being requested.' },
    ],
  },
  {
    slug: 'appropriations_brief',
    name: 'Appropriations Request Brief',
    description: 'Tighter, numbers-forward brief optimized for appropriations staff.',
    defaultTone: 'technical_dense',
    wordBudget: 450,
    sections: [
      { heading: 'The Ask', purpose: 'Exact account, line, and dollar amount requested.' },
      {
        heading: 'Funding Context',
        purpose: 'FY enacted/requested vs the President’s Budget Request; deltas and rationale.',
      },
      {
        heading: 'Capability Gap',
        purpose: 'The operational shortfall this funding closes, with evidence.',
      },
      {
        heading: 'District/State Impact',
        purpose: 'Jobs, facilities, and economic activity tied to the Member.',
      },
      {
        heading: 'Accountability and Oversight',
        purpose: 'How funds will be tracked, milestones, and reporting.',
      },
    ],
  },
  {
    slug: 'policy_position',
    name: 'Issue / Policy Position Paper',
    description: 'Narrative position paper for a policy issue or legislative proposal.',
    defaultTone: 'editorial_narrative',
    wordBudget: 800,
    sections: [
      {
        heading: 'Executive Summary',
        purpose: 'The position and the recommended action in brief.',
      },
      { heading: 'Background', purpose: 'Relevant history and current state of the issue.' },
      { heading: 'Policy Problem', purpose: 'The specific problem and its stakes.' },
      { heading: 'Recommended Action', purpose: 'The concrete legislative or policy ask.' },
      {
        heading: 'Stakeholders and Support',
        purpose: 'Who benefits, who supports, and existing momentum.',
      },
      { heading: 'Call to Action', purpose: 'What you want the Member to do next.' },
    ],
  },
];

function normalizeSections(raw: unknown): WhitePaperSection[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item, index) => {
      const row = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
      const heading =
        typeof row.heading === 'string' && row.heading.trim()
          ? row.heading.trim()
          : `Section ${index + 1}`;
      const body = typeof row.body === 'string' ? row.body : '';
      const id = typeof row.id === 'string' && row.id.trim() ? row.id.trim() : `sec-${index + 1}`;
      const status =
        row.status === 'drafted' || row.status === 'reviewed' || row.status === 'empty'
          ? (row.status as SectionStatus)
          : body.trim().length > 0
            ? 'drafted'
            : 'empty';
      return { id, heading, body, status };
    })
    .filter((section) => section.heading.length > 0);
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

function parseContextItems(value: unknown): WhitePaperContextItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map((row) => ({
      id: String(row.id ?? ''),
      kind: (typeof row.kind === 'string' ? row.kind : 'freeform_note') as ContextKind,
      title: typeof row.title === 'string' ? row.title : 'Context',
      content: typeof row.content === 'string' ? row.content : '',
      refId: typeof row.refId === 'string' ? row.refId : undefined,
      tag: typeof row.tag === 'string' ? row.tag : undefined,
    }))
    .filter((item) => item.id.length > 0);
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
  const { message, modal } = AntApp.useApp();
  const { id: routeStrategyId, instanceId } = useParams<{ id?: string; instanceId: string }>();

  const instanceQuery = useQuery<WorkflowInstance>({
    queryKey: ['workflow-instance', instanceId],
    queryFn: async () =>
      (await api.get<WorkflowInstance>(`/api/workflows/instances/${instanceId}`)).data,
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

  const variantsQuery = useQuery<WhitePaperVariant[]>({
    queryKey: ['whitepaper-variants'],
    queryFn: async () =>
      (await api.get<WhitePaperVariant[]>('/api/workflows/whitepaper/variants')).data,
    staleTime: 5 * 60_000,
  });

  const candidatesQuery = useQuery<WhitePaperContextItem[]>({
    queryKey: ['whitepaper-context-candidates', instanceId],
    queryFn: async () =>
      (
        await api.get<WhitePaperContextItem[]>(
          `/api/workflows/instances/${instanceId}/context-candidates`,
        )
      ).data,
    enabled: Boolean(instanceId),
    staleTime: 30_000,
  });

  const [title, setTitle] = useState('');
  const [sections, setSections] = useState<WhitePaperSection[]>([]);
  const [steerNote, setSteerNote] = useState('');
  const [tone, setTone] = useState<ToneValue>('professional_neutral');
  const [variantSlug, setVariantSlug] = useState<string>('congressional_program');
  const [activeSectionId, setActiveSectionId] = useState('sec-1');
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [showClio, setShowClio] = useState(true);
  const [contextItems, setContextItems] = useState<WhitePaperContextItem[]>([]);
  const [generatingSectionId, setGeneratingSectionId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [freeformNote, setFreeformNote] = useState('');
  const [ctxSearch, setCtxSearch] = useState('');
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [lint, setLint] = useState<LintResult | null>(null);
  const [showStartGuide, setShowStartGuide] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const sectionsRef = useRef<WhitePaperSection[]>([]);
  sectionsRef.current = sections;

  // Resilient variant list: prefer the live fetch, fall back to the bundled
  // constant so the format picker / Start guide / budget never dead-end.
  const variants = useMemo<WhitePaperVariant[]>(
    () =>
      variantsQuery.data && variantsQuery.data.length ? variantsQuery.data : FALLBACK_VARIANTS,
    [variantsQuery.data],
  );
  const activeVariant = useMemo(
    () => variants.find((v) => v.slug === variantSlug) ?? variants[0],
    [variants, variantSlug],
  );

  // ─── Hydrate from instance formData ─────────────────────────────────────
  useEffect(() => {
    const instance = instanceQuery.data;
    if (!instance) return;
    const formData = (instance.formData ?? {}) as Record<string, unknown>;

    const storedSections = normalizeSections(formData.whitepaper_sections);
    const hasContent = storedSections.some((s) => s.body.trim().length > 0);

    setTitle(instance.title ?? instance.template?.name ?? 'White Paper');
    setSections(storedSections);
    setActiveSectionId(storedSections[0]?.id ?? 'sec-1');
    setSteerNote(
      typeof formData.whitepaper_steer_note === 'string' ? formData.whitepaper_steer_note : '',
    );
    setTone(asTone(formData.whitepaper_tone));
    setVariantSlug(
      typeof formData.whitepaper_variant === 'string'
        ? formData.whitepaper_variant
        : 'congressional_program',
    );
    setContextItems(parseContextItems(formData.whitepaper_context_items));
    setLastSavedAt(instance.updatedAt ?? null);
    setShowClio(
      typeof formData.whitepaper_show_clio === 'boolean' ? formData.whitepaper_show_clio : true,
    );
    setSaveState('saved');
    setHydrated(true);
    // First-time experience: no sections yet → offer the guided start.
    if (!storedSections.length && !hasContent) setShowStartGuide(true);
  }, [instanceQuery.data]);

  // Register/clear the active white paper so the global Clio drawer can target it.
  useEffect(() => {
    const instance = instanceQuery.data;
    if (!instance) return;
    setActiveWhitePaper({
      instanceId: instance.id,
      title: instance.title ?? 'White Paper',
      strategyId: instance.strategyId ?? null,
    });
    return () => setActiveWhitePaper(null);
  }, [instanceQuery.data]);

  // ─── Persistence ──────────────────────────────────────────────────────────
  const updateInstance = useMutation({
    mutationFn: async (payload: {
      title: string;
      sections: WhitePaperSection[];
      steerNote: string;
      tone: ToneValue;
      variantSlug: string;
      contextItems: WhitePaperContextItem[];
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
        whitepaper_variant: payload.variantSlug,
        whitepaper_context_items: payload.contextItems,
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

  const markDirty = () => setSaveState((prev) => (prev === 'saving' ? prev : 'dirty'));

  const saveNow = useCallback(
    (
      override?: Partial<{ sections: WhitePaperSection[]; contextItems: WhitePaperContextItem[] }>,
    ) => {
      if (!instanceQuery.data) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      setSaveState('saving');
      updateInstance.mutate({
        title,
        sections: override?.sections ?? sectionsRef.current,
        steerNote,
        tone,
        variantSlug,
        contextItems: override?.contextItems ?? contextItems,
        showClio,
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [instanceQuery.data, title, steerNote, tone, variantSlug, contextItems, showClio],
  );

  // Debounced autosave
  useEffect(() => {
    if (!hydrated || !instanceQuery.data) return;
    if (saveState !== 'dirty') return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => saveNow(), 900);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, saveState, title, sections, steerNote, tone, variantSlug, contextItems, showClio]);

  // Force-save before unload / navigation if dirty (kills the stale-state bug).
  useEffect(() => {
    const handler = () => {
      if (saveState === 'dirty') saveNow();
    };
    window.addEventListener('beforeunload', handler);
    return () => {
      window.removeEventListener('beforeunload', handler);
      handler();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveState]);

  // ─── Full structured draft (real AI, structured) ────────────────────────
  const generateDoc = useMutation({
    mutationFn: async () => {
      const id = instanceQuery.data?.id;
      if (!id) throw new Error('Workflow instance unavailable');
      return (
        await api.post<{
          sections: WhitePaperSection[];
          generated_document: string;
          variant: string;
        }>(`/api/workflows/instances/${id}/generate-document`, {
          variantSlug,
          tone,
          steerNote,
          contextItems,
        })
      ).data;
    },
    onSuccess: (result) => {
      const fresh = normalizeSections(result.sections);
      setSections(fresh);
      setActiveSectionId(fresh[0]?.id ?? 'sec-1');
      setSaveState('saved');
      setLastSavedAt(new Date().toISOString());
      qc.invalidateQueries({ queryKey: ['workflow-instance', instanceQuery.data?.id] });
      message.success('White paper drafted from your context');
    },
    onError: (err) => {
      message.error(err instanceof Error ? err.message : 'Generate failed');
    },
  });

  // ─── Per-section AI (real) ──────────────────────────────────────────────
  const sectionMutation = useMutation({
    mutationFn: async (args: {
      sectionId: string;
      heading: string;
      mode: 'draft' | 'rewrite' | 'improve';
      improveDirective?: string;
      instruction?: string;
    }) => {
      const id = instanceQuery.data?.id;
      if (!id) throw new Error('Workflow instance unavailable');
      const section = sectionsRef.current.find((s) => s.id === args.sectionId);
      return (
        await api.post<{ sectionId: string; heading: string; body: string }>(
          `/api/workflows/instances/${id}/generate-section`,
          {
            sectionId: args.sectionId,
            heading: args.heading,
            mode: args.mode,
            improveDirective: args.improveDirective,
            instruction: args.instruction,
            currentBody: section?.body ?? '',
            tone,
            steerNote,
            contextItems,
          },
        )
      ).data;
    },
    onMutate: (args) => setGeneratingSectionId(args.sectionId),
    onSuccess: (result) => {
      setSections((prev) =>
        prev.map((item) =>
          item.id === result.sectionId ? { ...item, body: result.body, status: 'drafted' } : item,
        ),
      );
      setGeneratingSectionId(null);
      markDirty();
    },
    onError: (err) => {
      setGeneratingSectionId(null);
      message.error(err instanceof Error ? err.message : 'Section draft failed');
    },
  });

  const markCompleteMutation = useMutation({
    mutationFn: async () => {
      const id = instanceQuery.data?.id;
      if (!id) throw new Error('Workflow instance unavailable');
      // Ensure the latest edits are persisted before flipping status.
      await api.patch(`/api/workflows/instances/${id}`, {
        formData: {
          ...((instanceQuery.data?.formData ?? {}) as Record<string, unknown>),
          generated_document: composeDocument(sectionsRef.current),
          whitepaper_sections: sectionsRef.current,
        },
      });
      return (
        await api.patch<WorkflowInstance>(`/api/workflows/instances/${id}`, { status: 'review' })
      ).data;
    },
    onSuccess: (updated) => {
      qc.setQueryData(['workflow-instance', updated.id], updated);
      qc.invalidateQueries({ queryKey: ['workflow-instances'] });
      if (updated.strategyId) qc.invalidateQueries({ queryKey: ['strategy', updated.strategyId] });
      message.success('Draft marked complete');
    },
    onError: (err) => message.error(err instanceof Error ? err.message : 'Unable to mark complete'),
  });

  const lintMutation = useMutation({
    mutationFn: async () => {
      const id = instanceQuery.data?.id;
      if (!id) throw new Error('Workflow instance unavailable');
      if (saveState === 'dirty') saveNow();
      return (await api.post<LintResult>(`/api/workflows/instances/${id}/whitepaper-lint`)).data;
    },
    onSuccess: (result) => {
      setLint(result);
      if (!result.issues.length) message.success('Lint passed — no issues found');
    },
    onError: (err) => message.error(err instanceof Error ? err.message : 'Lint failed'),
  });

  // ─── Derived stats ───────────────────────────────────────────────────────
  const totalWords = useMemo(
    () =>
      sections.reduce(
        (sum, section) => sum + section.body.trim().split(/\s+/).filter(Boolean).length,
        0,
      ),
    [sections],
  );
  const completedSections = useMemo(
    () =>
      sections.filter((s) => (s.status ? s.status !== 'empty' : s.body.trim().length > 0)).length,
    [sections],
  );
  const readingMinutes = Math.max(1, Math.ceil(totalWords / 200));
  const wordBudget = activeVariant?.wordBudget ?? 600;

  const recommendations = useMemo(() => {
    const list: string[] = [];
    if (contextItems.length === 0) {
      list.push(
        'Add at least 2 context items (meetings, emails, capability) so drafts cite real specifics.',
      );
    } else {
      list.push(
        `${contextItems.length} context item${contextItems.length === 1 ? '' : 's'} will anchor claims.`,
      );
    }
    if (steerNote.trim().length < 18) {
      list.push('Add a steer note with audience + length constraints for tighter drafts.');
    }
    if (totalWords > wordBudget * 1.25) {
      list.push(
        `At ${totalWords} words you exceed the ~${wordBudget}-word budget for this format.`,
      );
    }
    const empty = sections.filter((s) => s.body.trim().length === 0).length;
    if (empty > 0)
      list.push(`${empty} section${empty === 1 ? '' : 's'} still blank — draft each with Clio.`);
    return list.slice(0, 4);
  }, [sections, contextItems.length, steerNote, totalWords, wordBudget]);

  const clientName = instanceQuery.data?.client?.name ?? 'Client';
  const capabilityName = strategyQuery.data?.capability?.name ?? 'Capability';
  const fiscalYear = strategyQuery.data?.fiscalYear?.replace(/^FY/i, '') ?? '';

  // ─── Section editing ──────────────────────────────────────────────────────
  const updateHeading = (id: string, heading: string) => {
    setSections((prev) => prev.map((s) => (s.id === id ? { ...s, heading } : s)));
    markDirty();
  };
  const updateBody = (id: string, body: string) => {
    setSections((prev) =>
      prev.map((s) =>
        s.id === id ? { ...s, body, status: body.trim() ? (s.status ?? 'drafted') : 'empty' } : s,
      ),
    );
    markDirty();
  };
  const addSection = () => {
    const nextId = `sec-${Date.now()}`;
    setSections((prev) => [
      ...prev,
      { id: nextId, heading: 'New section', body: '', status: 'empty' },
    ]);
    setActiveSectionId(nextId);
    markDirty();
  };
  const clearSection = (id: string) => {
    setSections((prev) => prev.map((s) => (s.id === id ? { ...s, body: '', status: 'empty' } : s)));
    markDirty();
  };
  const toggleReviewed = (id: string) => {
    setSections((prev) =>
      prev.map((s) =>
        s.id === id
          ? {
              ...s,
              status: s.status === 'reviewed' ? 'drafted' : s.body.trim() ? 'reviewed' : 'empty',
            }
          : s,
      ),
    );
    markDirty();
  };

  // ─── Context items ──────────────────────────────────────────────────────
  // Documents are listed without text; pull the extracted text on demand when
  // selected (same pipeline Outreach uses). Resilient to extraction failures.
  const extractDocText = useCallback(
    async (refId: string, itemId: string) => {
      let body: string;
      try {
        const res = await api.post<{ text?: string }>(
          `/api/engagement/attachments/${refId}/extract-text`,
        );
        const text = (res.data?.text ?? '').trim();
        body = text ? text.slice(0, 12000) : '(no extractable text in this document)';
      } catch {
        body = '(could not extract text — .txt, .docx, and .pdf are supported)';
      }
      setContextItems((prev) => prev.map((c) => (c.id === itemId ? { ...c, content: body } : c)));
      markDirty();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [api],
  );

  const toggleCandidate = (candidate: WhitePaperContextItem) => {
    const exists = contextItems.some((c) => c.id === candidate.id);
    if (exists) {
      setContextItems((prev) => prev.filter((c) => c.id !== candidate.id));
      markDirty();
      return;
    }
    const needsExtract =
      candidate.kind === 'document' && Boolean(candidate.refId) && !candidate.content;
    setContextItems((prev) => [
      ...prev,
      needsExtract ? { ...candidate, content: 'Extracting document text…' } : candidate,
    ]);
    if (needsExtract && candidate.refId) void extractDocText(candidate.refId, candidate.id);
    markDirty();
  };

  const addAllInCategory = (cat: ContextCategory) => {
    const pool = candidatesQuery.data ?? [];
    const toAdd = pool.filter(
      (c) => itemCategory(c) === cat && !contextItems.some((s) => s.id === c.id),
    );
    if (!toAdd.length) return;
    const additions = toAdd.map((c) => {
      const needsExtract = c.kind === 'document' && Boolean(c.refId) && !c.content;
      if (needsExtract && c.refId) void extractDocText(c.refId, c.id);
      return needsExtract ? { ...c, content: 'Extracting document text…' } : c;
    });
    setContextItems((prev) => [...prev, ...additions]);
    markDirty();
  };

  const clearCategory = (cat: ContextCategory) => {
    setContextItems((prev) => prev.filter((c) => itemCategory(c) !== cat));
    markDirty();
  };

  const uploadDoc = useCallback(
    async (file: File) => {
      const clientId = instanceQuery.data?.client?.id;
      if (!clientId) {
        message.error(
          'This white paper is not linked to a client, so documents cannot be uploaded.',
        );
        return;
      }
      setUploadingDoc(true);
      try {
        const contentType = file.type || 'application/octet-stream';
        // 1) presigned S3 POST, 2) upload bytes to S3, 3) confirm the row.
        const { data: presigned } = await api.post<{
          url: string;
          fields: Record<string, string>;
          s3Key: string;
        }>('/api/engagement/attachments/upload-url', {
          clientId,
          fileName: file.name,
          contentType,
          contentLength: file.size,
        });
        const form = new FormData();
        Object.entries(presigned.fields).forEach(([k, v]) => form.append(k, v));
        form.append('file', file); // file must be the last field for an S3 POST
        const s3Res = await fetch(presigned.url, { method: 'POST', body: form });
        if (!s3Res.ok) throw new Error(`Upload failed (${s3Res.status})`);
        const { data: created } = await api.post<{ id: string }>(
          '/api/engagement/attachments/confirm',
          {
            clientId,
            fileName: file.name,
            contentType,
            s3Key: presigned.s3Key,
          },
        );
        await candidatesQuery.refetch();
        // Auto-select the freshly uploaded document and resolve its text.
        const newItem: WhitePaperContextItem = {
          id: `doc-${created.id}`,
          kind: 'document',
          title: file.name,
          content: 'Extracting document text…',
          refId: created.id,
          tag: 'Doc',
          category: 'documents',
        };
        setContextItems((prev) =>
          prev.some((c) => c.id === newItem.id) ? prev : [...prev, newItem],
        );
        void extractDocText(created.id, newItem.id);
        markDirty();
        message.success(`Added ${file.name}`);
      } catch (err) {
        message.error(err instanceof Error ? err.message : 'Could not upload document');
      } finally {
        setUploadingDoc(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [api, instanceQuery.data, candidatesQuery, extractDocText],
  );

  const filteredCandidates = useMemo(() => {
    const list = candidatesQuery.data ?? [];
    const q = ctxSearch.trim().toLowerCase();
    if (!q) return list;
    return list.filter((c) =>
      `${c.title} ${c.tag ?? ''} ${CONTEXT_KIND_LABELS[c.kind] ?? ''}`.toLowerCase().includes(q),
    );
  }, [candidatesQuery.data, ctxSearch]);

  const groupedCandidates = useMemo(() => {
    const groups = new Map<ContextCategory, WhitePaperContextItem[]>();
    for (const c of filteredCandidates) {
      const cat = itemCategory(c);
      const bucket = groups.get(cat);
      if (bucket) bucket.push(c);
      else groups.set(cat, [c]);
    }
    return CONTEXT_CATEGORY_ORDER.filter((cat) => groups.has(cat)).map((cat) => ({
      category: cat,
      items: groups.get(cat) ?? [],
    }));
  }, [filteredCandidates]);

  const addFreeformNote = () => {
    const text = freeformNote.trim();
    if (!text) return;
    const item: WhitePaperContextItem = {
      id: `note-${Date.now()}`,
      kind: 'freeform_note',
      title: text.slice(0, 48) + (text.length > 48 ? '…' : ''),
      content: text,
      tag: 'Note',
    };
    setContextItems((prev) => [...prev, item]);
    setFreeformNote('');
    markDirty();
  };
  const removeContextItem = (id: string) => {
    setContextItems((prev) => prev.filter((c) => c.id !== id));
    markDirty();
  };

  const handleBack = () => {
    if (saveState === 'dirty') saveNow();
    if (strategyId) navigate(`/workspace/strategy/${strategyId}`);
    else navigate('/workspace/workflows');
  };

  const exportDocument = () => {
    const id = instanceQuery.data?.id;
    if (!id) return;
    if (saveState === 'dirty') saveNow();
    // Server produces real OOXML; open through the authenticated api base.
    api
      .get(`/api/workflows/instances/${id}/export.docx`, { responseType: 'blob' })
      .then((res) => {
        const blob = new Blob([res.data as BlobPart], {
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        const safe = (title || 'white-paper')
          .replace(/[^a-z0-9-_]+/gi, '-')
          .replace(/-+/g, '-')
          .toLowerCase();
        anchor.href = url;
        anchor.download = `${safe || 'white-paper'}.docx`;
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        URL.revokeObjectURL(url);
      })
      .catch((err) => message.error(err instanceof Error ? err.message : 'Export failed'));
  };

  const startWithVariant = (slug: string) => {
    const variant = variants.find((v) => v.slug === slug);
    if (!variant) return;
    setVariantSlug(slug);
    setTone(variant.defaultTone);
    const scaffold: WhitePaperSection[] = variant.sections.map((s, idx) => ({
      id: `sec-${idx + 1}`,
      heading: s.heading,
      body: '',
      status: 'empty',
    }));
    setSections(scaffold);
    setActiveSectionId('sec-1');
    setShowStartGuide(false);
    markDirty();
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

  const selectedIds = new Set(contextItems.map((c) => c.id));

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
          {saveState === 'saved' &&
            `Saved${formatSavedAt(lastSavedAt) ? ` · ${formatSavedAt(lastSavedAt)}` : ''}`}
          {saveState === 'dirty' && 'Unsaved changes'}
          {saveState === 'error' && 'Save failed'}
        </span>

        <div className="actions">
          <Button
            size="small"
            onClick={() => {
              setShowClio((prev) => !prev);
              markDirty();
            }}
          >
            {showClio ? 'Hide Clio' : 'Show Clio'}
          </Button>
          <Button
            size="small"
            icon={<SafetyCertificateOutlined />}
            loading={lintMutation.isPending}
            onClick={() => lintMutation.mutate()}
          >
            Lint
          </Button>
          <Button size="small" icon={<DownloadOutlined />} onClick={exportDocument}>
            Export DOCX
          </Button>
          <Button
            size="small"
            icon={<CheckCircleOutlined />}
            onClick={() => markCompleteMutation.mutate()}
            loading={markCompleteMutation.isPending}
          >
            Mark complete
          </Button>
          <Button
            size="small"
            icon={<RedoOutlined />}
            loading={generateDoc.isPending}
            onClick={() => generateDoc.mutate()}
          >
            Draft full paper
          </Button>
          <Button
            size="small"
            type="primary"
            icon={<SaveOutlined />}
            loading={updateInstance.isPending}
            onClick={() => saveNow()}
          >
            Save
          </Button>
        </div>
      </header>

      {lint && (
        <div className={`wp-lint-bar${lint.issues.length ? ' has-issues' : ' clean'}`}>
          <b>Lint:</b>{' '}
          {lint.issues.length ? (
            <span>{lint.issues.join('  ·  ')}</span>
          ) : (
            <span>
              No issues. {lint.wordCount} words (~{lint.wordBudget} target).
            </span>
          )}
          <button type="button" className="wp-lint-dismiss" onClick={() => setLint(null)}>
            ×
          </button>
        </div>
      )}

      <div
        className="wp-body"
        style={!showClio ? { gridTemplateColumns: '240px minmax(0, 1fr)' } : undefined}
      >
        <aside className="wp-sidebar">
          <h4>Outline</h4>
          <div className="wp-outline">
            {sections.map((section) => (
              <button
                key={section.id}
                type="button"
                className={`wp-outline-item${activeSectionId === section.id ? ' active' : ''}${
                  section.body.trim().length > 0 ? ' has-content' : ''
                }${section.status === 'reviewed' ? ' reviewed' : ''}`}
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
              <b>
                {totalWords.toLocaleString()} / ~{wordBudget}
              </b>
            </div>
            <div className="row">
              <span>Reading time</span>
              <b>~{readingMinutes} min</b>
            </div>
          </div>

          <Button
            block
            size="small"
            style={{ marginTop: 14 }}
            icon={<PlusOutlined />}
            onClick={addSection}
          >
            Add section
          </Button>
          <Button
            block
            size="small"
            type="primary"
            style={{ marginTop: 8 }}
            loading={generateDoc.isPending}
            onClick={() => generateDoc.mutate()}
          >
            Draft full paper
          </Button>
          <Button
            block
            size="small"
            style={{ marginTop: 8 }}
            icon={<BulbOutlined />}
            onClick={() => setShowStartGuide(true)}
          >
            Start guide
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
              <span>{activeVariant?.name ?? 'Draft'}</span>
            </div>

            {sections.length === 0 && (
              <Empty
                style={{ margin: '48px 0' }}
                description="No sections yet. Use the Start guide to pick a format, or Draft full paper."
              >
                <Button type="primary" onClick={() => setShowStartGuide(true)}>
                  Choose a format
                </Button>
              </Empty>
            )}

            {sections.map((section) => (
              <div key={section.id} id={`wp-sec-${section.id}`} className="wp-section">
                <div className="wp-section-head-row">
                  <Input
                    className="wp-section-h"
                    value={section.heading}
                    onFocus={() => setActiveSectionId(section.id)}
                    onChange={(event) => updateHeading(section.id, event.target.value)}
                  />
                  {section.status === 'reviewed' && <Tag color="success">Reviewed</Tag>}
                </div>

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
                    onClick={() =>
                      sectionMutation.mutate({
                        sectionId: section.id,
                        heading: section.heading,
                        mode: 'draft',
                      })
                    }
                    disabled={generatingSectionId === section.id}
                  >
                    {generatingSectionId === section.id ? 'Drafting…' : 'Draft with Clio'}
                  </button>
                  <button
                    type="button"
                    className="wp-section-action"
                    onClick={() =>
                      sectionMutation.mutate({
                        sectionId: section.id,
                        heading: section.heading,
                        mode: 'rewrite',
                      })
                    }
                    disabled={generatingSectionId === section.id || !section.body.trim()}
                  >
                    Rewrite
                  </button>
                  <Dropdown
                    trigger={['click']}
                    disabled={generatingSectionId === section.id || !section.body.trim()}
                    menu={{
                      items: [
                        ...IMPROVE_PRESETS.map((p) => ({ key: p.key, label: p.label })),
                        { type: 'divider' as const },
                        { key: 'custom', label: 'Custom instruction…' },
                      ],
                      onClick: ({ key }) => {
                        if (key === 'custom') {
                          const directive = window.prompt('How should Clio improve this section?');
                          if (directive && directive.trim()) {
                            sectionMutation.mutate({
                              sectionId: section.id,
                              heading: section.heading,
                              mode: 'improve',
                              improveDirective: directive.trim(),
                            });
                          }
                          return;
                        }
                        const preset = IMPROVE_PRESETS.find((p) => p.key === key);
                        if (preset) {
                          sectionMutation.mutate({
                            sectionId: section.id,
                            heading: section.heading,
                            mode: 'improve',
                            improveDirective: preset.directive,
                          });
                        }
                      },
                    }}
                  >
                    <button
                      type="button"
                      className="wp-section-action"
                      disabled={generatingSectionId === section.id || !section.body.trim()}
                    >
                      <ThunderboltOutlined /> Improve
                    </button>
                  </Dropdown>
                  <button
                    type="button"
                    className="wp-section-action"
                    onClick={() => toggleReviewed(section.id)}
                    disabled={!section.body.trim()}
                  >
                    {section.status === 'reviewed' ? 'Unmark' : 'Mark reviewed'}
                  </button>
                  <button
                    type="button"
                    className="wp-section-action"
                    onClick={() => clearSection(section.id)}
                  >
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
                <div className="sub">Pick a format, add context, steer voice, generate.</div>
              </div>
            </div>

            <div className="wp-clio-section">
              <h5>Format</h5>
              <select
                className="sw-select"
                value={variantSlug}
                onChange={(event) => {
                  const slug = event.target.value;
                  setVariantSlug(slug);
                  const v = variants.find((x) => x.slug === slug);
                  if (v) setTone(v.defaultTone);
                  markDirty();
                }}
              >
                {variants.map((variant) => (
                  <option key={variant.slug} value={variant.slug}>
                    {variant.name}
                  </option>
                ))}
              </select>
              {activeVariant && <div className="wp-clio-hint">{activeVariant.description}</div>}
            </div>

            <div className="wp-clio-section wp-ctx">
              <div className="wp-ctx-head">
                <h5>Context ({contextItems.length})</h5>
                <button
                  type="button"
                  className="wp-ctx-upload"
                  onClick={() => uploadInputRef.current?.click()}
                  disabled={uploadingDoc || !instanceQuery.data?.client?.id}
                  title={
                    instanceQuery.data?.client?.id
                      ? 'Upload a supporting document (.pdf, .docx, .txt)'
                      : 'Link this paper to a client to upload documents'
                  }
                >
                  <CloudUploadOutlined /> {uploadingDoc ? 'Uploading…' : 'Upload'}
                </button>
                <input
                  ref={uploadInputRef}
                  type="file"
                  hidden
                  accept=".pdf,.docx,.doc,.txt,.md,.csv"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void uploadDoc(file);
                    event.target.value = '';
                  }}
                />
              </div>

              {contextItems.length > 0 && (
                <div className="wp-ctx-selected">
                  {contextItems.map((item) => (
                    <span key={item.id} className="wp-ctx-chip">
                      <span className="k">{CONTEXT_KIND_LABELS[item.kind] ?? item.kind}</span>
                      <span className="t">{item.title}</span>
                      <button
                        type="button"
                        onClick={() => removeContextItem(item.id)}
                        aria-label="Remove"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}

              <Input
                className="wp-ctx-search"
                size="small"
                allowClear
                prefix={<SearchOutlined />}
                placeholder="Search profile, intel, research, docs…"
                value={ctxSearch}
                onChange={(event) => setCtxSearch(event.target.value)}
              />

              <div className="wp-ctx-groups">
                {candidatesQuery.isLoading && (
                  <div className="wp-clio-hint">Loading client context…</div>
                )}
                {candidatesQuery.isError && (
                  <div className="wp-clio-hint wp-ctx-error">
                    Couldn’t load context.{' '}
                    <button type="button" onClick={() => candidatesQuery.refetch()}>
                      Retry
                    </button>
                  </div>
                )}
                {!candidatesQuery.isLoading &&
                  !candidatesQuery.isError &&
                  groupedCandidates.length === 0 && (
                    <div className="wp-clio-hint">
                      {ctxSearch
                        ? 'No matching context.'
                        : 'No client context found yet. Upload a document or add a note below.'}
                    </div>
                  )}
                {groupedCandidates.map((group) => {
                  const allOn = group.items.every((c) => selectedIds.has(c.id));
                  return (
                    <div key={group.category} className="wp-ctx-group">
                      <div className="wp-ctx-group-head">
                        <span className="cat">{CONTEXT_CATEGORY_LABELS[group.category]}</span>
                        <span className="count">{group.items.length}</span>
                        <button
                          type="button"
                          className="wp-ctx-bulk"
                          onClick={() =>
                            allOn ? clearCategory(group.category) : addAllInCategory(group.category)
                          }
                        >
                          {allOn ? 'Clear' : 'Add all'}
                        </button>
                      </div>
                      <div className="wp-ctx-list">
                        {group.items.map((item) => {
                          const on = selectedIds.has(item.id);
                          return (
                            <button
                              key={item.id}
                              type="button"
                              className={`wp-ctx-item${on ? ' on' : ''}`}
                              onClick={() => toggleCandidate(item)}
                            >
                              <span className="cb">{on ? '✓' : ''}</span>
                              <span className="txt">
                                <span className="t">{item.title}</span>
                                <span className="s">
                                  {CONTEXT_KIND_LABELS[item.kind] ?? item.kind}
                                  {item.tag ? ` · ${item.tag}` : ''}
                                </span>
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="wp-ctx-freeform">
                <Input.TextArea
                  autoSize={{ minRows: 2 }}
                  placeholder="Paste any extra context or instructions to ground the draft…"
                  value={freeformNote}
                  onChange={(e) => setFreeformNote(e.target.value)}
                />
                <Button
                  size="small"
                  onClick={addFreeformNote}
                  disabled={!freeformNote.trim()}
                  style={{ marginTop: 6 }}
                >
                  Add note
                </Button>
              </div>
            </div>

            <div className="wp-clio-section">
              <h5>Steer the voice</h5>
              <Input.TextArea
                className="wp-clio-note"
                autoSize={{ minRows: 3 }}
                value={steerNote}
                onChange={(event) => {
                  setSteerNote(event.target.value);
                  markDirty();
                }}
                placeholder="Example: lead with pilot outcomes, keep under 2 pages, optimize for HASC staff."
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
              <Button
                type="primary"
                block
                loading={generateDoc.isPending}
                onClick={() => generateDoc.mutate()}
              >
                Draft full paper
              </Button>
            </div>

            <Typography.Text type="secondary" style={{ fontSize: 11 }}>
              Clio drafts from your selected context and steer note. It will not invent facts.
              Review before filing.
            </Typography.Text>
          </aside>
        )}
      </div>

      <Modal
        open={showStartGuide}
        onCancel={() => setShowStartGuide(false)}
        footer={null}
        width={640}
        title="Start your white paper"
      >
        <Typography.Paragraph type="secondary">
          Pick a format. Clio will scaffold the right sections and tone, then you can add context
          and draft.
        </Typography.Paragraph>
        <div className="wp-variant-grid">
          {variants.map((variant) => (
            <button
              key={variant.slug}
              type="button"
              className="wp-variant-card"
              onClick={() => startWithVariant(variant.slug)}
            >
              <div className="wp-variant-name">{variant.name}</div>
              <div className="wp-variant-desc">{variant.description}</div>
              <div className="wp-variant-meta">
                {variant.sections.length} sections · ~{variant.wordBudget} words
              </div>
              <Tooltip title={variant.sections.map((s) => s.heading).join(', ')}>
                <div className="wp-variant-sections">
                  {variant.sections.map((s) => s.heading).join(' · ')}
                </div>
              </Tooltip>
            </button>
          ))}
        </div>
      </Modal>
    </section>
  );
}
