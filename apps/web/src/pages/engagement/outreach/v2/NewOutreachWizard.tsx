// New Outreach Wizard (v2)
//
// Drop-in replacement for the older OutreachWizard, matching the design
// mockup at C:\Users\neoma\Downloads\capiro redesign\src\engagement\outreach.jsx
//
// Architecture: a thin shell that drives a left-rail step list and a body
// pane. The two genuinely new steps (Direction + Context Builder) live in
// their own files; the rest are minimal screens that delegate the heavy
// work to existing API endpoints under /api/engagement/outreach.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useUser } from '@clerk/clerk-react';
import {
  App,
  Button,
  Checkbox,
  Form,
  Input,
  Modal,
  Select,
  Skeleton,
  Space,
  Tag,
  Typography,
  Upload,
} from 'antd';
import {
  ArrowRightOutlined,
  CheckCircleFilled,
  CheckOutlined,
  EyeOutlined,
  PaperClipOutlined,
  PlusOutlined,
  SaveOutlined,
  SendOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { useApi } from '../../../../lib/use-api.js';
import type { Client } from '../../../clients/clientTypes.js';
import type { OutreachRecipient, OutreachRecord } from '../../OutreachView.js';
import { StepDirection } from './StepDirection.js';
import { StepContext } from './StepContext.js';
import { StepRecipients } from './StepRecipients.js';
import {
  INITIAL_V2_STATE,
  WIZARD_STEPS,
  recipientKey,
  type ContextKind,
  type ContextPoolItem,
  type WizardStepId,
  type WizardV2State,
} from './types.js';
import './outreach.css';

interface Props {
  clients: Client[];
  selectedClientId: string | null;
  aiConfigured: boolean;
  emailConnected: boolean;
  sendFrom: string | null;
  onCancel: () => void;
  onComplete: () => void;
  /**
   * When reopening a saved draft, the already-fetched record. The wizard
   * hydrates its state from this once (guarded by a ref) so the user resumes
   * where they left off instead of restarting at step 1.
   */
  initialRecord?: OutreachRecord | null;
  /**
   * The persisted record id of the draft being resumed. Seeds the wizard's
   * `draftId` so subsequent "Save as draft" clicks PATCH the same record
   * rather than creating duplicates.
   */
  initialDraftId?: string | null;
}

interface InsightsResponse {
  clientName?: string | null;
  recentBills?: Array<{
    id: string;
    billNumber: string;
    title: string;
    policyArea: string | null;
    status: string | null;
    latestAction: string | null;
  }>;
  clientLdaHistory?: Array<{ year: number; filingCount: number; issueAreas: string[] }>;
  // Client-profile intelligence the endpoint already returns; surfaced in the
  // Intel tab so it isn't empty when the client has no LDA filings.
  surgingIssues?: Array<{ code: string; name: string; surgePct: number | null }>;
  trendingTopics?: Array<{ word: string; growthPct: number | null }>;
  clientSpending?: { name?: string | null; total?: number | null } | null;
  topAgencies?: Array<{ name?: string | null; total?: number | null }>;
}

interface MeetingsResponse {
  items?: Array<{
    id: string;
    subject: string;
    startsAt: string;
    organizerName?: string | null;
    organizerEmail?: string | null;
    clientId?: string | null;
    attendees?: Array<{ email?: string | null; name?: string | null }>;
  }>;
}

interface MailThreadsResponse {
  items?: Array<{
    id: string;
    subject: string;
    snippet?: string | null;
    lastMessageAt?: string | null;
    clientId?: string | null;
    participants?: Array<{ email?: string | null; name?: string | null }>;
  }>;
}

interface AttachmentItem {
  id: string;
  fileName: string;
  contentType: string;
}
interface AttachmentsResponse {
  items: AttachmentItem[];
}

interface DebriefItem {
  id: string;
  meetingId: string | null;
  clientId: string | null;
  body: string | null;
  restricted?: boolean;
  createdAt?: string;
  meeting?: { id: string; subject: string | null; startsAt: string | null } | null;
}

interface DirectoryNoteItem {
  id: string;
  directoryContactId: string;
  directoryContactName: string | null;
  body: string;
  _memberContactId: string;
}

/** Pull a human-readable message out of an axios-style error, if present. */
function apiErrorMessage(err: unknown): string | null {
  const resp = (err as { response?: { data?: { message?: unknown } } })?.response;
  const msg = resp?.data?.message;
  if (typeof msg === 'string') return msg;
  if (Array.isArray(msg) && typeof msg[0] === 'string') return msg[0];
  return null;
}

export function NewOutreachWizard({
  clients,
  selectedClientId,
  aiConfigured,
  emailConnected,
  sendFrom,
  onCancel,
  onComplete,
  initialRecord,
  initialDraftId,
}: Props) {
  const api = useApi();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const { user } = useUser();
  const senderName =
    user?.fullName ||
    [user?.firstName, user?.lastName].filter(Boolean).join(' ') ||
    user?.primaryEmailAddress?.emailAddress ||
    'there';

  const [stepIdx, setStepIdx] = useState(0);
  const [state, setState] = useState<WizardV2State>({
    ...INITIAL_V2_STATE,
    clientId: selectedClientId,
  });
  // Persisted draft record id (set after first Save as draft, reused on
  // subsequent saves so we PATCH instead of creating duplicates). When
  // resuming a saved draft this is seeded from the loaded record so the very
  // first save in the reopened session PATCHes rather than duplicating.
  const [draftId, setDraftId] = useState<string | null>(initialDraftId ?? null);
  // Guards the one-time hydration from a reopened draft (see effect below) so
  // it never clobbers in-progress edits on a re-render or refetch.
  const hydratedRef = useRef(false);
  // Confirmation shown after a real send completes.
  const [sentResult, setSentResult] = useState<{ sent: number; failed: number } | null>(null);
  // Recipient key currently being (re)generated individually, if any.
  const [generatingKey, setGeneratingKey] = useState<string | null>(null);

  // WIZARD_STEPS is readonly + non-empty, but TS's noUncheckedIndexedAccess
  // narrows the indexed read to `T | undefined`. The clamp on stepIdx
  // guarantees a value, so a fallback keeps the type system happy without
  // bleeding nullability into every downstream usage.
  const step = WIZARD_STEPS[stepIdx] ?? WIZARD_STEPS[0]!;
  const next = () => setStepIdx((i) => Math.min(i + 1, WIZARD_STEPS.length - 1));
  const back = () => setStepIdx((i) => Math.max(i - 1, 0));

  // ---- Resume a saved draft ----
  // When OutreachView reopens a draft it passes the already-fetched record in.
  // Map it back into wizard state exactly inverse to saveDraftMutation below,
  // so subject/body/recipients/title/tone/template/context and the step all
  // come back. Runs once (hydratedRef) so it can't stomp on edits made after
  // the first paint, even if the record query refetches.
  useEffect(() => {
    if (hydratedRef.current) return;
    if (!initialRecord) return;
    hydratedRef.current = true;

    const record = initialRecord;
    const metadata = (record.metadata ?? {}) as Record<string, unknown>;

    // Per-recipient drafts were saved under metadata.perRecipientEmails as
    // [{ recipientId, subject, body }] — the same array buildDrafts() emits.
    const perRecipient = Array.isArray(metadata.perRecipientEmails)
      ? (metadata.perRecipientEmails as Array<{
          recipientId?: unknown;
          subject?: unknown;
          body?: unknown;
        }>)
      : [];
    const generatedEmails: WizardV2State['generatedEmails'] = {};
    for (const d of perRecipient) {
      if (typeof d.recipientId !== 'string') continue;
      generatedEmails[d.recipientId] = {
        subject: typeof d.subject === 'string' ? d.subject : '',
        body: typeof d.body === 'string' ? d.body : '',
        status: 'ready',
      };
    }
    // Fallback: if no per-recipient map was saved (older save), seed the first
    // recipient from the top-level subject/body so the draft isn't blank.
    if (Object.keys(generatedEmails).length === 0 && (record.subject || record.body)) {
      const firstRecipient = Array.isArray(record.recipients) ? record.recipients[0] : undefined;
      if (firstRecipient) {
        generatedEmails[recipientKey(firstRecipient)] = {
          subject: record.subject ?? '',
          body: record.body ?? '',
          status: 'ready',
        };
      }
    }

    // direction is persisted inside metadata (the API merges it there).
    const rawDirection = metadata.direction;
    const direction: WizardV2State['direction'] =
      rawDirection === 'on-behalf' || rawDirection === 'to-clients' ? rawDirection : null;

    const rawTone = metadata.tone;
    const tone: WizardV2State['tone'] =
      rawTone === 'Professional' ||
      rawTone === 'Friendly' ||
      rawTone === 'Formal' ||
      rawTone === 'Concise'
        ? rawTone
        : INITIAL_V2_STATE.tone;

    // Rich v2 context items are round-tripped losslessly under
    // metadata.contextItems (the top-level contextPool the API also stores is
    // a lossy projection used for generation, not for the wizard UI).
    const contextItems = Array.isArray(metadata.contextItems)
      ? (metadata.contextItems as WizardV2State['contextItems'])
      : [];

    const attachmentIds = Array.isArray(metadata.attachmentIds)
      ? (metadata.attachmentIds as unknown[]).filter((a): a is string => typeof a === 'string')
      : [];

    setState((prev) => ({
      ...prev,
      direction,
      clientId: record.clientId ?? prev.clientId,
      campaignName: record.title ?? prev.campaignName,
      recipients: Array.isArray(record.recipients) ? record.recipients : prev.recipients,
      contextItems,
      templateId: typeof metadata.templateId === 'string' ? metadata.templateId : prev.templateId,
      tone,
      generatedEmails:
        Object.keys(generatedEmails).length > 0 ? generatedEmails : prev.generatedEmails,
      attachmentIds: attachmentIds.length > 0 ? attachmentIds : prev.attachmentIds,
    }));

    // Resume step: prefer the persisted column, but fall back to
    // metadata.lastStep for drafts written by the pre-fix build (which only
    // ever advanced lastStep inside metadata). lastStep is 1-based; stepIdx is
    // 0-based. Clamp so a bad value can't push past the last step.
    const metadataStep = typeof metadata.lastStep === 'number' ? metadata.lastStep : undefined;
    const resumeStep =
      record.lastStep && record.lastStep > 1 ? record.lastStep : (metadataStep ?? record.lastStep);
    if (resumeStep && resumeStep > 1) {
      setStepIdx(Math.min(resumeStep - 1, WIZARD_STEPS.length - 1));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialRecord]);

  // ---- Context pool ----
  // The Context Builder displays a multi-tab catalog (bills/intel/emails/
  // meetings/notes). The backend has these split across three existing
  // endpoints rather than a single context-pool route, so we fan out from
  // the wizard and bucket the results client-side. Each source is loaded
  // independently so a 404 on one doesn't blank the whole pool.
  const insightsQuery = useQuery<InsightsResponse>({
    enabled: step.id === 'context',
    queryKey: ['outreach-insights', state.clientId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (state.clientId) params.set('clientId', state.clientId);
      const res = await api.get<InsightsResponse>(`/api/engagement/outreach/insights?${params}`);
      return res.data;
    },
    retry: false,
  });

  // Emails of the chosen recipients. Passed to the meetings/mail queries so the
  // context pool also surfaces past interactions with the people being
  // contacted — not just the client's stored contacts, which are often sparse.
  const recipientEmailsParam = useMemo(
    () =>
      Array.from(
        new Set(
          state.recipients
            .map((r) => r.email?.trim().toLowerCase())
            .filter((e): e is string => Boolean(e)),
        ),
      ).join(','),
    [state.recipients],
  );

  const meetingsQuery = useQuery<MeetingsResponse>({
    enabled: step.id === 'context',
    queryKey: ['outreach-pool-meetings', state.clientId, recipientEmailsParam],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (state.clientId) params.set('clientId', state.clientId);
      // Last 90 days of meetings. Send an explicit `to` — without it the API's
      // toDateWindow defaults `to` to from+1day, collapsing the range to a
      // single day 90 days ago (the bug that left the Past meetings tab empty).
      params.set('from', new Date(Date.now() - 90 * 86400_000).toISOString());
      params.set('to', new Date().toISOString());
      if (recipientEmailsParam) params.set('recipientEmails', recipientEmailsParam);
      // The API returns a bare Meeting[] (every other caller reads it as an
      // array). The v2 pool reads `.items`, so wrap it — reading `.items` off
      // the bare array, as this query did before, always gave undefined, which
      // is the real reason the Past meetings tab was empty.
      const res = await api.get<NonNullable<MeetingsResponse['items']>>(
        `/api/engagement/meetings?${params}`,
      );
      return { items: res.data };
    },
    retry: false,
  });

  const mailQuery = useQuery<MailThreadsResponse>({
    enabled: step.id === 'context',
    queryKey: ['outreach-pool-mail', state.clientId, recipientEmailsParam],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (state.clientId) params.set('clientId', state.clientId);
      if (recipientEmailsParam) params.set('recipientEmails', recipientEmailsParam);
      // Bare MailThread[] from the API → wrap so the pool's `.items` read works
      // (same empty-tab bug as meetings).
      const res = await api.get<NonNullable<MailThreadsResponse['items']>>(
        `/api/engagement/mail-threads?${params}`,
      );
      return { items: res.data };
    },
    retry: false,
  });

  // Client documents (uploaded files) for the Docs & Notes tab. Text is
  // extracted lazily when an item is selected (see StepContext).
  const docsQuery = useQuery<AttachmentsResponse>({
    enabled: (step.id === 'context' || step.id === 'generate') && !!state.clientId,
    queryKey: ['outreach-pool-docs', state.clientId],
    queryFn: async () => {
      const res = await api.get<AttachmentItem[]>('/api/engagement/attachments', {
        params: { clientId: state.clientId },
      });
      return { items: res.data };
    },
    retry: false,
  });

  // Saved meeting debriefs for this client (newest first). Bodies are
  // access-filtered server-side; restricted ones come back with body=null.
  const debriefQuery = useQuery<DebriefItem[]>({
    enabled: step.id === 'context' && !!state.clientId,
    queryKey: ['outreach-pool-debriefs', state.clientId],
    queryFn: async () => {
      const res = await api.get<DebriefItem[]>('/api/engagement/debriefs', {
        params: { clientId: state.clientId },
      });
      return res.data;
    },
    retry: false,
  });

  // Member directory notes: one query per unique directory member among the
  // recipients (staffer ids are "memberId:stafferId" → take the member part).
  const memberContactIds = useMemo(() => {
    const ids = new Set<string>();
    for (const r of state.recipients) {
      if (r.directoryContactId) ids.add(r.directoryContactId.split(':')[0] ?? r.directoryContactId);
    }
    return Array.from(ids);
  }, [state.recipients]);

  const memberNotesQueries = useQueries({
    queries: memberContactIds.map((contactId) => ({
      enabled: step.id === 'context',
      queryKey: ['outreach-pool-member-notes', contactId],
      queryFn: async () =>
        (
          await api.get<DirectoryNoteItem[]>(
            `/api/directory/contacts/${encodeURIComponent(contactId)}/notes`,
          )
        ).data.map((n) => ({ ...n, _memberContactId: contactId })),
      retry: false,
      staleTime: 60_000,
    })),
  });

  const pool: Record<ContextKind, ContextPoolItem[]> = useMemo(() => {
    const out: Record<ContextKind, ContextPoolItem[]> = {
      bill: [],
      intel: [],
      email: [],
      meeting: [],
      note: [],
      document: [],
      debrief: [],
    };

    // ---- Docs & Notes: client profile notes + client documents + member notes ----
    // Client profile notes (saved in the client profile → Documents → Notes,
    // stored on intakeData.profileNotes).
    const activeClient = clients.find((c) => c.id === state.clientId);
    const profileNotes =
      typeof (activeClient?.intakeData as { profileNotes?: unknown } | null)?.profileNotes === 'string'
        ? ((activeClient!.intakeData as { profileNotes?: string }).profileNotes as string).trim()
        : '';
    if (profileNotes) {
      out.document.push({
        id: `clientnote-${state.clientId}`,
        kind: 'document',
        title: `${activeClient?.name ?? 'Client'} — profile notes`,
        body: profileNotes,
        tag: 'Client note',
      });
    }

    // Client documents (uploaded files). Body (extracted text) is filled in
    // lazily on selection; here we list them as selectable items.
    for (const d of docsQuery.data?.items ?? []) {
      out.document.push({
        id: `doc-${d.id}`,
        kind: 'document',
        title: d.fileName,
        sub: 'Client document',
        tag: 'Document',
      });
    }

    // Member directory notes, matched to the recipients who are that member.
    for (const q of memberNotesQueries) {
      for (const n of q.data ?? []) {
        const memberId = n._memberContactId;
        const matchedRecipientIds = state.recipients
          .map((r) => r.directoryContactId)
          .filter((id): id is string => !!id && (id === memberId || id.split(':')[0] === memberId));
        out.document.push({
          id: `membernote-${n.id}`,
          kind: 'document',
          title: `Note: ${n.directoryContactName ?? 'member'}`,
          body: n.body,
          tag: 'Member note',
          matches: [memberId, ...matchedRecipientIds],
        });
      }
    }

    // Bills come from /outreach/insights → recentBills.
    for (const b of insightsQuery.data?.recentBills ?? []) {
      out.bill.push({
        id: `bill-${b.id}`,
        kind: 'bill',
        title: `${b.billNumber}, ${b.title}`,
        body: b.latestAction ?? undefined,
        tag: b.policyArea ?? undefined,
        sub: b.status ?? undefined,
      });
    }

    // LDA history rows surface as "intel" so the user can attach them to
    // contextualize what the client has historically lobbied on.
    for (const row of insightsQuery.data?.clientLdaHistory ?? []) {
      out.intel.push({
        id: `lda-${row.year}`,
        kind: 'intel',
        title: `${row.year} LDA filings (${row.filingCount})`,
        body: row.issueAreas.length ? `Issue areas: ${row.issueAreas.join(', ')}` : undefined,
        tag: 'LDA',
      });
    }

    // Client-profile intelligence the insights endpoint already returns:
    // surging issues, trending topics, and the client's federal-spending
    // footprint. Surfaced here so the Intel tab has content beyond LDA history.
    for (const issue of insightsQuery.data?.surgingIssues ?? []) {
      out.intel.push({
        id: `intel-issue-${issue.code}`,
        kind: 'intel',
        title: issue.name,
        body: issue.surgePct != null ? `Lobbying activity up ${issue.surgePct}%` : undefined,
        tag: 'Surging issue',
      });
    }
    for (const topic of insightsQuery.data?.trendingTopics ?? []) {
      out.intel.push({
        id: `intel-topic-${topic.word}`,
        kind: 'intel',
        title: topic.word,
        body:
          topic.growthPct != null
            ? `Trending ${topic.growthPct > 0 ? '+' : ''}${topic.growthPct}%`
            : undefined,
        tag: 'Trending',
      });
    }
    const spending = insightsQuery.data?.clientSpending;
    if (spending?.name) {
      out.intel.push({
        id: 'intel-spending',
        kind: 'intel',
        title: `Federal contracts: ${spending.name}`,
        body:
          spending.total != null ? `~$${(spending.total / 1_000_000).toFixed(1)}M awarded` : undefined,
        tag: 'Spending',
      });
    }
    for (const agency of insightsQuery.data?.topAgencies ?? []) {
      if (!agency.name) continue;
      out.intel.push({
        id: `intel-agency-${agency.name}`,
        kind: 'intel',
        title: `Top agency: ${agency.name}`,
        body: agency.total != null ? `~$${(agency.total / 1_000_000).toFixed(1)}M` : undefined,
        tag: 'Agency',
      });
    }

    // Past meetings: smart-routing matches recipients via attendee email.
    for (const m of meetingsQuery.data?.items ?? []) {
      const attendeeEmails = (m.attendees ?? [])
        .map((a) => a.email?.toLowerCase())
        .filter((e): e is string => Boolean(e));
      out.meeting.push({
        id: `meeting-${m.id}`,
        kind: 'meeting',
        title: m.subject,
        body: m.organizerName ? `Organizer: ${m.organizerName}` : undefined,
        sub: new Date(m.startsAt).toLocaleDateString(),
        matches: [m.clientId, ...attendeeEmails].filter((s): s is string => Boolean(s)),
      });
    }

    // Past email threads: same smart-routing via participant email.
    for (const t of mailQuery.data?.items ?? []) {
      const participantEmails = (t.participants ?? [])
        .map((p) => p.email?.toLowerCase())
        .filter((e): e is string => Boolean(e));
      out.email.push({
        id: `mail-${t.id}`,
        kind: 'email',
        title: t.subject,
        body: t.snippet ?? undefined,
        sub: t.lastMessageAt ? new Date(t.lastMessageAt).toLocaleDateString() : undefined,
        matches: [t.clientId, ...participantEmails].filter((s): s is string => Boolean(s)),
      });
    }

    // Saved debriefs: routable to the client and the debrief's meeting.
    for (const d of debriefQuery.data ?? []) {
      out.debrief.push({
        id: `debrief-${d.id}`,
        kind: 'debrief',
        title: d.meeting?.subject ? `Debrief: ${d.meeting.subject}` : 'Meeting debrief',
        body: d.body ?? undefined,
        sub: d.meeting?.startsAt
          ? new Date(d.meeting.startsAt).toLocaleDateString()
          : d.createdAt
            ? new Date(d.createdAt).toLocaleDateString()
            : undefined,
        tag: d.restricted ? 'Restricted' : 'Debrief',
        matches: [d.clientId, d.meetingId].filter((s): s is string => Boolean(s)),
      });
    }

    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    insightsQuery.data,
    meetingsQuery.data,
    mailQuery.data,
    docsQuery.data,
    debriefQuery.data,
    memberNotesQueries,
    clients,
    state.clientId,
    state.recipients,
  ]);

  const poolLoading =
    insightsQuery.isLoading ||
    meetingsQuery.isLoading ||
    mailQuery.isLoading ||
    docsQuery.isLoading ||
    debriefQuery.isLoading;

  // ---- Gating ----
  const canAdvance = (): boolean => {
    switch (step.id) {
      case 'direction':
        return !!state.direction;
      case 'setup':
        return state.direction === 'to-clients' || !!state.clientId;
      case 'recipients':
        return state.recipients.length > 0;
      case 'context':
        return state.contextItems.length > 0;
      case 'template':
        return !!state.templateId;
      default:
        return true;
    }
  };

  // ---- Generate & Send (delegated to existing API endpoints) ----
  // Pass `recipients` to generate (or regenerate) a single recipient's draft;
  // omit it to (re)generate the whole batch.
  const generateMutation = useMutation({
    mutationFn: async (vars?: { recipients?: OutreachRecipient[] }) => {
      const targetRecipients = vars?.recipients ?? state.recipients;
      // The API's GenerateBatchEmailDto whitelists only id/kind/title/body/
      // scope/note on context items. With forbidNonWhitelisted enabled (see
      // apps/api/src/main.ts), sending the pool-only fields tag/sub/matches
      // makes Nest reject the request with a 400, which is what was
      // causing the "endpoint not wired yet" placeholder fallback to fire.
      // Strip those fields here so the payload matches the DTO exactly.
      const contextItems = state.contextItems.map((item) => ({
        id: item.id,
        kind: item.kind,
        title: item.title,
        body: item.body,
        scope: item.scope,
        note: item.note,
      }));
      const payload = {
        clientId: state.clientId ?? undefined,
        recipients: targetRecipients,
        templateId: state.templateId,
        tone: state.tone,
        direction: state.direction,
        contextItems,
      };
      // The backend endpoint returns { results: [...] }, NOT { drafts: [...] }.
      // The wizard previously read data.drafts and silently no-op'd because
      // that key didn't exist on the response, the request actually
      // succeeded but no drafts ever landed in state.
      const res = await api.post<{
        results: Array<{ recipientId: string; subject: string; body: string }>;
      }>('/api/engagement/outreach/generate-batch', payload);
      return res.data;
    },
    onSuccess: (data) => {
      setState((prev) => {
        const generatedEmails = { ...prev.generatedEmails };
        for (const d of data.results) {
          generatedEmails[d.recipientId] = {
            subject: d.subject,
            body: d.body,
            status: 'ready',
          };
        }
        return { ...prev, generatedEmails };
      });
      setGeneratingKey(null);
      message.success(
        data.results.length === 1
          ? 'Regenerated this email'
          : `Generated ${data.results.length} drafts`,
      );
    },
    onError: (_err, vars) => {
      // Endpoint failure: fall back to a placeholder draft so the reviewer can
      // still see the layout. Only touch the recipients we tried to generate.
      const targets = vars?.recipients ?? state.recipients;
      setState((prev) => {
        const generatedEmails = { ...prev.generatedEmails };
        for (const r of targets) {
          const key = recipientKey(r);
          generatedEmails[key] = {
            subject: `[Placeholder] ${state.campaignName || 'Outreach'}, ${r.name ?? r.email ?? key}`,
            body: `Hi ${r.name ?? 'there'},\n\nThis is a placeholder draft because email generation failed. Edit this text directly, or try Regenerate.\n\nBest regards,\n${senderName}`,
            status: 'ready',
          };
        }
        return { ...prev, generatedEmails };
      });
      setGeneratingKey(null);
      message.warning('Generation failed; showing an editable placeholder draft.');
    },
  });

  const buildDrafts = () =>
    Object.entries(state.generatedEmails)
      .filter(([, d]) => d.subject?.trim() || d.body?.trim())
      .map(([recipientId, d]) => ({ recipientId, subject: d.subject, body: d.body }));

  const sendMutation = useMutation({
    mutationFn: async (vars?: { testMode?: boolean }) => {
      const res = await api.post<{
        test: boolean;
        sent: number;
        failed: number;
        errors: Array<{ email: string; message: string }>;
        sentTo?: string;
        skippedAttachments?: string[];
      }>('/api/engagement/outreach/send-batch', {
        clientId: state.clientId ?? undefined,
        recipients: state.recipients,
        drafts: buildDrafts(),
        direction: state.direction ?? undefined,
        testMode: vars?.testMode ?? false,
        attachmentIds: state.attachmentIds,
      });
      return res.data;
    },
    onSuccess: (data) => {
      if (data.skippedAttachments?.length) {
        message.warning(
          `Skipped ${data.skippedAttachments.length} attachment(s) over 3MB: ${data.skippedAttachments.join(', ')}`,
        );
      }
      if (data.test) {
        message.success(`Test email sent to ${data.sentTo ?? 'your inbox'}`);
        return;
      }
      qc.invalidateQueries({ queryKey: ['engagement-outreach'] });
      if (data.failed > 0) {
        message.warning(`Sent ${data.sent}, but ${data.failed} failed. See details below.`);
      } else {
        message.success(`Sent ${data.sent} ${data.sent === 1 ? 'email' : 'emails'}`);
      }
      // Show an explicit confirmation screen rather than closing silently.
      setSentResult({ sent: data.sent, failed: data.failed });
    },
    onError: (err) => message.error(apiErrorMessage(err) || 'Could not send emails'),
  });

  // Save the current drafts as a reusable outreach record. Available at any
  // step; first save creates the record, later saves update it in place.
  const saveDraftMutation = useMutation({
    mutationFn: async () => {
      const drafts = buildDrafts();
      const first = drafts[0];
      // The API stores `contextPool` at the top level (its own projection used
      // for Clio generation), so map the wizard's rich SelectedContextItem
      // shape onto the DTO's fields (kind→sourceType, body→summary, the per-
      // recipient `scope` → recipientIds). The full v2 items also ride in
      // metadata.contextItems below so the wizard can restore them losslessly.
      const contextPool = state.contextItems.map((item) => ({
        id: item.id,
        sourceType: item.kind,
        title: item.title,
        summary: item.body,
        note: item.note,
        scope: item.scope,
        recipientIds: item.scope && item.scope !== 'all' ? [item.scope] : undefined,
        matches: item.matches,
      }));
      const common = {
        clientId: state.clientId ?? undefined,
        direction: state.direction ?? undefined,
        title: state.campaignName?.trim() || 'Untitled outreach',
        subject: first?.subject?.trim() || undefined,
        body: first?.body?.trim() || undefined,
        recipients: state.recipients,
        // Top-level lastStep so the API persists the resume step in its own
        // column (it clamps to 1 when absent — the original Bug B). 1-based.
        lastStep: stepIdx + 1,
        // Top-level contextPool so the API stores selected context where
        // getOutreachRecord / Clio generation expect it.
        contextPool,
        metadata: {
          source: 'v2-wizard',
          // Kept in metadata too so drafts remain resumable even if the column
          // is somehow stale, and to stay backward-compatible with prior saves.
          lastStep: stepIdx + 1,
          tone: state.tone,
          templateId: state.templateId,
          perRecipientEmails: drafts,
          // Lossless copy of the rich v2 context items for wizard restore (the
          // top-level contextPool projection drops kind/body/sub/tag detail).
          contextItems: state.contextItems,
          attachmentIds: state.attachmentIds,
        },
      };
      if (draftId) {
        return (await api.patch<{ id: string }>(`/api/engagement/outreach/${draftId}`, common)).data;
      }
      return (
        await api.post<{ id: string }>('/api/engagement/outreach', { type: 'campaign', ...common })
      ).data;
    },
    onSuccess: (rec) => {
      setDraftId(rec.id);
      qc.invalidateQueries({ queryKey: ['engagement-outreach'] });
      message.success('Draft saved');
    },
    onError: () => message.error('Could not save draft'),
  });

  // Auto-generate when we land on the Generate step the first time.
  useEffect(() => {
    if (
      step.id === 'generate' &&
      Object.keys(state.generatedEmails).length === 0 &&
      !generateMutation.isPending
    ) {
      generateMutation.mutate(undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step.id]);

  // ---- Attachments: pick stored client docs or upload a file to send with the emails ----
  const toggleAttachment = (id: string) =>
    setState((p) => ({
      ...p,
      attachmentIds: p.attachmentIds.includes(id)
        ? p.attachmentIds.filter((a) => a !== id)
        : [...p.attachmentIds, id],
    }));

  const uploadAttachment = async (file: File) => {
    if (!state.clientId) {
      message.error('Select a client before uploading attachments');
      return;
    }
    try {
      const contentType = file.type || 'application/octet-stream';
      // 1) presigned S3 POST, 2) upload the bytes straight to S3, 3) confirm so
      // a row is created and the file appears in the client's documents.
      const { data: presigned } = await api.post<{
        url: string;
        fields: Record<string, string>;
        s3Key: string;
      }>('/api/engagement/attachments/upload-url', {
        clientId: state.clientId,
        fileName: file.name,
        contentType,
        contentLength: file.size,
      });
      const form = new FormData();
      Object.entries(presigned.fields).forEach(([k, v]) => form.append(k, v));
      form.append('file', file); // file must be the last field for S3 POST
      const s3Res = await fetch(presigned.url, { method: 'POST', body: form });
      if (!s3Res.ok) throw new Error(`S3 upload failed (${s3Res.status})`);
      const { data: created } = await api.post<{ id: string }>(
        '/api/engagement/attachments/confirm',
        { clientId: state.clientId, fileName: file.name, contentType, s3Key: presigned.s3Key },
      );
      setState((p) => ({
        ...p,
        attachmentIds: Array.from(new Set([...p.attachmentIds, created.id])),
      }));
      await docsQuery.refetch();
      message.success(`Attached ${file.name}`);
    } catch (err) {
      message.error(apiErrorMessage(err) || 'Could not upload attachment');
    }
  };

  // Inline edits to a generated draft mark it 'edited' so the user can see
  // their changes are captured; edits persist in wizard state immediately.
  const updateDraft = (key: string, patch: { subject?: string; body?: string }) =>
    setState((prev) => {
      const existing = prev.generatedEmails[key];
      if (!existing) return prev;
      return {
        ...prev,
        generatedEmails: {
          ...prev.generatedEmails,
          [key]: { ...existing, ...patch, status: 'edited' },
        },
      };
    });

  // Generate (or regenerate) a single recipient's email.
  const generateOne = (r: OutreachRecipient) => {
    setGeneratingKey(recipientKey(r));
    generateMutation.mutate({ recipients: [r] });
  };

  const canSaveDraft = Object.keys(state.generatedEmails).length > 0 || state.recipients.length > 0;
  // Distinguish the real send from a test send so only the clicked button spins.
  const realSending = sendMutation.isPending && !sendMutation.variables?.testMode;
  const testSending = sendMutation.isPending && !!sendMutation.variables?.testMode;

  // ---- Render ----
  return (
    <div className="ov2-wiz">
      <aside className="ov2-wiz-rail">
        {WIZARD_STEPS.map((s, i) => (
          <div
            key={s.id}
            className={
              'ov2-wiz-step' +
              (i < stepIdx ? ' done' : '') +
              (i === stepIdx ? ' active' : '')
            }
            onClick={() => i <= stepIdx && setStepIdx(i)}
          >
            <span className="badge">
              {i < stepIdx ? <CheckOutlined style={{ fontSize: 11 }} /> : i + 1}
            </span>
            {s.label}
          </div>
        ))}
      </aside>

      <div className="ov2-wiz-body">
        <div className="ov2-wiz-pane">
          {step.id === 'direction' && (
            <StepDirection
              direction={state.direction}
              onChange={(d) => setState((p) => ({ ...p, direction: d }))}
            />
          )}

          {step.id === 'setup' && (
            <StepSetup
              clients={clients}
              direction={state.direction!}
              clientId={state.clientId}
              campaignName={state.campaignName}
              onClientId={(id) => setState((p) => ({ ...p, clientId: id }))}
              onName={(n) => setState((p) => ({ ...p, campaignName: n }))}
            />
          )}

          {step.id === 'recipients' && (
            <StepRecipients
              direction={state.direction!}
              clients={clients}
              selectedClientId={state.clientId}
              recipients={state.recipients}
              onChange={(rs) => setState((p) => ({ ...p, recipients: rs }))}
            />
          )}

          {step.id === 'context' && (
            <StepContext
              recipients={state.recipients}
              selected={state.contextItems}
              onChange={(items) => setState((p) => ({ ...p, contextItems: items }))}
              pool={pool}
              loading={poolLoading}
            />
          )}

          {step.id === 'template' && (
            <StepTemplate
              templateId={state.templateId}
              onChange={(id) => setState((p) => ({ ...p, templateId: id }))}
            />
          )}

          {step.id === 'generate' && (
            <StepGenerate
              recipients={state.recipients}
              tone={state.tone}
              onTone={(t) => setState((p) => ({ ...p, tone: t }))}
              generated={state.generatedEmails}
              selectedIdx={state.selectedRecipientIdx}
              onSelectedIdx={(i) => setState((p) => ({ ...p, selectedRecipientIdx: i }))}
              onRegenerate={() => generateMutation.mutate(undefined)}
              onGenerateOne={generateOne}
              onEdit={updateDraft}
              regenerating={generateMutation.isPending}
              generatingKey={generatingKey}
            />
          )}

          {step.id === 'generate' && (
            <div className="ov2-attachments" style={{ marginTop: 16 }}>
              <Typography.Title level={5} style={{ marginBottom: 4 }}>
                Attachments
              </Typography.Title>
              <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
                Files added here are attached to every email on send (max 3MB each).
              </Typography.Paragraph>
              <Space direction="vertical" size={4} style={{ width: '100%' }}>
                {(docsQuery.data?.items ?? []).map((d) => (
                  <Checkbox
                    key={d.id}
                    checked={state.attachmentIds.includes(d.id)}
                    onChange={() => toggleAttachment(d.id)}
                  >
                    {d.fileName}
                  </Checkbox>
                ))}
                {(docsQuery.data?.items ?? []).length === 0 && (
                  <Typography.Text type="secondary">
                    No stored documents for this client yet.
                  </Typography.Text>
                )}
                <Upload
                  multiple
                  showUploadList={false}
                  beforeUpload={(file) => {
                    void uploadAttachment(file as File);
                    return false; // handle the upload ourselves; skip AntD's default
                  }}
                >
                  <Button size="small" icon={<PaperClipOutlined />}>
                    Upload a file
                  </Button>
                </Upload>
              </Space>
            </div>
          )}

          {step.id === 'send' && (
            <StepSend
              recipients={state.recipients}
              sendFrom={sendFrom}
              emailConnected={emailConnected}
              onSend={() => sendMutation.mutate(undefined)}
              onTest={() => sendMutation.mutate({ testMode: true })}
              sending={realSending}
              testing={testSending}
              sentResult={sentResult}
              onDone={onComplete}
            />
          )}
        </div>

        <div className="ov2-wiz-foot">
          {/* Cancel discards the in-progress outreach (a confirmation dialog
              guards it). "Save as draft" is the explicit way to keep your
              work — available on every step. */}
          <Button onClick={onCancel}>Cancel &amp; discard</Button>
          {stepIdx > 0 && <Button onClick={back}>Back</Button>}
          {!sentResult && (
            <Button
              icon={<SaveOutlined />}
              onClick={() => saveDraftMutation.mutate()}
              loading={saveDraftMutation.isPending}
              disabled={!canSaveDraft}
            >
              Save as draft
            </Button>
          )}
          <span className="step-label">
            Step {stepIdx + 1} of {WIZARD_STEPS.length}
          </span>
          <div className="progress">
            <span style={{ width: `${((stepIdx + 1) / WIZARD_STEPS.length) * 100}%` }} />
          </div>
          {step.id === 'send' ? (
            sentResult ? (
              <Button type="primary" icon={<CheckOutlined />} onClick={onComplete}>
                Done
              </Button>
            ) : (
              <Button
                type="primary"
                icon={<SendOutlined />}
                onClick={() => sendMutation.mutate(undefined)}
                loading={realSending}
                disabled={!emailConnected}
              >
                Send all
              </Button>
            )
          ) : (
            <Button
              type="primary"
              icon={<ArrowRightOutlined />}
              iconPosition="end"
              onClick={next}
              disabled={!canAdvance()}
            >
              {step.id === 'generate' ? 'Review Emails' : 'Continue'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// Lightweight in-file step components for the steps that don't have new
// design innovations. They borrow antd for inputs and stay deliberately
// simple, anything more complex should live in its own file.
// =====================================================================

function StepSetup({
  clients,
  direction,
  clientId,
  campaignName,
  onClientId,
  onName,
}: {
  clients: Client[];
  direction: 'on-behalf' | 'to-clients';
  clientId: string | null;
  campaignName: string;
  onClientId: (id: string | null) => void;
  onName: (n: string) => void;
}) {
  if (direction === 'on-behalf') {
    return (
      <div>
        <h2>Which client are you writing on behalf of?</h2>
        <div className="ov2-pane-sub">
          Clio uses this client's capabilities, tracked bills, and meeting history to personalize each recipient's email.
        </div>
        <Space direction="vertical" style={{ width: '100%' }} size={20}>
          <Select
            placeholder="Select a client…"
            style={{ width: '100%' }}
            value={clientId ?? undefined}
            onChange={(id) => onClientId(id ?? null)}
            options={clients.map((c) => ({ value: c.id, label: c.name }))}
            showSearch
            optionFilterProp="label"
          />
          <div>
            <Typography.Text strong style={{ display: 'block', marginBottom: 6 }}>
              Campaign name (optional)
            </Typography.Text>
            <Input
              value={campaignName}
              onChange={(e) => onName(e.target.value)}
              placeholder="e.g. FY27 NDAA, Section 218 push"
            />
          </div>
        </Space>
      </div>
    );
  }

  return (
    <div>
      <h2>Set up your client briefing</h2>
      <div className="ov2-pane-sub">
        You'll send from your own inbox. Clio personalizes per-client from the context you select next.
      </div>
      <Space direction="vertical" style={{ width: '100%' }} size={20}>
        <div>
          <Typography.Text strong style={{ display: 'block', marginBottom: 6 }}>
            Briefing name
          </Typography.Text>
          <Input
            value={campaignName}
            onChange={(e) => onName(e.target.value)}
            placeholder="e.g. Week of May 24, Critical Minerals briefing"
          />
        </div>
      </Space>
    </div>
  );
}

// Shape returned by GET /api/engagement/outreach/ai-templates. The backend
// merges system templates (hardcoded in engagement.service.ts) with any
// user-created custom templates from outreach_ai_template. We render both
// in the same grid; the only visible difference is a "Custom" tag on
// user-owned ones so the user can find their own templates at a glance.
interface AiTemplate {
  id: string;
  source: 'system' | 'user';
  name: string;
  category: string;
  prompt: string;
  description: string | null;
  samplePreview: string | null;
  tone: string;
  usageCount: number;
}

function StepTemplate({
  templateId,
  onChange,
}: {
  templateId: string | null;
  onChange: (id: string) => void;
}) {
  const api = useApi();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [previewing, setPreviewing] = useState<AiTemplate | null>(null);
  const [creatingOpen, setCreatingOpen] = useState(false);

  const templatesQuery = useQuery<AiTemplate[]>({
    queryKey: ['outreach-ai-templates'],
    queryFn: async () =>
      (await api.get<AiTemplate[]>('/api/engagement/outreach/ai-templates')).data,
  });

  const createMutation = useMutation({
    mutationFn: async (input: {
      name: string;
      category: string;
      prompt: string;
      description?: string;
      tone?: string;
    }) =>
      (await api.post<AiTemplate>('/api/engagement/outreach/ai-templates', input)).data,
    onSuccess: (created) => {
      message.success(`Created "${created.name}"`);
      qc.invalidateQueries({ queryKey: ['outreach-ai-templates'] });
      setCreatingOpen(false);
      // Auto-select the newly created template so the user doesn't have
      // to click it again before continuing.
      onChange(created.id);
    },
    onError: () => message.error('Could not create template'),
  });

  const templates = templatesQuery.data ?? [];

  if (templatesQuery.isLoading) {
    return (
      <div>
        <h2>Choose a template</h2>
        <Skeleton active paragraph={{ rows: 6 }} />
      </div>
    );
  }

  return (
    <div>
      <h2>Choose a template</h2>
      <div className="ov2-pane-sub">
        Templates seed the structure. Clio fills it from your context. Preview to see a sample, or create your own.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        {templates.map((t) => (
          <div
            key={t.id}
            onClick={() => onChange(t.id)}
            style={{
              background: 'var(--ov2-bg-surface)',
              border:
                '1.5px solid ' +
                (templateId === t.id ? 'var(--ov2-accent)' : 'var(--ov2-border-1)'),
              borderRadius: 8,
              padding: '16px 18px',
              cursor: 'pointer',
              position: 'relative',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            {templateId === t.id && (
              <span
                style={{
                  position: 'absolute',
                  top: 14,
                  right: 14,
                  width: 18,
                  height: 18,
                  borderRadius: '50%',
                  background: 'var(--ov2-accent)',
                  color: '#fff',
                  display: 'grid',
                  placeItems: 'center',
                  fontSize: 11,
                }}
              >
                <CheckOutlined />
              </span>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{t.name}</div>
              {t.source === 'user' && (
                <Tag color="blue" style={{ fontSize: 10, lineHeight: 1.4, padding: '0 6px' }}>
                  Custom
                </Tag>
              )}
            </div>
            <div
              style={{
                fontSize: 12,
                color: 'var(--ov2-ink-2)',
                lineHeight: 1.45,
                flex: 1,
              }}
            >
              {t.description ?? 'No description'}
            </div>
            <Button
              size="small"
              type="text"
              icon={<EyeOutlined />}
              // stopPropagation so clicking Preview doesn't also select the
              // template, the user might want to compare a few before
              // committing to one.
              onClick={(e) => {
                e.stopPropagation();
                setPreviewing(t);
              }}
              style={{ alignSelf: 'flex-start', padding: 0, height: 22, fontSize: 12 }}
            >
              Preview
            </Button>
          </div>
        ))}

        {/* "Create custom" tile, same grid slot as a template card so the
            shape stays predictable as the catalog grows. */}
        <button
          type="button"
          onClick={() => setCreatingOpen(true)}
          style={{
            background: 'transparent',
            border: '1.5px dashed var(--ov2-border-1)',
            borderRadius: 8,
            padding: '16px 18px',
            cursor: 'pointer',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 4,
            color: 'var(--ov2-ink-2)',
            minHeight: 110,
            font: 'inherit',
          }}
        >
          <PlusOutlined style={{ fontSize: 18 }} />
          <span style={{ fontSize: 13, fontWeight: 600 }}>Create custom template</span>
          <span style={{ fontSize: 11 }}>Define your own prompt</span>
        </button>
      </div>

      <PreviewTemplateModal
        template={previewing}
        onClose={() => setPreviewing(null)}
        onSelect={(id) => {
          onChange(id);
          setPreviewing(null);
        }}
      />
      <CreateTemplateModal
        open={creatingOpen}
        onCancel={() => setCreatingOpen(false)}
        onSubmit={(input) => createMutation.mutate(input)}
        submitting={createMutation.isPending}
      />
    </div>
  );
}

function PreviewTemplateModal({
  template,
  onClose,
  onSelect,
}: {
  template: AiTemplate | null;
  onClose: () => void;
  onSelect: (id: string) => void;
}) {
  return (
    <Modal
      open={!!template}
      onCancel={onClose}
      title={template ? `Preview · ${template.name}` : ''}
      footer={
        template
          ? [
              <Button key="close" onClick={onClose}>
                Close
              </Button>,
              <Button key="use" type="primary" onClick={() => onSelect(template.id)}>
                Use this template
              </Button>,
            ]
          : null
      }
      width={640}
    >
      {template && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <div
              style={{
                fontSize: 11,
                color: 'var(--ov2-ink-3)',
                marginBottom: 4,
                textTransform: 'uppercase',
                letterSpacing: 0.5,
              }}
            >
              Description
            </div>
            <div style={{ fontSize: 13.5, color: 'var(--ov2-ink-1)' }}>
              {template.description ?? 'No description provided.'}
            </div>
          </div>
          <div>
            <div
              style={{
                fontSize: 11,
                color: 'var(--ov2-ink-3)',
                marginBottom: 4,
                textTransform: 'uppercase',
                letterSpacing: 0.5,
              }}
            >
              Sample output
            </div>
            <pre
              style={{
                fontSize: 12.5,
                lineHeight: 1.55,
                background: 'var(--ov2-bg-surface)',
                border: '1px solid var(--ov2-border-1)',
                borderRadius: 6,
                padding: 14,
                whiteSpace: 'pre-wrap',
                fontFamily: 'inherit',
                margin: 0,
              }}
            >
              {template.samplePreview ?? '(no sample preview available)'}
            </pre>
          </div>
          <div>
            <div
              style={{
                fontSize: 11,
                color: 'var(--ov2-ink-3)',
                marginBottom: 4,
                textTransform: 'uppercase',
                letterSpacing: 0.5,
              }}
            >
              Prompt sent to Clio
            </div>
            <div
              style={{
                fontSize: 12.5,
                color: 'var(--ov2-ink-2)',
                background: 'var(--ov2-bg-surface)',
                border: '1px solid var(--ov2-border-1)',
                borderRadius: 6,
                padding: 14,
                lineHeight: 1.55,
              }}
            >
              {template.prompt}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--ov2-ink-3)' }}>
            <span>
              Tone: <b style={{ color: 'var(--ov2-ink-1)' }}>{template.tone}</b>
            </span>
            <span>
              Category: <b style={{ color: 'var(--ov2-ink-1)' }}>{template.category}</b>
            </span>
            {template.source === 'user' && (
              <span>
                Used: <b style={{ color: 'var(--ov2-ink-1)' }}>{template.usageCount}×</b>
              </span>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

function CreateTemplateModal({
  open,
  onCancel,
  onSubmit,
  submitting,
}: {
  open: boolean;
  onCancel: () => void;
  onSubmit: (input: {
    name: string;
    category: string;
    prompt: string;
    description?: string;
    tone?: string;
  }) => void;
  submitting: boolean;
}) {
  const [form] = Form.useForm();

  useEffect(() => {
    if (!open) form.resetFields();
  }, [open, form]);

  return (
    <Modal
      open={open}
      onCancel={onCancel}
      title="Create custom template"
      okText="Create"
      okButtonProps={{ loading: submitting }}
      onOk={() => {
        form
          .validateFields()
          .then((values) => {
            onSubmit({
              name: values.name,
              category: values.category || 'general',
              prompt: values.prompt,
              description: values.description || undefined,
              tone: values.tone || 'professional',
            });
          })
          .catch(() => {
            /* validation errors render inline */
          });
      }}
      width={620}
      destroyOnClose
    >
      <Form form={form} layout="vertical" initialValues={{ tone: 'professional', category: 'general' }}>
        <Form.Item
          name="name"
          label="Name"
          rules={[{ required: true, message: 'Name is required' }]}
        >
          <Input placeholder="e.g. FY27 NDAA position memo" maxLength={120} />
        </Form.Item>
        <Form.Item name="description" label="Short description (optional)">
          <Input placeholder="One-line summary shown on the template card" maxLength={500} />
        </Form.Item>
        <Form.Item
          name="prompt"
          label="Prompt"
          tooltip="What Clio is told to produce. Be specific about structure, length, and tone."
          rules={[{ required: true, message: 'Prompt is required' }, { min: 20, message: 'Prompt should be at least 20 characters' }]}
        >
          <Input.TextArea
            rows={6}
            placeholder="Write a concise email to a congressional office that... Include... Under 200 words."
            maxLength={5000}
            showCount
          />
        </Form.Item>
        <Space size={12} style={{ display: 'flex' }}>
          <Form.Item name="category" label="Category" style={{ flex: 1 }}>
            <Select
              options={[
                { value: 'general', label: 'General' },
                { value: 'meeting', label: 'Meeting' },
                { value: 'follow_up', label: 'Follow-up' },
                { value: 'policy', label: 'Policy' },
              ]}
            />
          </Form.Item>
          <Form.Item name="tone" label="Tone" style={{ flex: 1 }}>
            <Select
              options={[
                { value: 'professional', label: 'Professional' },
                { value: 'friendly', label: 'Friendly' },
                { value: 'formal', label: 'Formal' },
                { value: 'concise', label: 'Concise' },
              ]}
            />
          </Form.Item>
        </Space>
      </Form>
    </Modal>
  );
}

function StepGenerate({
  recipients,
  tone,
  onTone,
  generated,
  selectedIdx,
  onSelectedIdx,
  onRegenerate,
  onGenerateOne,
  onEdit,
  regenerating,
  generatingKey,
}: {
  recipients: OutreachRecipient[];
  tone: WizardV2State['tone'];
  onTone: (t: WizardV2State['tone']) => void;
  generated: WizardV2State['generatedEmails'];
  selectedIdx: number;
  onSelectedIdx: (i: number) => void;
  onRegenerate: () => void;
  onGenerateOne: (r: OutreachRecipient) => void;
  onEdit: (key: string, patch: { subject?: string; body?: string }) => void;
  regenerating: boolean;
  generatingKey: string | null;
}) {
  const list = recipients.length ? recipients : [];
  const active = list[selectedIdx];
  const activeKey = active ? recipientKey(active) : null;
  const activeDraft = activeKey ? generated[activeKey] : undefined;
  const readyCount = Object.values(generated).filter(
    (g) => g.status === 'ready' || g.status === 'edited',
  ).length;
  // A single-recipient (re)generation is in flight for the active draft.
  const activeGenerating = !!activeKey && generatingKey === activeKey;
  // Whole-batch regeneration (no specific key) is in flight.
  const batchGenerating = regenerating && !generatingKey;

  return (
    <div>
      <h2>Generate &amp; review</h2>
      <div className="ov2-pane-sub">
        Clio drafts a unique email per recipient. Edit any draft inline (your changes are saved as
        you type), regenerate individually, or save everything as a draft to finish later.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 14 }}>
        <div style={{ background: 'var(--ov2-bg-surface)', border: '1px solid var(--ov2-border-1)', borderRadius: 6 }}>
          <div style={{ padding: '12px 14px', background: 'var(--ov2-ink-1)', color: '#fff', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
            <ThunderboltOutlined /> {batchGenerating ? 'Generating…' : `${readyCount}/${list.length} ready`}
          </div>
          {list.map((r, i) => {
            const key = recipientKey(r);
            const draft = generated[key];
            const ready = draft?.status === 'ready' || draft?.status === 'edited';
            const rowGenerating = generatingKey === key || batchGenerating;
            return (
              <div
                key={key}
                onClick={() => onSelectedIdx(i)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '11px 14px',
                  borderBottom: '1px solid var(--ov2-border-1)',
                  cursor: 'pointer',
                  background: i === selectedIdx ? 'var(--ov2-accent-soft)' : undefined,
                }}
              >
                <span
                  style={{
                    width: 16,
                    height: 16,
                    borderRadius: '50%',
                    display: 'grid',
                    placeItems: 'center',
                    background: ready ? 'var(--ov2-success)' : 'var(--ov2-bg-sunken)',
                    color: ready ? '#fff' : 'var(--ov2-ink-3)',
                  }}
                >
                  {ready && <CheckOutlined style={{ fontSize: 9 }} />}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600 }}>{r.name || r.email || key}</div>
                  <div style={{ fontSize: 11, color: 'var(--ov2-ink-3)' }}>
                    {draft?.status === 'edited' ? 'Edited' : r.state || r.office || ''}
                  </div>
                </div>
                <Button
                  size="small"
                  type="text"
                  icon={<ThunderboltOutlined />}
                  loading={rowGenerating}
                  onClick={(e) => {
                    e.stopPropagation();
                    onGenerateOne(r);
                  }}
                  title="Generate just this email"
                />
              </div>
            );
          })}
        </div>
        <div style={{ background: 'var(--ov2-bg-surface)', border: '1px solid var(--ov2-border-1)', borderRadius: 6 }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--ov2-border-1)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{active?.name || active?.email || 'No recipient'}</div>
              <div style={{ fontSize: 12, color: 'var(--ov2-ink-3)' }}>{active?.office || active?.state || ''}</div>
            </div>
            <Select
              value={tone}
              onChange={onTone}
              style={{ marginLeft: 'auto', width: 140 }}
              options={['Professional', 'Friendly', 'Formal', 'Concise'].map((t) => ({ value: t, label: t }))}
            />
            <Button
              icon={<ThunderboltOutlined />}
              loading={activeGenerating || batchGenerating}
              onClick={() => active && onGenerateOne(active)}
              disabled={!active}
            >
              Regenerate this
            </Button>
            <Button icon={<ThunderboltOutlined />} loading={batchGenerating} onClick={onRegenerate}>
              Regenerate all
            </Button>
          </div>
          <div style={{ padding: '18px 22px' }}>
            {activeDraft ? (
              <>
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 10.5, color: 'var(--ov2-ink-3)', marginBottom: 4 }}>Subject</div>
                  <Input
                    value={activeDraft.subject}
                    onChange={(e) => activeKey && onEdit(activeKey, { subject: e.target.value })}
                    placeholder="Email subject"
                  />
                </div>
                <div>
                  <div style={{ fontSize: 10.5, color: 'var(--ov2-ink-3)', marginBottom: 4 }}>Body</div>
                  <Input.TextArea
                    value={activeDraft.body}
                    onChange={(e) => activeKey && onEdit(activeKey, { body: e.target.value })}
                    autoSize={{ minRows: 12, maxRows: 28 }}
                    style={{ fontSize: 13, lineHeight: 1.6 }}
                  />
                </div>
                <Typography.Text type="secondary" style={{ fontSize: 11.5, display: 'block', marginTop: 8 }}>
                  Edits save automatically. Use “Save as draft” below to keep everything and finish
                  later.
                </Typography.Text>
              </>
            ) : (
              <Typography.Text type="secondary">
                {activeGenerating ? 'Generating…' : 'No draft yet. Click “Regenerate this”.'}
              </Typography.Text>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StepSend({
  recipients,
  sendFrom,
  emailConnected,
  onSend,
  onTest,
  sending,
  testing,
  sentResult,
  onDone,
}: {
  recipients: OutreachRecipient[];
  sendFrom: string | null;
  emailConnected: boolean;
  onSend: () => void;
  onTest: () => void;
  sending: boolean;
  testing: boolean;
  sentResult: { sent: number; failed: number } | null;
  onDone: () => void;
}) {
  // Post-send confirmation screen.
  if (sentResult) {
    return (
      <div style={{ textAlign: 'center', padding: '48px 20px' }}>
        <CheckCircleFilled style={{ fontSize: 52, color: 'var(--ov2-success, #22c55e)' }} />
        <h2 style={{ marginTop: 18 }}>
          {sentResult.failed > 0
            ? `Sent ${sentResult.sent}, ${sentResult.failed} failed`
            : `${sentResult.sent} ${sentResult.sent === 1 ? 'email' : 'emails'} sent`}
        </h2>
        <div className="ov2-pane-sub" style={{ fontSize: 13.5 }}>
          {sentResult.failed > 0
            ? 'Some emails could not be sent. Check the failed addresses and your email connection, then retry from Outreach.'
            : `Your personalized emails went out from ${sendFrom || 'your connected inbox'}.`}
        </div>
        <Space style={{ marginTop: 22 }}>
          <Button type="primary" icon={<CheckOutlined />} onClick={onDone}>
            Done
          </Button>
        </Space>
      </div>
    );
  }

  return (
    <div style={{ textAlign: 'center', padding: '40px 20px' }}>
      <h2 style={{ marginTop: 14 }}>Ready to send</h2>
      <div className="ov2-pane-sub" style={{ fontSize: 13.5 }}>
        <b style={{ color: 'var(--ov2-ink-1)' }}>{recipients.length}</b> personalized{' '}
        {recipients.length === 1 ? 'email is' : 'emails are'} queued. Capiro will send from{' '}
        <b>{sendFrom || 'your connected inbox'}</b>.
      </div>
      {!emailConnected && (
        <Typography.Paragraph type="warning" style={{ marginTop: 12 }}>
          No Microsoft connection found. Connect one in Settings → Integrations before sending.
        </Typography.Paragraph>
      )}
      <Space style={{ marginTop: 20 }}>
        <Button
          icon={<EyeOutlined />}
          loading={testing && !sending}
          onClick={onTest}
          disabled={!emailConnected}
        >
          Send test email to myself
        </Button>
        <Button type="primary" icon={<SendOutlined />} loading={sending} onClick={onSend} disabled={!emailConnected}>
          Confirm Send
        </Button>
      </Space>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 14 }}>
        “Send test email” delivers one copy to your own inbox so you can preview formatting before
        the real send.
      </Typography.Paragraph>
    </div>
  );
}
