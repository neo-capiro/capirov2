// Step 3, Recipients — "Select recipients".
//
// One mixable pool of targets per the frozen design doc:
//   • Individual — one 1:1 email (added via + from any source tab)
//   • List — campaign-local saved set; every member gets their OWN email
//   • Group — campaign-local set sharing ONE email
// Sources: Congressional Directory (GET /api/directory/contacts, staffers
// nested per member), Client Contacts (clients prop + GET
// /api/clients/:id/people — the doc's derived Client Directory view), and
// Manual Add. Favorites reuse the existing directory favorites API
// (GET /api/directory/favorites, POST/DELETE /contacts/:id/favorite).
//
// + always adds straight to To; Cc/Bcc are managed afterwards in the
// selected-recipients panel (per individual / per list member / per group)
// and via the campaign-global Cc/Bcc bar. Lists/Groups are created from a
// build mode (checkboxes) entered from the toolbar dropdowns; they live on
// the campaign until the OutreachAudience persistence lands.

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Badge, Button, Checkbox, Dropdown, Input, Modal, Select } from 'antd';
import {
  CheckOutlined,
  CloseOutlined,
  DownOutlined,
  PlusOutlined,
  RightOutlined,
  SearchOutlined,
  StarFilled,
  StarOutlined,
  TeamOutlined,
  UnorderedListOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useApi } from '../../../../lib/use-api.js';
import type { Client, ClientPerson } from '../../../clients/clientTypes.js';
import type { DirectoryApiResponse, DirectoryEntry } from '../../../directory/directoryData.js';
import type { OutreachRecipient } from '../../OutreachView.js';
import { recipientKey } from './types.js';
import {
  EMAIL_RE,
  individualTarget,
  membershipOf,
  newTargetKey,
  totalRecipients,
  type OutreachTarget,
  type TargetType,
} from './targets.js';
import {
  apiErrorMessage,
  audienceMemberToRecipient,
  plural,
  toAudienceMemberInput,
  type AudienceBuilderState,
  type AudienceRow,
} from './audiences.js';
import { useGroups } from './groups.js';
import './step-recipients-select.css';

interface Props {
  clients: Client[];
  targets: OutreachTarget[];
  globalCc: string[];
  globalBcc: string[];
  onChange: (patch: {
    targets?: OutreachTarget[];
    globalCc?: string[];
    globalBcc?: string[];
  }) => void;
}

type SourceTab = 'congress' | 'clients' | 'manual';

interface FavoriteRow {
  directoryContactId: string;
  directoryContactName: string | null;
}

// ---- source row → OutreachRecipient converters (same field mapping the
// previous StepRecipients used, kept here so that file stays untouched) ----

function fromDirectoryEntry(entry: DirectoryEntry): OutreachRecipient {
  const address = entry.addresses.find((a) => a.isMain) ?? entry.addresses[0];
  const formattedAddress = address
    ? [address.address1, address.city, address.state, address.zip].filter(Boolean).join(', ')
    : entry.officeLocation;
  return {
    name: entry.fullName,
    email: entry.email || undefined,
    office: entry.office || undefined,
    title: entry.title || undefined,
    chamber: entry.chamber || undefined,
    state: entry.state || undefined,
    district: entry.district || undefined,
    party: entry.partyName || undefined,
    directoryContactId: entry.id,
    directoryContactName: entry.fullName,
    committee: entry.committees[0] || undefined,
    address: formattedAddress || undefined,
    relevanceReason: [entry.committees[0], entry.focusAreas[0]].filter(Boolean).join(' | '),
  };
}

function stafferRecipient(
  entry: DirectoryEntry,
  staffer: DirectoryEntry['staff'][number],
): OutreachRecipient {
  return {
    name: staffer.fullName,
    email: staffer.email || undefined,
    office: entry.office || undefined,
    title: staffer.title || undefined,
    chamber: entry.chamber || undefined,
    state: entry.state || undefined,
    district: entry.district || undefined,
    party: entry.partyName || undefined,
    directoryContactId: `${entry.id}:${staffer.id}`,
    directoryContactName: `${staffer.fullName} (${entry.memberName})`,
    committee: entry.committees[0] || undefined,
    relevanceReason: `Staffer to ${entry.fullName}${staffer.title ? `, ${staffer.title}` : ''}`,
  };
}

function clientPersonRecipient(client: Client, person: ClientPerson): OutreachRecipient {
  return {
    id: `clientperson:${person.id}`,
    clientId: client.id,
    name: person.name,
    email: person.email || undefined,
    title: person.title || undefined,
    sourceLabel: client.name,
    relevanceReason: person.role ? `${person.role} — ${client.name}` : `Contact at ${client.name}`,
  };
}

function clientIndustry(client: Client): string {
  return (
    client.sectorTag || client.intakeData?.sectors?.[0] || client.intakeData?.sector || 'Client'
  );
}

// Per the boards: list members read as direct sends, so they tag "In To"
// like individuals; only group membership gets its own (amber) tag.
const MEMBERSHIP_TAG: Record<TargetType, { text: string; cls: string }> = {
  individual: { text: 'In To', cls: 'to' },
  list: { text: 'In To', cls: 'to' },
  group: { text: 'In Group', cls: 'group' },
};

// =====================================================================
// Main step
// =====================================================================

export function StepRecipientsSelect({ clients, targets, globalCc, globalBcc, onChange }: Props) {
  const api = useApi();
  const qc = useQueryClient();
  const { message, notification } = App.useApp();
  const [tab, setTab] = useState<SourceTab>('congress');
  const [builder, setBuilder] = useState<AudienceBuilderState | null>(null);
  const [saveListOpen, setSaveListOpen] = useState(false);
  const [saveListName, setSaveListName] = useState('');
  // Controlled because clicks inside custom dropdownRender content don't
  // auto-close an antd Dropdown — it must be dismissed when an action is
  // taken so it doesn't float over the build banner / applied chips.
  const [listsOpen, setListsOpen] = useState(false);
  const total = totalRecipients(targets);

  const setTargets = (next: OutreachTarget[]) => onChange({ targets: next });

  // Groups (boards 7 & 8) — saved/reusable amber audiences, kind:'group'.
  // The hook owns the saved-groups query, the save mutation, and the three
  // rendered pieces below; the build-mode selection is shared with Lists.
  const { groupsPopover, groupBuildBanner, saveGroupModal, groupsOpen, setGroupsOpen } = useGroups({
    targets,
    setTargets,
    builder,
    setBuilder,
  });

  const addIndividual = (r: OutreachRecipient) => {
    if (membershipOf(targets, recipientKey(r))) return;
    setTargets([...targets, individualTarget(r)]);
  };

  const removeIndividualByKey = (key: string) => {
    setTargets(
      targets.filter(
        (t) => !(t.type === 'individual' && t.recipients.some((r) => recipientKey(r) === key)),
      ),
    );
  };

  // Checkbox click while building a list/group: toggle membership in the
  // in-progress selection. (+ keeps adding straight to To during build mode.)
  const builderToggle = (r: OutreachRecipient) => {
    if (!builder) return;
    const key = recipientKey(r);
    setBuilder({
      ...builder,
      members: builder.members.some((m) => recipientKey(m) === key)
        ? builder.members.filter((m) => recipientKey(m) !== key)
        : [...builder.members, r],
    });
  };

  // Manual Add routes here. An explicit "Add" button must never act as a
  // toggle — re-submitting an email already in the selection replaces that
  // entry (picking up e.g. a corrected name) instead of silently removing it.
  const pickPerson = (r: OutreachRecipient) => {
    if (builder) {
      const key = recipientKey(r);
      if (builder.members.some((m) => recipientKey(m) === key)) {
        setBuilder({
          ...builder,
          members: builder.members.map((m) => (recipientKey(m) === key ? r : m)),
        });
        message.info('Already in your selection — entry updated.');
        return;
      }
      builderToggle(r);
      return;
    }
    addIndividual(r);
  };

  const builderHas = (key: string) =>
    !!builder && builder.members.some((m) => recipientKey(m) === key);

  // ---- saved lists (user-level contact library) ----
  const audiences = useQuery<AudienceRow[]>({
    queryKey: ['outreach-audiences', 'list'],
    queryFn: async () =>
      (
        await api.get<AudienceRow[]>('/api/engagement/outreach/audiences', {
          params: { kind: 'list' },
        })
      ).data,
  });

  // Apply a saved list to the campaign as a List target. People already in
  // the campaign are skipped (a person in two targets would silently lose
  // their list cc/bcc in the flattened projection — first occurrence wins).
  const applyAudience = (audience: AudienceRow, currentTargets: OutreachTarget[]) => {
    const incoming = audience.members.map(audienceMemberToRecipient);
    const fresh = incoming.filter((r) => !membershipOf(currentTargets, recipientKey(r)));
    const skipped = incoming.length - fresh.length;
    if (fresh.length === 0) {
      message.info('Everyone in this list is already in the campaign.');
      return;
    }
    setTargets([
      ...currentTargets,
      {
        key: newTargetKey(),
        type: 'list',
        audienceId: audience.id,
        name: audience.name,
        recipients: fresh,
        cc: [],
        bcc: [],
        memberCc: {},
        memberBcc: {},
      },
    ]);
    setListsOpen(false);
    if (skipped > 0) {
      message.info(
        `${skipped} ${skipped === 1 ? 'contact was' : 'contacts were'} already in the campaign and skipped.`,
      );
    }
  };

  // Save the build-mode selection to the user's contact library, then apply
  // it to this campaign (board 5d: saved lists land in the selected panel).
  // Members are pre-filtered with EMAIL_RE because the API validates every
  // member with @IsEmail and one bad address would 400 the whole save.
  const saveList = useMutation({
    mutationFn: async (vars: { name: string; members: OutreachRecipient[] }) => {
      const emailable = vars.members.filter((m) => m.email && EMAIL_RE.test(m.email));
      const res = await api.post<AudienceRow>('/api/engagement/outreach/audiences', {
        kind: 'list',
        name: vars.name,
        members: emailable.map(toAudienceMemberInput),
      });
      return { audience: res.data, skippedNoEmail: vars.members.length - emailable.length };
    },
    onSuccess: ({ audience, skippedNoEmail }) => {
      qc.invalidateQueries({ queryKey: ['outreach-audiences'] });
      notification.success({
        message: 'List saved',
        description: `${audience.name} — ${plural(audience.members.length, 'contact')}`,
        placement: 'topRight',
      });
      if (skippedNoEmail > 0) {
        message.warning(
          `${plural(skippedNoEmail, 'contact')} without a usable email address ${skippedNoEmail === 1 ? 'was' : 'were'} not saved.`,
        );
      }
      applyAudience(audience, targets);
      setBuilder(null);
      setSaveListOpen(false);
      setSaveListName('');
    },
    onError: (err) => message.error(apiErrorMessage(err) ?? 'Could not save the list'),
  });

  const listTargets = targets.filter((t) => t.type === 'list');

  // Only members with a sendable email can be persisted to a saved list (the
  // API requires + validates email on every member).
  const emailableCount = builder
    ? builder.members.filter((m) => m.email && EMAIL_RE.test(m.email)).length
    : 0;
  const unsavableCount = (builder?.members.length ?? 0) - emailableCount;

  // Build-mode banner, rendered under the active tab's toolbar. Lists get the
  // blue bar (board 5b); groups get the amber bar from useGroups (board 7b).
  const builderBanner: ReactNode =
    builder?.kind === 'list' ? (
      <div className="ov2-rs-buildbar">
        <span className="count">
          {builder.members.length} {builder.members.length === 1 ? 'member' : 'members'} selected
        </span>
        <span className="spacer" />
        <button
          type="button"
          className="save"
          disabled={builder.members.length === 0}
          onClick={() => {
            setSaveListName('');
            setSaveListOpen(true);
          }}
        >
          Save selection as list
        </button>
        <button type="button" className="cancel" onClick={() => setBuilder(null)}>
          Cancel
        </button>
      </div>
    ) : (
      groupBuildBanner
    );

  // Lists popover (board 6a): create-new entry point + the user's saved
  // lists from their contact library, each applyable to this campaign.
  const listsPopover: ReactNode = (
    <div className="ov2-rs-lists-pop">
      <button
        type="button"
        className="create"
        onClick={() => {
          setBuilder({ kind: 'list', name: '', members: [] });
          setListsOpen(false);
        }}
      >
        <span className="plus">
          <PlusOutlined />
        </span>
        Create new list
      </button>
      <div className="sec">Saved lists</div>
      {audiences.isLoading ? (
        <div className="empty">Loading your lists…</div>
      ) : (audiences.data ?? []).length === 0 ? (
        <div className="empty">No saved lists yet</div>
      ) : (
        (audiences.data ?? []).map((audience) => {
          const applied = targets.some((t) => t.audienceId === audience.id);
          return (
            <div key={audience.id} className="row">
              <div className="info">
                <b>{audience.name}</b>
                <small>
                  {audience.members.length} {audience.members.length === 1 ? 'contact' : 'contacts'}
                </small>
              </div>
              <Button
                size="small"
                disabled={applied}
                onClick={() => applyAudience(audience, targets)}
              >
                {applied ? 'Added' : '+ Add'}
              </Button>
            </div>
          );
        })
      )}
    </div>
  );

  // Applied-list chips under the toolbar (board 5d).
  const appliedChips: ReactNode = listTargets.length ? (
    <div className="ov2-rs-chips-row">
      {listTargets.map((t) => (
        <span key={t.key} className="ov2-rs-applied-chip">
          <UnorderedListOutlined /> {t.name} ({t.recipients.length})
          <button
            type="button"
            onClick={() => setTargets(targets.filter((x) => x.key !== t.key))}
            aria-label={`Remove ${t.name ?? 'list'} from this campaign`}
          >
            <CloseOutlined />
          </button>
        </span>
      ))}
      <span className="meta">
        {total} {total === 1 ? 'recipient' : 'recipients'} selected
      </span>
    </div>
  ) : null;

  return (
    <div>
      <h2>
        Select recipients
        {total > 0 && (
          <Badge
            count={total}
            style={{ backgroundColor: 'var(--ov2-accent-ink)', marginLeft: 8 }}
          />
        )}
      </h2>
      <div className="ov2-pane-sub">
        Choose congressional offices, staffers, committee contacts, or clients to receive this
        campaign.
      </div>

      {targets.length > 0 && <SelectedPanel targets={targets} onTargets={setTargets} />}

      {targets.length > 0 && (
        <div className="ov2-rs-global">
          <div className="ov2-rs-copy-row">
            <span className="label">Global Cc</span>
            <ChipsInput
              value={globalCc}
              onChange={(v) => onChange({ globalCc: v })}
              placeholder="Add to all sends…"
            />
            <span className="hint">Added to every recipient's email</span>
          </div>
          <div className="ov2-rs-copy-row">
            <span className="label">Global Bcc</span>
            <ChipsInput
              value={globalBcc}
              onChange={(v) => onChange({ globalBcc: v })}
              placeholder="Add to all sends…"
            />
            <span className="hint">Added to every recipient's email</span>
          </div>
        </div>
      )}

      <div className="ov2-rs-tabs">
        <button
          type="button"
          className={'ov2-rs-tab' + (tab === 'congress' ? ' active' : '')}
          onClick={() => setTab('congress')}
        >
          Congressional Directory
        </button>
        <button
          type="button"
          className={'ov2-rs-tab' + (tab === 'clients' ? ' active' : '')}
          onClick={() => setTab('clients')}
        >
          Client Contacts
        </button>
        <button
          type="button"
          className={'ov2-rs-tab' + (tab === 'manual' ? ' active' : '')}
          onClick={() => setTab('manual')}
        >
          Manual Add
        </button>
      </div>

      {tab === 'congress' && (
        <CongressTab
          targets={targets}
          builderKind={builder?.kind ?? null}
          builderHas={builderHas}
          onBuilderToggle={builderToggle}
          onAdd={addIndividual}
          onRemoveIndividual={removeIndividualByKey}
          listsPopover={listsPopover}
          listsOpen={listsOpen}
          onListsOpenChange={setListsOpen}
          groupsPopover={groupsPopover}
          groupsOpen={groupsOpen}
          onGroupsOpenChange={setGroupsOpen}
          builderBanner={builderBanner}
          appliedChips={appliedChips}
        />
      )}
      {tab === 'clients' && (
        <ClientsTab
          clients={clients}
          targets={targets}
          builderKind={builder?.kind ?? null}
          builderHas={builderHas}
          onBuilderToggle={builderToggle}
          onAdd={addIndividual}
          onRemoveIndividual={removeIndividualByKey}
          listsPopover={listsPopover}
          listsOpen={listsOpen}
          onListsOpenChange={setListsOpen}
          groupsPopover={groupsPopover}
          groupsOpen={groupsOpen}
          onGroupsOpenChange={setGroupsOpen}
          builderBanner={builderBanner}
          appliedChips={appliedChips}
        />
      )}
      {tab === 'manual' && (
        <ManualTab
          onAdd={pickPerson}
          builderKind={builder?.kind ?? null}
          builderBanner={builderBanner}
        />
      )}

      <Modal
        title="Save as contact list"
        open={saveListOpen}
        // No dismissal while the POST is in flight: the mutation would still
        // complete and apply the list to the campaign after a "cancel".
        closable={!saveList.isPending}
        maskClosable={!saveList.isPending}
        onCancel={() => !saveList.isPending && setSaveListOpen(false)}
        footer={[
          <Button key="cancel" disabled={saveList.isPending} onClick={() => setSaveListOpen(false)}>
            Cancel
          </Button>,
          <Button
            key="save"
            type="primary"
            loading={saveList.isPending}
            disabled={!saveListName.trim() || emailableCount === 0}
            onClick={() =>
              builder && saveList.mutate({ name: saveListName.trim(), members: builder.members })
            }
          >
            Save list
          </Button>,
        ]}
      >
        <p style={{ marginTop: 8 }}>
          This will save your {plural(builder?.members.length ?? 0, 'selected recipient')} as a
          reusable list.
        </p>
        {unsavableCount > 0 && (
          <p style={{ marginTop: 0, fontSize: 12, color: 'var(--ov2-notable)' }}>
            {emailableCount === 0
              ? 'None of the selected contacts have a usable email address — add at least one with an email before saving.'
              : `${plural(unsavableCount, 'contact')} without a usable email address will be left out.`}
          </p>
        )}
        <Input
          autoFocus
          placeholder="e.g. HASC staffers Q3"
          value={saveListName}
          onChange={(e) => setSaveListName(e.target.value)}
          onPressEnter={() => {
            if (saveListName.trim() && builder && emailableCount > 0 && !saveList.isPending) {
              saveList.mutate({ name: saveListName.trim(), members: builder.members });
            }
          }}
        />
        <p style={{ marginTop: 8, marginBottom: 0, fontSize: 12, color: 'var(--ov2-ink-3)' }}>
          Lists are saved to your individual contact library and can be reused across campaigns.
        </p>
      </Modal>

      {saveGroupModal}
    </div>
  );
}

// =====================================================================
// Selected-recipients panel: Individuals first, then Lists, then Groups.
// =====================================================================

function SelectedPanel({
  targets,
  onTargets,
}: {
  targets: OutreachTarget[];
  onTargets: (next: OutreachTarget[]) => void;
}) {
  const update = (key: string, patch: Partial<OutreachTarget>) =>
    onTargets(targets.map((t) => (t.key === key ? { ...t, ...patch } : t)));
  const remove = (key: string) => onTargets(targets.filter((t) => t.key !== key));

  const ordered = [
    ...targets.filter((t) => t.type === 'individual'),
    ...targets.filter((t) => t.type === 'list'),
    ...targets.filter((t) => t.type === 'group'),
  ];

  return (
    <div className="ov2-rs-panel">
      {ordered.map((t) =>
        t.type === 'individual' ? (
          <IndividualEntity
            key={t.key}
            target={t}
            onUpdate={(patch) => update(t.key, patch)}
            onRemove={() => remove(t.key)}
          />
        ) : t.type === 'list' ? (
          <ListEntity
            key={t.key}
            target={t}
            onUpdate={(patch) => update(t.key, patch)}
            onRemove={() => remove(t.key)}
          />
        ) : (
          <GroupEntity
            key={t.key}
            target={t}
            onUpdate={(patch) => update(t.key, patch)}
            onRemove={() => remove(t.key)}
          />
        ),
      )}
    </div>
  );
}

function IndividualEntity({
  target,
  onUpdate,
  onRemove,
}: {
  target: OutreachTarget;
  onUpdate: (patch: Partial<OutreachTarget>) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(target.cc.length + target.bcc.length > 0);
  const r = target.recipients[0];
  if (!r) return null;
  return (
    <div className="ov2-rs-entity">
      <div className="ov2-rs-entity-head">
        <span className="ov2-rs-type-badge individual">
          <UserOutlined /> Individual
        </span>
        <span className="name">{r.name || r.email || 'Recipient'}</span>
        {r.email && <span className="email">{r.email}</span>}
        <span className="note">This person receives an individual email</span>
        <span className="spacer" />
        <button type="button" className="ov2-rs-ccbcc-btn" onClick={() => setOpen((o) => !o)}>
          {open ? 'Hide Cc/Bcc' : 'Add Cc/Bcc'}
        </button>
        <button type="button" className="ov2-rs-remove" onClick={onRemove} aria-label="Remove">
          <CloseOutlined />
        </button>
      </div>
      {open && (
        <div className="ov2-rs-copy-rows">
          <div className="ov2-rs-copy-row">
            <span className="label">Cc</span>
            <ChipsInput
              value={target.cc}
              onChange={(v) => onUpdate({ cc: v })}
              placeholder="Add Cc…"
            />
          </div>
          <div className="ov2-rs-copy-row">
            <span className="label">Bcc</span>
            <ChipsInput
              value={target.bcc}
              onChange={(v) => onUpdate({ bcc: v })}
              placeholder="Add Bcc…"
            />
          </div>
        </div>
      )}
    </div>
  );
}

function ListEntity({
  target,
  onUpdate,
  onRemove,
}: {
  target: OutreachTarget;
  onUpdate: (patch: Partial<OutreachTarget>) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(true);
  const [copyFor, setCopyFor] = useState<string | null>(null);

  const dropMember = (key: string) => {
    const recipients = target.recipients.filter((r) => recipientKey(r) !== key);
    if (recipients.length === 0) {
      onRemove();
      return;
    }
    const { [key]: _cc, ...memberCc } = target.memberCc ?? {};
    const { [key]: _bcc, ...memberBcc } = target.memberBcc ?? {};
    onUpdate({ recipients, memberCc, memberBcc });
  };

  return (
    <div className="ov2-rs-entity list">
      <div className="ov2-rs-entity-head">
        <button
          type="button"
          className="ov2-rs-caret"
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? 'Collapse list' : 'Expand list'}
        >
          {open ? <DownOutlined /> : <RightOutlined />}
        </button>
        <span className="ov2-rs-type-badge list">
          <UnorderedListOutlined /> List
        </span>
        <span className="name">{target.name || 'Untitled list'}</span>
        <span className="count">· {plural(target.recipients.length, 'contact')}</span>
        <span className="spacer" />
        <span className="note blue">
          <UserOutlined /> Each emailed individually
        </span>
        <button type="button" className="ov2-rs-remove" onClick={onRemove} aria-label="Remove list">
          <CloseOutlined />
        </button>
      </div>
      {open && (
        <div className="ov2-rs-members">
          {target.recipients.map((r) => {
            const key = recipientKey(r);
            const memberCc = target.memberCc?.[key] ?? [];
            const memberBcc = target.memberBcc?.[key] ?? [];
            const copyOpen = copyFor === key;
            return (
              <div key={key}>
                <div className="ov2-rs-member">
                  <span className="bullet">•</span>
                  <span className="name">{r.name || r.email}</span>
                  {r.email && <span className="email">{r.email}</span>}
                  <span className="spacer" />
                  <span className="ov2-rs-member-tag">Individual send</span>
                  <button
                    type="button"
                    className="ccbcc"
                    onClick={() => setCopyFor(copyOpen ? null : key)}
                  >
                    Cc/Bcc
                  </button>
                  <button
                    type="button"
                    className="ov2-rs-remove small"
                    onClick={() => dropMember(key)}
                    aria-label="Drop from this campaign"
                  >
                    <CloseOutlined />
                  </button>
                </div>
                {copyOpen && (
                  <div className="ov2-rs-copy-rows">
                    <div className="ov2-rs-copy-row">
                      <span className="label">Cc</span>
                      <ChipsInput
                        value={memberCc}
                        onChange={(v) =>
                          onUpdate({ memberCc: { ...(target.memberCc ?? {}), [key]: v } })
                        }
                        placeholder="Add Cc for this member…"
                      />
                      <span className="hint">Copied on this member's email only</span>
                    </div>
                    <div className="ov2-rs-copy-row">
                      <span className="label">Bcc</span>
                      <ChipsInput
                        value={memberBcc}
                        onChange={(v) =>
                          onUpdate({ memberBcc: { ...(target.memberBcc ?? {}), [key]: v } })
                        }
                        placeholder="Add Bcc for this member…"
                      />
                      <span className="hint">Copied on this member's email only</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function GroupEntity({
  target,
  onUpdate,
  onRemove,
}: {
  target: OutreachTarget;
  onUpdate: (patch: Partial<OutreachTarget>) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(true);
  const [copyOpen, setCopyOpen] = useState(target.cc.length + target.bcc.length > 0);

  const dropMember = (key: string) => {
    const recipients = target.recipients.filter((r) => recipientKey(r) !== key);
    if (recipients.length === 0) {
      onRemove();
      return;
    }
    onUpdate({ recipients });
  };

  return (
    <div className="ov2-rs-entity group">
      <div className="ov2-rs-entity-head">
        <button
          type="button"
          className="ov2-rs-caret"
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? 'Collapse group' : 'Expand group'}
        >
          {open ? <DownOutlined /> : <RightOutlined />}
        </button>
        <span className="ov2-rs-type-badge group">
          <TeamOutlined /> Group
        </span>
        <span className="name">{target.name || 'Untitled group'}</span>
        <span className="count">· {plural(target.recipients.length, 'contact')}</span>
        <span className="note amber">This group receives 1 email together</span>
        <span className="spacer" />
        <button
          type="button"
          className="ov2-rs-ccbcc-btn amber"
          onClick={() => setCopyOpen((o) => !o)}
        >
          {copyOpen ? 'Hide Cc/Bcc' : 'Add Cc/Bcc'}
        </button>
        <button
          type="button"
          className="ov2-rs-remove"
          onClick={onRemove}
          aria-label="Remove group"
        >
          <CloseOutlined />
        </button>
      </div>
      {copyOpen && (
        <div className="ov2-rs-copy-rows">
          <div className="ov2-rs-copy-row">
            <span className="label amber">Global Cc</span>
            <ChipsInput
              value={target.cc}
              onChange={(v) => onUpdate({ cc: v })}
              placeholder="Add Cc to all group sends…"
            />
            <span className="hint">Copied on this group's email</span>
          </div>
          <div className="ov2-rs-copy-row">
            <span className="label amber">Global Bcc</span>
            <ChipsInput
              value={target.bcc}
              onChange={(v) => onUpdate({ bcc: v })}
              placeholder="Add Bcc to all group sends…"
            />
            <span className="hint">Copied on this group's email</span>
          </div>
        </div>
      )}
      {open && (
        <div className="ov2-rs-members">
          {target.recipients.map((r) => {
            const key = recipientKey(r);
            return (
              <div key={key} className="ov2-rs-member">
                <span className="bullet">•</span>
                <span className="name">{r.name || r.email}</span>
                {r.email && <span className="email">{r.email}</span>}
                <span className="spacer" />
                <button
                  type="button"
                  className="ov2-rs-remove small"
                  onClick={() => dropMember(key)}
                  aria-label="Drop from this group's send"
                >
                  <CloseOutlined />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Chips + inline input for Cc/Bcc emails. Commits on Enter / comma / blur;
// only syntactically valid emails are kept so send-batch (which validates
// every address) can't 400 on bad input.
function ChipsInput({
  value,
  onChange,
  placeholder,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
}) {
  const [draft, setDraft] = useState('');
  const commit = () => {
    const v = draft.trim().toLowerCase();
    if (!EMAIL_RE.test(v)) return;
    if (!value.includes(v)) onChange([...value, v]);
    setDraft('');
  };
  return (
    <div className="ov2-rs-chips">
      {value.map((email) => (
        <span key={email} className="ov2-rs-chip">
          <span>{email}</span>
          <button
            type="button"
            onClick={() => onChange(value.filter((x) => x !== email))}
            aria-label={`Remove ${email}`}
          >
            <CloseOutlined />
          </button>
        </span>
      ))}
      <input
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Backspace' && !draft && value.length) {
            onChange(value.slice(0, -1));
          }
        }}
      />
    </div>
  );
}

// =====================================================================
// Tab 1 — Congressional Directory
// =====================================================================

function CongressTab({
  targets,
  builderKind,
  builderHas,
  onBuilderToggle,
  onAdd,
  onRemoveIndividual,
  listsPopover,
  listsOpen,
  onListsOpenChange,
  groupsPopover,
  groupsOpen,
  onGroupsOpenChange,
  builderBanner,
  appliedChips,
}: {
  targets: OutreachTarget[];
  builderKind: 'list' | 'group' | null;
  builderHas: (key: string) => boolean;
  onBuilderToggle: (r: OutreachRecipient) => void;
  onAdd: (r: OutreachRecipient) => void;
  onRemoveIndividual: (key: string) => void;
  listsPopover: ReactNode;
  listsOpen: boolean;
  onListsOpenChange: (open: boolean) => void;
  groupsPopover: ReactNode;
  groupsOpen: boolean;
  onGroupsOpenChange: (open: boolean) => void;
  builderBanner: ReactNode;
  appliedChips: ReactNode;
}) {
  const api = useApi();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [stateFilter, setStateFilter] = useState<string | undefined>();
  const [chamberFilter, setChamberFilter] = useState<string | undefined>();
  const [favOnly, setFavOnly] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    const timer = setTimeout(() => setQ(search), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const dir = useQuery<DirectoryApiResponse>({
    queryKey: ['ov2-rs-directory', q, stateFilter ?? '', chamberFilter ?? ''],
    queryFn: async () =>
      (
        await api.get<DirectoryApiResponse>('/api/directory/contacts', {
          params: {
            q: q || undefined,
            state: stateFilter,
            chamber: chamberFilter,
            pageSize: 50,
            // Always A–Z: omitting sort makes the backend default to
            // 'recent' (lastTouchpoint), which reads as arbitrary ordering.
            sort: 'name-asc',
          },
        })
      ).data,
  });

  const favorites = useQuery<FavoriteRow[]>({
    queryKey: ['directory-favorites'],
    queryFn: async () => (await api.get<FavoriteRow[]>('/api/directory/favorites')).data,
  });
  // The favorites store is shared with the Client Contacts tab (which writes
  // namespaced `clientperson:` ids) — exclude those here so the (n) count and
  // the favorites filter only reflect directory members/staffers.
  const favSet = useMemo(
    () =>
      new Set(
        (favorites.data ?? [])
          .filter((f) => !f.directoryContactId.startsWith('clientperson:'))
          .map((f) => f.directoryContactId),
      ),
    [favorites.data],
  );
  const toggleFavorite = useMutation({
    mutationFn: async (vars: { id: string; name: string; favorited: boolean }) =>
      vars.favorited
        ? (await api.delete(`/api/directory/contacts/${encodeURIComponent(vars.id)}/favorite`)).data
        : (
            await api.post(`/api/directory/contacts/${encodeURIComponent(vars.id)}/favorite`, {
              directoryContactName: vars.name,
            })
          ).data,
    onSettled: () => qc.invalidateQueries({ queryKey: ['directory-favorites'] }),
  });

  const rows = (dir.data?.contacts ?? []).filter((e) => !favOnly || favSet.has(e.id));
  const states = dir.data?.availableStates ?? [];
  const chambers = dir.data?.availableFilters.chambers ?? [];

  const toggleExpand = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div>
      <div className="ov2-rs-toolbar">
        <Input
          className="search"
          allowClear
          prefix={<SearchOutlined />}
          placeholder="Search members and staffers…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select
          allowClear
          placeholder="State"
          style={{ width: 100 }}
          value={stateFilter}
          onChange={(v) => setStateFilter(v)}
          options={states.map((s) => ({ value: s, label: s }))}
          showSearch
        />
        <Select
          allowClear
          placeholder="Chamber"
          style={{ width: 120 }}
          value={chamberFilter}
          onChange={(v) => setChamberFilter(v)}
          options={chambers.map((c) => ({ value: c, label: c }))}
        />
        <button
          type="button"
          className={'ov2-rs-toolbar-btn' + (favOnly ? ' fav-on' : '')}
          onClick={() => setFavOnly((f) => !f)}
        >
          {favOnly ? <StarFilled /> : <StarOutlined />} Favorites ({favSet.size})
        </button>
        <Dropdown
          dropdownRender={() => <>{listsPopover}</>}
          trigger={['click']}
          open={listsOpen}
          onOpenChange={onListsOpenChange}
        >
          <button type="button" className="ov2-rs-toolbar-btn lists">
            <UnorderedListOutlined /> Lists <DownOutlined style={{ fontSize: 10 }} />
          </button>
        </Dropdown>
        <Dropdown
          dropdownRender={() => <>{groupsPopover}</>}
          trigger={['click']}
          open={groupsOpen}
          onOpenChange={onGroupsOpenChange}
        >
          <button type="button" className="ov2-rs-toolbar-btn groups">
            <TeamOutlined /> Groups <DownOutlined style={{ fontSize: 10 }} />
          </button>
        </Dropdown>
      </div>
      {builderBanner}
      {appliedChips}
      <div className="ov2-rs-hint">
        {builderKind === 'group'
          ? 'Check members to include in the group. All checked recipients will receive one email together.'
          : builderKind === 'list'
            ? 'Check members and staffers to include them in the list. Click + to add to a field instead.'
            : 'Showing the directory A–Z. Click + on any member or staffer to add them to To. Use the caret to expand staffers.'}
      </div>

      <div className="ov2-rs-table">
        <div className="ov2-rs-thead congress">
          <span />
          <span>Name</span>
          <span>Office</span>
          <span>Committee</span>
          <span>State</span>
          <span>Party</span>
          <span />
        </div>
        <div className="ov2-rs-rows">
          {dir.isLoading ? (
            <div className="ov2-rs-empty">Loading the directory…</div>
          ) : rows.length === 0 ? (
            <div className="ov2-rs-empty">
              {favOnly
                ? 'No favorites in the current results. Star members to find them faster.'
                : 'No members match. Try a different search or filter.'}
            </div>
          ) : (
            rows.map((entry) => (
              <MemberRows
                key={entry.id}
                entry={entry}
                targets={targets}
                expanded={expanded.has(entry.id)}
                onToggleExpand={() => toggleExpand(entry.id)}
                favorited={favSet.has(entry.id)}
                onToggleFavorite={() =>
                  toggleFavorite.mutate({
                    id: entry.id,
                    name: entry.fullName,
                    favorited: favSet.has(entry.id),
                  })
                }
                builderKind={builderKind}
                builderHas={builderHas}
                onBuilderToggle={onBuilderToggle}
                onAdd={onAdd}
                onRemoveIndividual={onRemoveIndividual}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function AddControl({
  recipient,
  targets,
  builderKind,
  builderHas,
  onBuilderToggle,
  onAdd,
  onRemoveIndividual,
}: {
  recipient: OutreachRecipient;
  targets: OutreachTarget[];
  builderKind: 'list' | 'group' | null;
  builderHas: (key: string) => boolean;
  onBuilderToggle: (r: OutreachRecipient) => void;
  onAdd: (r: OutreachRecipient) => void;
  onRemoveIndividual: (key: string) => void;
}) {
  const key = recipientKey(recipient);
  const membership = membershipOf(targets, key);
  const addButton = membership ? (
    <button
      type="button"
      className="ov2-rs-add added"
      title={
        membership === 'individual'
          ? 'Added to To — click to remove'
          : 'Already in a list or group — manage it in the panel above'
      }
      onClick={() => membership === 'individual' && onRemoveIndividual(key)}
      aria-label="Added"
    >
      <CheckOutlined />
    </button>
  ) : (
    <button
      type="button"
      className="ov2-rs-add"
      onClick={() => onAdd(recipient)}
      aria-label="Add to To"
    >
      <PlusOutlined />
    </button>
  );
  if (builderKind) {
    // Build mode: the checkbox collects people into the new list/group.
    // Lists (board 5b) keep + alongside so you can still add straight to To;
    // groups (board 7b) hide + — checked rows tint amber and the checkbox is
    // amber — because a group is built only from the checked set.
    return (
      <>
        <Checkbox
          className={'ov2-rs-checkbox' + (builderKind === 'group' ? ' amber' : '')}
          checked={builderHas(key)}
          onChange={() => onBuilderToggle(recipient)}
        />
        {builderKind === 'group' ? null : addButton}
      </>
    );
  }
  return addButton;
}

function MemberRows({
  entry,
  targets,
  expanded,
  onToggleExpand,
  favorited,
  onToggleFavorite,
  builderKind,
  builderHas,
  onBuilderToggle,
  onAdd,
  onRemoveIndividual,
}: {
  entry: DirectoryEntry;
  targets: OutreachTarget[];
  expanded: boolean;
  onToggleExpand: () => void;
  favorited: boolean;
  onToggleFavorite: () => void;
  builderKind: 'list' | 'group' | null;
  builderHas: (key: string) => boolean;
  onBuilderToggle: (r: OutreachRecipient) => void;
  onAdd: (r: OutreachRecipient) => void;
  onRemoveIndividual: (key: string) => void;
}) {
  const recipient = fromDirectoryEntry(entry);
  const membership = membershipOf(targets, recipientKey(recipient));
  const tag = membership ? MEMBERSHIP_TAG[membership] : null;
  const role = entry.leadershipPositions[0] || entry.title;
  // While building a group, a checked row tints amber (board 7b).
  const groupChecked = builderKind === 'group' && builderHas(recipientKey(recipient));

  return (
    <>
      <div
        className={
          'ov2-rs-row congress' +
          (membership ? ' added' : '') +
          (groupChecked ? ' group-checked' : '')
        }
      >
        <span className="controls">
          <button
            type="button"
            className="ov2-rs-caret"
            onClick={onToggleExpand}
            aria-label={expanded ? 'Collapse staffers' : 'Expand staffers'}
          >
            {expanded ? <DownOutlined /> : <RightOutlined />}
          </button>
          <AddControl
            recipient={recipient}
            targets={targets}
            builderKind={builderKind}
            builderHas={builderHas}
            onBuilderToggle={onBuilderToggle}
            onAdd={onAdd}
            onRemoveIndividual={onRemoveIndividual}
          />
          <button
            type="button"
            className={'ov2-rs-star' + (favorited ? ' on' : '')}
            onClick={onToggleFavorite}
            aria-label={favorited ? 'Remove from favorites' : 'Add to favorites'}
          >
            {favorited ? <StarFilled /> : <StarOutlined />}
          </button>
        </span>
        <span className="who">
          <div className="nm">{entry.fullName}</div>
          <div className="sub">{role}</div>
        </span>
        <span className="ov2-rs-cell" title={entry.office}>
          {entry.office || '—'}
        </span>
        <span className="ov2-rs-cell" title={entry.committees.join(', ')}>
          {entry.committees[0] || '—'}
        </span>
        <span className="ov2-rs-cell">{entry.state}</span>
        <span>
          <span className={'ov2-rs-pill' + (entry.partyName === 'Republican' ? ' republican' : '')}>
            {entry.partyName}
          </span>
        </span>
        {tag ? <span className={`ov2-rs-intag ${tag.cls}`}>{tag.text}</span> : <span />}
      </div>
      {expanded &&
        (entry.staff.length === 0 ? (
          <div className="ov2-rs-row congress sub">
            <span />
            <span className="who">
              <div className="sub">No staffer contacts synced for this office.</div>
            </span>
            <span />
            <span />
            <span />
            <span />
            <span />
          </div>
        ) : (
          entry.staff.map((staffer) => {
            const sr = stafferRecipient(entry, staffer);
            const sMembership = membershipOf(targets, recipientKey(sr));
            const sTag = sMembership ? MEMBERSHIP_TAG[sMembership] : null;
            const sGroupChecked = builderKind === 'group' && builderHas(recipientKey(sr));
            return (
              <div
                key={staffer.id}
                className={
                  'ov2-rs-row congress sub' +
                  (sMembership ? ' added' : '') +
                  (sGroupChecked ? ' group-checked' : '')
                }
              >
                <span className="controls" style={{ paddingLeft: 26 }}>
                  <AddControl
                    recipient={sr}
                    targets={targets}
                    builderKind={builderKind}
                    builderHas={builderHas}
                    onBuilderToggle={onBuilderToggle}
                    onAdd={onAdd}
                    onRemoveIndividual={onRemoveIndividual}
                  />
                </span>
                <span className="who">
                  <div className="nm">{staffer.fullName}</div>
                  <div className="sub">{staffer.title || 'Staffer'}</div>
                </span>
                <span className="ov2-rs-cell">{entry.office || '—'}</span>
                <span className="ov2-rs-cell">{staffer.issueAreas[0] || '—'}</span>
                <span className="ov2-rs-cell">{entry.state}</span>
                <span />
                {sTag ? <span className={`ov2-rs-intag ${sTag.cls}`}>{sTag.text}</span> : <span />}
              </div>
            );
          })
        ))}
    </>
  );
}

// =====================================================================
// Tab 2 — Client Contacts (derived view over clients + their people)
// =====================================================================

function ClientsTab({
  clients,
  targets,
  builderKind,
  builderHas,
  onBuilderToggle,
  onAdd,
  onRemoveIndividual,
  listsPopover,
  listsOpen,
  onListsOpenChange,
  groupsPopover,
  groupsOpen,
  onGroupsOpenChange,
  builderBanner,
  appliedChips,
}: {
  clients: Client[];
  targets: OutreachTarget[];
  builderKind: 'list' | 'group' | null;
  builderHas: (key: string) => boolean;
  onBuilderToggle: (r: OutreachRecipient) => void;
  onAdd: (r: OutreachRecipient) => void;
  onRemoveIndividual: (key: string) => void;
  listsPopover: ReactNode;
  listsOpen: boolean;
  onListsOpenChange: (open: boolean) => void;
  groupsPopover: ReactNode;
  groupsOpen: boolean;
  onGroupsOpenChange: (open: boolean) => void;
  builderBanner: ReactNode;
  appliedChips: ReactNode;
}) {
  const api = useApi();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [favOnly, setFavOnly] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const peopleQueries = useQueries({
    queries: clients.map((client) => ({
      queryKey: ['ov2-rs-client-people', client.id],
      queryFn: async () => (await api.get<ClientPerson[]>(`/api/clients/${client.id}/people`)).data,
      staleTime: 60_000,
    })),
  });
  const peopleByClient = useMemo(() => {
    const map = new Map<string, ClientPerson[]>();
    clients.forEach((client, i) => map.set(client.id, peopleQueries[i]?.data ?? []));
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clients, ...peopleQueries.map((query) => query.data)]);
  const peopleLoading = peopleQueries.some((query) => query.isLoading);

  const favorites = useQuery<FavoriteRow[]>({
    queryKey: ['directory-favorites'],
    queryFn: async () => (await api.get<FavoriteRow[]>('/api/directory/favorites')).data,
  });
  const favSet = useMemo(
    () => new Set((favorites.data ?? []).map((f) => f.directoryContactId)),
    [favorites.data],
  );
  const toggleFavorite = useMutation({
    mutationFn: async (vars: { id: string; name: string; favorited: boolean }) =>
      vars.favorited
        ? (await api.delete(`/api/directory/contacts/${encodeURIComponent(vars.id)}/favorite`)).data
        : (
            await api.post(`/api/directory/contacts/${encodeURIComponent(vars.id)}/favorite`, {
              directoryContactName: vars.name,
            })
          ).data,
    onSettled: () => qc.invalidateQueries({ queryKey: ['directory-favorites'] }),
  });

  const qq = search.trim().toLowerCase();
  const visible = clients.filter((client) => {
    const people = peopleByClient.get(client.id) ?? [];
    if (favOnly && !people.some((p) => favSet.has(`clientperson:${p.id}`))) return false;
    if (!qq) return true;
    return (
      client.name.toLowerCase().includes(qq) ||
      clientIndustry(client).toLowerCase().includes(qq) ||
      people.some(
        (p) => p.name.toLowerCase().includes(qq) || (p.email ?? '').toLowerCase().includes(qq),
      )
    );
  });
  // Searching or filtering by favorites implies you want to see the matching
  // contacts, not just the client shells — expand them automatically.
  const autoExpand = Boolean(qq) || favOnly;

  const toggleExpand = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div>
      <div className="ov2-rs-toolbar">
        <Input
          className="search"
          allowClear
          prefix={<SearchOutlined />}
          placeholder="Search clients and contacts…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button
          type="button"
          className={'ov2-rs-toolbar-btn' + (favOnly ? ' fav-on' : '')}
          onClick={() => setFavOnly((f) => !f)}
        >
          {favOnly ? <StarFilled /> : <StarOutlined />} Favorites
        </button>
        <Dropdown
          dropdownRender={() => <>{listsPopover}</>}
          trigger={['click']}
          open={listsOpen}
          onOpenChange={onListsOpenChange}
        >
          <button type="button" className="ov2-rs-toolbar-btn lists">
            <UnorderedListOutlined /> Lists <DownOutlined style={{ fontSize: 10 }} />
          </button>
        </Dropdown>
        <Dropdown
          dropdownRender={() => <>{groupsPopover}</>}
          trigger={['click']}
          open={groupsOpen}
          onOpenChange={onGroupsOpenChange}
        >
          <button type="button" className="ov2-rs-toolbar-btn groups">
            <TeamOutlined /> Groups <DownOutlined style={{ fontSize: 10 }} />
          </button>
        </Dropdown>
      </div>
      {builderBanner}
      {appliedChips}
      <div className="ov2-rs-hint">
        {builderKind === 'group'
          ? 'Check contacts to include in the group. All checked recipients will receive one email together.'
          : builderKind === 'list'
            ? 'Check contacts to include them in the list. Click + to add to a field instead.'
            : 'Showing all clients A–Z. Use the caret to expand contacts. Click + to add a contact to To.'}
      </div>

      <div className="ov2-rs-table">
        <div className="ov2-rs-thead clients">
          <span />
          <span>Client / Contact</span>
          <span>Title / Role</span>
          <span>Email</span>
          <span />
        </div>
        <div className="ov2-rs-rows">
          {visible.length === 0 ? (
            <div className="ov2-rs-empty">
              {peopleLoading
                ? 'Loading client contacts…'
                : favOnly
                  ? 'No favorited client contacts yet. Star contacts to find them faster.'
                  : 'No clients match. Try a different search.'}
            </div>
          ) : (
            visible
              .slice()
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((client) => {
                const people = peopleByClient.get(client.id) ?? [];
                const isOpen = autoExpand || expanded.has(client.id);
                const shownPeople = favOnly
                  ? people.filter((p) => favSet.has(`clientperson:${p.id}`))
                  : people;
                return (
                  <ClientRows
                    key={client.id}
                    client={client}
                    people={shownPeople}
                    totalPeople={people.length}
                    loading={peopleLoading}
                    open={isOpen}
                    onToggleExpand={() => toggleExpand(client.id)}
                    targets={targets}
                    favSet={favSet}
                    onToggleFavorite={(p) =>
                      toggleFavorite.mutate({
                        id: `clientperson:${p.id}`,
                        name: p.name,
                        favorited: favSet.has(`clientperson:${p.id}`),
                      })
                    }
                    builderKind={builderKind}
                    builderHas={builderHas}
                    onBuilderToggle={onBuilderToggle}
                    onAdd={onAdd}
                    onRemoveIndividual={onRemoveIndividual}
                  />
                );
              })
          )}
        </div>
      </div>
    </div>
  );
}

function ClientRows({
  client,
  people,
  totalPeople,
  loading,
  open,
  onToggleExpand,
  targets,
  favSet,
  onToggleFavorite,
  builderKind,
  builderHas,
  onBuilderToggle,
  onAdd,
  onRemoveIndividual,
}: {
  client: Client;
  people: ClientPerson[];
  totalPeople: number;
  loading: boolean;
  open: boolean;
  onToggleExpand: () => void;
  targets: OutreachTarget[];
  favSet: Set<string>;
  onToggleFavorite: (p: ClientPerson) => void;
  builderKind: 'list' | 'group' | null;
  builderHas: (key: string) => boolean;
  onBuilderToggle: (r: OutreachRecipient) => void;
  onAdd: (r: OutreachRecipient) => void;
  onRemoveIndividual: (key: string) => void;
}) {
  return (
    <>
      <div className="ov2-rs-row clients">
        <span className="controls">
          <button
            type="button"
            className="ov2-rs-caret"
            onClick={onToggleExpand}
            aria-label={open ? 'Collapse contacts' : 'Expand contacts'}
          >
            {open ? <DownOutlined /> : <RightOutlined />}
          </button>
        </span>
        <span className="who">
          <div className="nm">{client.name}</div>
          <div className="sub">
            {clientIndustry(client)} · {loading ? '…' : totalPeople}{' '}
            {totalPeople === 1 ? 'contact' : 'contacts'}
          </div>
        </span>
        <span />
        <span />
        <span className="ov2-rs-client-badge">Client</span>
      </div>
      {open &&
        (people.length === 0 ? (
          <div className="ov2-rs-row clients sub">
            <span />
            <span className="who">
              <div className="sub">
                {loading ? 'Loading contacts…' : 'No key persons on this client yet.'}
              </div>
            </span>
            <span />
            <span />
            <span />
          </div>
        ) : (
          people.map((person) => {
            const recipient = clientPersonRecipient(client, person);
            const membership = membershipOf(targets, recipientKey(recipient));
            const tag = membership ? MEMBERSHIP_TAG[membership] : null;
            const favId = `clientperson:${person.id}`;
            const pGroupChecked = builderKind === 'group' && builderHas(recipientKey(recipient));
            return (
              <div
                key={person.id}
                className={
                  'ov2-rs-row clients sub' +
                  (membership ? ' added' : '') +
                  (pGroupChecked ? ' group-checked' : '')
                }
              >
                <span className="controls" style={{ paddingLeft: 26 }}>
                  <AddControl
                    recipient={recipient}
                    targets={targets}
                    builderKind={builderKind}
                    builderHas={builderHas}
                    onBuilderToggle={onBuilderToggle}
                    onAdd={onAdd}
                    onRemoveIndividual={onRemoveIndividual}
                  />
                  <button
                    type="button"
                    className={'ov2-rs-star' + (favSet.has(favId) ? ' on' : '')}
                    onClick={() => onToggleFavorite(person)}
                    aria-label={favSet.has(favId) ? 'Remove from favorites' : 'Add to favorites'}
                  >
                    {favSet.has(favId) ? <StarFilled /> : <StarOutlined />}
                  </button>
                </span>
                <span className="who">
                  <div className="nm">{person.name}</div>
                  <div className="sub">{person.title || '—'}</div>
                </span>
                <span className="ov2-rs-cell">{person.role || '—'}</span>
                <span className="ov2-rs-cell" title={person.email ?? undefined}>
                  {person.email || '—'}
                </span>
                {tag ? <span className={`ov2-rs-intag ${tag.cls}`}>{tag.text}</span> : <span />}
              </div>
            );
          })
        ))}
    </>
  );
}

// =====================================================================
// Tab 3 — Manual Add
// =====================================================================

function ManualTab({
  onAdd,
  builderKind,
  builderBanner,
}: {
  onAdd: (r: OutreachRecipient) => void;
  builderKind: 'list' | 'group' | null;
  builderBanner: ReactNode;
}) {
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [email, setEmail] = useState('');
  const valid = first.trim().length > 0 && last.trim().length > 0 && EMAIL_RE.test(email.trim());

  const add = () => {
    if (!valid) return;
    onAdd({
      id: `manual:${email.trim().toLowerCase()}`,
      name: `${first.trim()} ${last.trim()}`,
      email: email.trim(),
      relevanceReason: 'Manually added',
    });
    setFirst('');
    setLast('');
    setEmail('');
  };

  return (
    <div>
      {builderBanner}
      <div className="ov2-rs-hint">
        {builderKind
          ? `Add a recipient who isn't in the directory — they'll be picked into your new ${builderKind}. First name, last name, and email are all required.`
          : "Add a recipient who isn't in the directory. First name, last name, and email are all required."}
      </div>
      <div className="ov2-rs-manual">
        <Input
          style={{ flex: '0 1 160px' }}
          placeholder="First name"
          value={first}
          onChange={(e) => setFirst(e.target.value)}
          onPressEnter={add}
        />
        <Input
          style={{ flex: '0 1 160px' }}
          placeholder="Last name"
          value={last}
          onChange={(e) => setLast(e.target.value)}
          onPressEnter={add}
        />
        <Input
          style={{ flex: '0 1 260px' }}
          type="email"
          prefix={<UserOutlined />}
          placeholder="Email address"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onPressEnter={add}
        />
        <Button disabled={!valid} onClick={add}>
          {builderKind ? `Add to ${builderKind}` : 'Add'}
        </Button>
      </div>
    </div>
  );
}
