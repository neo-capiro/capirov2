// Outreach 2.0 — Groups feature surface (boards 7 & 8).
//
// A Group is a saved, reusable set of recipients emailed together on ONE
// shared email — distinct from a List, whose members each get their own 1:1
// email. Groups wear an amber/gold identity throughout to contrast the
// blue/green List UI (design doc §5.4: the two must stay visually distinct).
//
// Persistence reuses the same OutreachAudience API as Lists with kind:'group'
// (GET/POST /api/engagement/outreach/audiences) — see audiences.ts for the
// shared shapes. Everything lives here so StepRecipientsSelect doesn't keep
// growing; it composes the three pieces this hook returns:
//   • groupsPopover    — toolbar dropdown: create-new + saved groups (board 5.1/7d)
//   • groupBuildBanner — amber "N members selected" build bar (board 7b)
//   • saveGroupModal   — "Save as group" modal + green toast (board 7c/7d)
//
// The build-mode selection (`builder`) is owned by StepRecipientsSelect and
// shared with Lists (one builder at a time); this hook only acts on it when
// builder.kind === 'group'.

import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, Input, Modal } from 'antd';
import { CheckOutlined, PlusOutlined, TeamOutlined } from '@ant-design/icons';
import { useApi } from '../../../../lib/use-api.js';
import type { OutreachRecipient } from '../../OutreachView.js';
import { recipientKey } from './types.js';
import { EMAIL_RE, membershipOf, newTargetKey, type OutreachTarget } from './targets.js';
import {
  apiErrorMessage,
  audienceMemberToRecipient,
  plural,
  toAudienceMemberInput,
  type AudienceBuilderState,
  type AudienceRow,
} from './audiences.js';

export interface UseGroupsArgs {
  targets: OutreachTarget[];
  setTargets: (next: OutreachTarget[]) => void;
  /** Shared build-mode selection; this hook acts only when kind === 'group'. */
  builder: AudienceBuilderState | null;
  setBuilder: (next: AudienceBuilderState | null) => void;
}

export interface UseGroupsResult {
  /** Amber toolbar popover: create-new + the user's saved groups. */
  groupsPopover: ReactNode;
  /** Amber build banner (board 7b); null unless a group build is in progress. */
  groupBuildBanner: ReactNode;
  /** "Save as group" modal (board 7c); always mounted, opens on demand. */
  saveGroupModal: ReactNode;
  groupsOpen: boolean;
  setGroupsOpen: (open: boolean) => void;
}

export function useGroups({
  targets,
  setTargets,
  builder,
  setBuilder,
}: UseGroupsArgs): UseGroupsResult {
  const api = useApi();
  const qc = useQueryClient();
  const { message, notification } = App.useApp();
  const [groupsOpen, setGroupsOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  // The group just saved this session — drives the green "New" badge (board 7d).
  const [recentlySavedId, setRecentlySavedId] = useState<string | null>(null);

  // Saved groups from the user's contact library (kind='group').
  const groupsQuery = useQuery<AudienceRow[]>({
    queryKey: ['outreach-audiences', 'group'],
    queryFn: async () =>
      (
        await api.get<AudienceRow[]>('/api/engagement/outreach/audiences', {
          params: { kind: 'group' },
        })
      ).data,
  });
  const savedGroups = groupsQuery.data ?? [];

  // Only members with a sendable email can be persisted (the API @IsEmail-
  // validates every member; one bad address 400s the whole save).
  const emailableCount = builder
    ? builder.members.filter((m) => m.email && EMAIL_RE.test(m.email)).length
    : 0;
  const unsavableCount = (builder?.members.length ?? 0) - emailableCount;

  // Apply a saved group to the campaign as a Group target (board 8b). People
  // already in the campaign are skipped — a person in two targets would lose
  // this group's cc/bcc in the flattened projection (first occurrence wins).
  const applyGroup = (group: AudienceRow, currentTargets: OutreachTarget[] = targets) => {
    const incoming = group.members.map(audienceMemberToRecipient);
    const fresh = incoming.filter((r) => !membershipOf(currentTargets, recipientKey(r)));
    const skipped = incoming.length - fresh.length;
    if (fresh.length === 0) {
      message.info('Everyone in this group is already in the campaign.');
      setGroupsOpen(false);
      return;
    }
    setTargets([
      ...currentTargets,
      {
        key: newTargetKey(),
        type: 'group',
        audienceId: group.id,
        name: group.name,
        recipients: fresh,
        cc: [],
        bcc: [],
      },
    ]);
    setGroupsOpen(false);
    if (skipped > 0) {
      message.info(
        `${skipped} ${skipped === 1 ? 'contact was' : 'contacts were'} already in the campaign and skipped.`,
      );
    }
  };

  // Save the build-mode selection to the contact library as a group, then
  // apply it to this campaign (board 7c → 7d). Pre-filter by EMAIL_RE so the
  // API can't 400 on an address-less member.
  const saveGroup = useMutation({
    mutationFn: async (vars: { name: string; members: OutreachRecipient[] }) => {
      const emailable = vars.members.filter((m) => m.email && EMAIL_RE.test(m.email));
      const res = await api.post<AudienceRow>('/api/engagement/outreach/audiences', {
        kind: 'group',
        name: vars.name,
        members: emailable.map(toAudienceMemberInput),
      });
      return { audience: res.data, skippedNoEmail: vars.members.length - emailable.length };
    },
    onSuccess: ({ audience, skippedNoEmail }) => {
      qc.invalidateQueries({ queryKey: ['outreach-audiences'] });
      setRecentlySavedId(audience.id);
      notification.success({
        message: 'Group saved',
        description: `${audience.name} — ${plural(audience.members.length, 'contact')}`,
        placement: 'topRight',
      });
      if (skippedNoEmail > 0) {
        message.warning(
          `${plural(skippedNoEmail, 'contact')} without a usable email address ${skippedNoEmail === 1 ? 'was' : 'were'} not saved.`,
        );
      }
      applyGroup(audience, targets);
      setBuilder(null);
      setSaveOpen(false);
      setSaveName('');
    },
    onError: (err) => message.error(apiErrorMessage(err) ?? 'Could not save the group'),
  });

  // ---- Toolbar popover (board 5.1 / 7d) ----
  const groupsPopover: ReactNode = (
    <div className="ov2-rs-groups-pop">
      <button
        type="button"
        className="create"
        onClick={() => {
          setBuilder({ kind: 'group', name: '', members: [] });
          setGroupsOpen(false);
        }}
      >
        <span className="plus">
          <PlusOutlined />
        </span>
        <span className="txt">
          <b>Create new group</b>
          <small>Recipients will be emailed as a group</small>
        </span>
      </button>
      <div className="sec">Saved groups</div>
      {groupsQuery.isLoading ? (
        <div className="empty">Loading your groups…</div>
      ) : savedGroups.length === 0 ? (
        <div className="empty">No saved groups yet</div>
      ) : (
        savedGroups.map((group) => {
          const applied = targets.some((t) => t.audienceId === group.id);
          const isNew = group.id === recentlySavedId;
          return (
            <div key={group.id} className="row">
              <div className="info">
                <b>
                  {group.name}
                  {isNew && <span className="new-badge">New</span>}
                </b>
                <small>{plural(group.members.length, 'contact')}</small>
              </div>
              <button
                type="button"
                className={'add' + (applied ? ' saved' : '')}
                disabled={applied}
                onClick={() => applyGroup(group, targets)}
              >
                {applied ? (
                  <>
                    <CheckOutlined /> Saved
                  </>
                ) : (
                  '+ Add'
                )}
              </button>
            </div>
          );
        })
      )}
    </div>
  );

  // ---- Build banner (board 7b) ----
  const groupBuildBanner: ReactNode =
    builder?.kind === 'group' ? (
      <div className="ov2-rs-buildbar group">
        <div className="lead">
          <span className="count">{plural(builder.members.length, 'member')} selected</span>
          <span className="sub">
            These recipients will be emailed as a group — one email sent together, not individually
          </span>
        </div>
        <span className="spacer" />
        <button
          type="button"
          className="save"
          disabled={emailableCount === 0}
          onClick={() => {
            setSaveName('');
            setSaveOpen(true);
          }}
        >
          Save as group
        </button>
        <button type="button" className="cancel" onClick={() => setBuilder(null)}>
          Cancel
        </button>
      </div>
    ) : null;

  // ---- Save-as-group modal (board 7c) ----
  const saveGroupModal: ReactNode = (
    <Modal
      title={
        <span className="ov2-rs-group-modal-title">
          <TeamOutlined /> Save as group
        </span>
      }
      open={saveOpen}
      // No dismissal while the POST is in flight: the mutation still completes
      // and applies the group after a "cancel".
      closable={!saveGroup.isPending}
      maskClosable={!saveGroup.isPending}
      onCancel={() => !saveGroup.isPending && setSaveOpen(false)}
      footer={[
        <Button key="cancel" disabled={saveGroup.isPending} onClick={() => setSaveOpen(false)}>
          Cancel
        </Button>,
        <Button
          key="save"
          type="primary"
          className="ov2-rs-amber-btn"
          loading={saveGroup.isPending}
          disabled={!saveName.trim() || emailableCount === 0}
          onClick={() =>
            builder && saveGroup.mutate({ name: saveName.trim(), members: builder.members })
          }
        >
          Save group
        </Button>,
      ]}
    >
      <p style={{ marginTop: 8 }}>
        This will save your {plural(builder?.members.length ?? 0, 'selected recipient')} as a
        reusable group. They will always be emailed together on one shared email.
      </p>
      {unsavableCount > 0 && (
        <p style={{ marginTop: 0, fontSize: 12, color: 'var(--ov2-notable)' }}>
          {emailableCount === 0
            ? 'None of the selected contacts have a usable email address — add at least one with an email before saving.'
            : `${plural(unsavableCount, 'contact')} without a usable email address will be left out.`}
        </p>
      )}
      <label className="ov2-rs-group-modal-label">Group name</label>
      <Input
        autoFocus
        placeholder="HASC Member Offices"
        value={saveName}
        onChange={(e) => setSaveName(e.target.value)}
        onPressEnter={() => {
          if (saveName.trim() && builder && emailableCount > 0 && !saveGroup.isPending) {
            saveGroup.mutate({ name: saveName.trim(), members: builder.members });
          }
        }}
      />
      <p style={{ marginTop: 8, marginBottom: 0, fontSize: 12, color: 'var(--ov2-ink-3)' }}>
        Groups are saved to your firm's contact library and can be reused across campaigns.
      </p>
    </Modal>
  );

  return { groupsPopover, groupBuildBanner, saveGroupModal, groupsOpen, setGroupsOpen };
}
