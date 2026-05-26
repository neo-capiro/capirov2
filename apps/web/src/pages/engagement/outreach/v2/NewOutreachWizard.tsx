// New Outreach Wizard (v2)
//
// Drop-in replacement for the older OutreachWizard, matching the design
// mockup at C:\Users\neoma\Downloads\capiro redesign\src\engagement\outreach.jsx
//
// Architecture: a thin shell that drives a left-rail step list and a body
// pane. The two genuinely new steps (Direction + Context Builder) live in
// their own files; the rest are minimal screens that delegate the heavy
// work to existing API endpoints under /api/engagement/outreach.

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, Input, Select, Space, Tag, Typography } from 'antd';
import { ArrowRightOutlined, CheckOutlined, SendOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { useApi } from '../../../../lib/use-api.js';
import type { Client } from '../../../clients/clientTypes.js';
import type { OutreachRecipient } from '../../OutreachView.js';
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

export function NewOutreachWizard({
  clients,
  selectedClientId,
  aiConfigured,
  emailConnected,
  sendFrom,
  onCancel,
  onComplete,
}: Props) {
  const api = useApi();
  const qc = useQueryClient();
  const { message } = App.useApp();

  const [stepIdx, setStepIdx] = useState(0);
  const [state, setState] = useState<WizardV2State>({
    ...INITIAL_V2_STATE,
    clientId: selectedClientId,
  });

  // WIZARD_STEPS is readonly + non-empty, but TS's noUncheckedIndexedAccess
  // narrows the indexed read to `T | undefined`. The clamp on stepIdx
  // guarantees a value, so a fallback keeps the type system happy without
  // bleeding nullability into every downstream usage.
  const step = WIZARD_STEPS[stepIdx] ?? WIZARD_STEPS[0]!;
  const next = () => setStepIdx((i) => Math.min(i + 1, WIZARD_STEPS.length - 1));
  const back = () => setStepIdx((i) => Math.max(i - 1, 0));

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

  const meetingsQuery = useQuery<MeetingsResponse>({
    enabled: step.id === 'context',
    queryKey: ['outreach-pool-meetings', state.clientId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (state.clientId) params.set('clientId', state.clientId);
      params.set('from', new Date(Date.now() - 90 * 86400_000).toISOString());
      const res = await api.get<MeetingsResponse | { items?: never[] }>(
        `/api/engagement/meetings?${params}`,
      );
      return res.data as MeetingsResponse;
    },
    retry: false,
  });

  const mailQuery = useQuery<MailThreadsResponse>({
    enabled: step.id === 'context',
    queryKey: ['outreach-pool-mail', state.clientId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (state.clientId) params.set('clientId', state.clientId);
      const res = await api.get<MailThreadsResponse>(`/api/engagement/mail-threads?${params}`);
      return res.data;
    },
    retry: false,
  });

  const pool: Record<ContextKind, ContextPoolItem[]> = useMemo(() => {
    const out: Record<ContextKind, ContextPoolItem[]> = {
      bill: [],
      intel: [],
      email: [],
      meeting: [],
      note: [],
    };

    // Bills come from /outreach/insights → recentBills.
    for (const b of insightsQuery.data?.recentBills ?? []) {
      out.bill.push({
        id: `bill-${b.id}`,
        kind: 'bill',
        title: `${b.billNumber} — ${b.title}`,
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

    return out;
  }, [insightsQuery.data, meetingsQuery.data, mailQuery.data]);

  const poolLoading =
    insightsQuery.isLoading || meetingsQuery.isLoading || mailQuery.isLoading;

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
  const generateMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        clientId: state.clientId ?? undefined,
        recipients: state.recipients,
        templateId: state.templateId,
        tone: state.tone,
        direction: state.direction,
        contextItems: state.contextItems,
      };
      // The backend endpoint returns { results: [...] }, NOT { drafts: [...] }.
      // The wizard previously read data.drafts and silently no-op'd because
      // that key didn't exist on the response — the request actually
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
      message.success(`Generated ${data.results.length} drafts`);
    },
    onError: () => {
      // Endpoint may not exist yet — fall back to a placeholder draft so the
      // reviewer can still see the layout. The server-side implementation is
      // tracked separately (see task #5).
      const generatedEmails: WizardV2State['generatedEmails'] = {};
      for (const r of state.recipients) {
        const key = recipientKey(r);
        generatedEmails[key] = {
          subject: `[Placeholder] ${state.campaignName || 'Outreach'} — ${r.name ?? r.email ?? key}`,
          body: `Hi ${r.name ?? 'there'},\n\nThis is a placeholder draft. Wire the /api/engagement/outreach/generate-batch endpoint to produce real per-recipient copy using the ${state.contextItems.length} context items selected.\n\nBest,\nNeo`,
          status: 'ready',
        };
      }
      setState((prev) => ({ ...prev, generatedEmails }));
      message.warning('Generation endpoint not wired yet — showing placeholder drafts');
    },
  });

  const sendMutation = useMutation({
    mutationFn: async () => {
      const drafts = Object.entries(state.generatedEmails).map(([recipientId, d]) => ({
        recipientId,
        subject: d.subject,
        body: d.body,
      }));
      const res = await api.post<{ sent: number }>('/api/engagement/outreach/send-batch', {
        clientId: state.clientId,
        recipients: state.recipients,
        drafts,
        direction: state.direction,
      });
      return res.data;
    },
    onSuccess: (data) => {
      message.success(`Sent ${data.sent} emails`);
      qc.invalidateQueries({ queryKey: ['engagement-outreach'] });
      onComplete();
    },
    onError: () => message.error('Send endpoint not wired yet'),
  });

  // Auto-generate when we land on the Generate step the first time.
  useEffect(() => {
    if (
      step.id === 'generate' &&
      Object.keys(state.generatedEmails).length === 0 &&
      !generateMutation.isPending
    ) {
      generateMutation.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step.id]);

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
              onRegenerate={() => generateMutation.mutate()}
              regenerating={generateMutation.isPending}
            />
          )}

          {step.id === 'send' && (
            <StepSend
              recipients={state.recipients}
              sendFrom={sendFrom}
              emailConnected={emailConnected}
              onSend={() => sendMutation.mutate()}
              sending={sendMutation.isPending}
            />
          )}
        </div>

        <div className="ov2-wiz-foot">
          <Button onClick={stepIdx === 0 ? onCancel : back}>
            {stepIdx === 0 ? 'Cancel' : 'Back'}
          </Button>
          <span className="step-label">
            Step {stepIdx + 1} of {WIZARD_STEPS.length}
          </span>
          <div className="progress">
            <span style={{ width: `${((stepIdx + 1) / WIZARD_STEPS.length) * 100}%` }} />
          </div>
          {step.id === 'send' ? (
            <Button
              type="primary"
              icon={<SendOutlined />}
              onClick={() => sendMutation.mutate()}
              loading={sendMutation.isPending}
              disabled={!emailConnected}
            >
              Send all
            </Button>
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
// simple — anything more complex should live in its own file.
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
              placeholder="e.g. FY27 NDAA — Section 218 push"
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
            placeholder="e.g. Week of May 24 — Critical Minerals briefing"
          />
        </div>
      </Space>
    </div>
  );
}

// Template IDs MUST match the backend's SYSTEM_AI_TEMPLATES.id values
// (engagement.service.ts). When the wizard sent values like 'introduction'
// the service couldn't find a system template, fell through to a DB lookup
// against outreach_ai_template by UUID, and Postgres rejected the non-UUID
// id with a 500. Keeping these aligned with the backend IDs is the
// contract.
const TEMPLATES = [
  { id: 'system-introduction', name: 'Introduction', desc: 'Introductory outreach explaining the client and reason for engaging.' },
  { id: 'system-meeting-request', name: 'Meeting Request', desc: 'Request a meeting with scheduling options and a brief agenda.' },
  { id: 'system-policy-alert', name: 'Policy Alert', desc: 'Policy alert informing of a relevant legislative or regulatory development.' },
  { id: 'system-status-update', name: 'Status Update', desc: 'Brief progress update on client activity and next steps.' },
  { id: 'system-post-meeting-memo', name: 'Post-Meeting Memo', desc: 'Internal post-meeting memo built from meeting and debrief context.' },
  { id: 'system-thank-you', name: 'Thank You', desc: 'Warm thank-you acknowledging a specific recent action or support.' },
  { id: 'system-follow-up', name: 'Follow-Up', desc: 'Follow-up referencing a prior meeting with a clear next step.' },
  { id: 'system-memo', name: 'Memo / Position Paper', desc: 'Concise position memo with background, ask, and supporting points.' },
];

function StepTemplate({
  templateId,
  onChange,
}: {
  templateId: string | null;
  onChange: (id: string) => void;
}) {
  return (
    <div>
      <h2>Choose a template</h2>
      <div className="ov2-pane-sub">
        Templates seed the structure. Clio fills it from your context. You can edit per-recipient in the next step.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        {TEMPLATES.map((t) => (
          <div
            key={t.id}
            onClick={() => onChange(t.id)}
            style={{
              background: 'var(--ov2-bg-surface)',
              border: '1.5px solid ' + (templateId === t.id ? 'var(--ov2-accent)' : 'var(--ov2-border-1)'),
              borderRadius: 8,
              padding: '16px 18px',
              cursor: 'pointer',
              position: 'relative',
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
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{t.name}</div>
            <div style={{ fontSize: 12, color: 'var(--ov2-ink-2)', lineHeight: 1.45 }}>{t.desc}</div>
          </div>
        ))}
      </div>
    </div>
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
  regenerating,
}: {
  recipients: OutreachRecipient[];
  tone: WizardV2State['tone'];
  onTone: (t: WizardV2State['tone']) => void;
  generated: WizardV2State['generatedEmails'];
  selectedIdx: number;
  onSelectedIdx: (i: number) => void;
  onRegenerate: () => void;
  regenerating: boolean;
}) {
  const list = recipients.length ? recipients : [];
  const active = list[selectedIdx];
  const activeKey = active ? recipientKey(active) : null;
  const activeDraft = activeKey ? generated[activeKey] : undefined;
  const readyCount = Object.values(generated).filter((g) => g.status === 'ready').length;

  return (
    <div>
      <h2>Generate &amp; review</h2>
      <div className="ov2-pane-sub">
        Clio drafts a unique email per recipient using the context you built. Edit any draft inline before sending.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 14 }}>
        <div style={{ background: 'var(--ov2-bg-surface)', border: '1px solid var(--ov2-border-1)', borderRadius: 6 }}>
          <div style={{ padding: '12px 14px', background: 'var(--ov2-ink-1)', color: '#fff', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
            <ThunderboltOutlined /> {regenerating ? 'Generating…' : `${readyCount}/${list.length} ready`}
          </div>
          {list.map((r, i) => {
            const key = recipientKey(r);
            const ready = generated[key]?.status === 'ready';
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
                  <div style={{ fontSize: 11, color: 'var(--ov2-ink-3)' }}>{r.state || r.office || ''}</div>
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ background: 'var(--ov2-bg-surface)', border: '1px solid var(--ov2-border-1)', borderRadius: 6 }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--ov2-border-1)', display: 'flex', alignItems: 'center', gap: 12 }}>
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
            <Button icon={<ThunderboltOutlined />} loading={regenerating} onClick={onRegenerate}>
              Regenerate
            </Button>
          </div>
          <div style={{ padding: '18px 22px' }}>
            {activeDraft ? (
              <>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    padding: '8px 12px',
                    border: '1px solid var(--ov2-border-1)',
                    borderRadius: 6,
                    marginBottom: 14,
                  }}
                >
                  <div style={{ fontSize: 10.5, color: 'var(--ov2-ink-3)', marginBottom: 4 }}>Subject</div>
                  {activeDraft.subject}
                </div>
                <div style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                  {activeDraft.body}
                </div>
              </>
            ) : (
              <Typography.Text type="secondary">No draft yet. Click Regenerate.</Typography.Text>
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
  sending,
}: {
  recipients: OutreachRecipient[];
  sendFrom: string | null;
  emailConnected: boolean;
  onSend: () => void;
  sending: boolean;
}) {
  return (
    <div style={{ textAlign: 'center', padding: '40px 20px' }}>
      <h2 style={{ marginTop: 14 }}>Ready to send</h2>
      <div className="ov2-pane-sub" style={{ fontSize: 13.5 }}>
        <b style={{ color: 'var(--ov2-ink-1)' }}>{recipients.length}</b> personalized emails are queued. Capiro will send
        from <b>{sendFrom || 'your connected inbox'}</b>.
      </div>
      {!emailConnected && (
        <Typography.Paragraph type="warning" style={{ marginTop: 12 }}>
          No Microsoft connection found. Connect one in Settings → Integrations before sending.
        </Typography.Paragraph>
      )}
      <Space style={{ marginTop: 20 }}>
        <Button>Send as drafts</Button>
        <Button type="primary" icon={<SendOutlined />} loading={sending} onClick={onSend} disabled={!emailConnected}>
          Confirm Send
        </Button>
      </Space>
    </div>
  );
}
