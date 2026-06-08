/**
 * CoveragePanel — the Step 3.4 "Relationship coverage" sub-section hosted inside an ActionCard.
 *
 * Renders the three coverage bands for an action's PE:
 *   strong (active/warm) — green/blue, the relationships we already hold.
 *   weak   (cold)        — amber, present but stale (a subtle "stale" hint).
 *   none   (never engaged) — red "gap" rows; THESE are the actionable gaps.
 *
 * Each row carries the §17 contactUse badge (same color/label convention as the program-team
 * audience rendering). A row with outreachEligible === false is CONTEXT only — badge, no action
 * button, never a clickable outreach target. An actionable gap (a 'none' or 'cold' row with
 * outreachEligible === true) exposes an owner Select + "Assign & create outreach" button that
 * POSTs { actionId, officeId, personId?, ownerUserId } and on success refetches.
 *
 * Lazily fetched: the parent only mounts/enables this once the user expands the section, so the
 * board never fires one coverage request per card. Every nested read is Array.isArray / null
 * guarded — a thin or malformed payload renders an honest empty state, never a crash.
 */
import { useState } from 'react';
import { App as AntApp, Button, Select, Space, Spin, Tag, Tooltip, Typography } from 'antd';
import { ClockCircleOutlined, WarningOutlined } from '@ant-design/icons';
import {
  useActionCoverage,
  useCreateOutreach,
  type CoverageEntry,
  type CoverageResult,
} from './coverage-api.js';
import type { TeamMemberOption } from './actions-api.js';

const { Text } = Typography;

// contactUse → AntD Tag color. Mirrors the program-team audience convention
// (ProgramTeamPanel.tsx) so a contactUse badge reads identically everywhere:
// procurement-sensitive / quarantined buckets read hot (red) so a user never
// mistakes one for a safe lobbying target; the procurement POC reads volcano.
const CONTACT_USE_TAG_COLOR: Record<string, string> = {
  official_procurement_poc: 'volcano',
  do_not_contact_procurement_sensitive: 'red',
  quarantined: 'red',
  candidate: 'default',
  program_ownership_context: 'blue',
  internal_owner: 'geekblue',
  relationship_owner: 'geekblue',
  lobbying_contact: 'green',
};

function contactUseColor(contactUse: string): string {
  return CONTACT_USE_TAG_COLOR[contactUse] ?? 'default';
}

function memberName(member: TeamMemberOption): string {
  const full = [member.firstName, member.lastName].filter(Boolean).join(' ').trim();
  return full || member.email || member.userId;
}

function formatTouch(iso: string | null): string {
  if (!iso) return 'never';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'never';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Per-band styling for the band heading + row accent. */
const BAND_META: Record<'strong' | 'weak' | 'none', { label: string; color: string }> = {
  strong: { label: 'Strong coverage', color: 'var(--success, #389e0d)' },
  weak: { label: 'Weak / stale', color: 'var(--warning, #d48806)' },
  none: { label: 'Gaps — never engaged', color: 'var(--error, #cf1322)' },
};

/** A stable key for a coverage row (officeId + personId — personId may be absent for office rows). */
function entryKey(entry: CoverageEntry, idx: number): string {
  return `${entry.officeId || 'office'}:${entry.personId ?? 'office-only'}:${idx}`;
}

function CoverageRow({
  entry,
  band,
  actionId,
  teamMembers,
}: {
  entry: CoverageEntry;
  band: 'strong' | 'weak' | 'none';
  actionId: string;
  teamMembers: TeamMemberOption[];
}) {
  const { message } = AntApp.useApp();
  const createOutreach = useCreateOutreach();
  const [ownerUserId, setOwnerUserId] = useState<string | undefined>(undefined);

  const members = Array.isArray(teamMembers) ? teamMembers : [];

  // An actionable gap is a 'none' or 'cold' row that is outreach-eligible. Strong rows and
  // any outreachEligible===false row are CONTEXT ONLY — they never show an outreach control.
  const isActionableGap =
    entry.outreachEligible === true && (band === 'none' || entry.strength === 'cold');

  function handleCreate() {
    if (!ownerUserId) return; // guarded; button is also disabled
    createOutreach.mutate(
      {
        actionId,
        officeId: entry.officeId,
        // Office-only rows (no personId) omit personId in the POST.
        ...(entry.personId ? { personId: entry.personId } : {}),
        ownerUserId,
      },
      {
        onSuccess: () => message.success('Outreach assigned & created'),
        onError: (err) => message.error(err.message || 'Could not create outreach'),
      },
    );
  }

  const meta = [entry.personName, entry.roleTitle].filter(Boolean).join(' · ');

  return (
    <div className="coverage-row" data-band={band}>
      <div className="coverage-row-main">
        <Tag color={contactUseColor(entry.contactUse)}>{entry.contactUseLabel || entry.contactUse}</Tag>
        <Text strong>{entry.officeName || entry.officeId || 'Unknown office'}</Text>
        {meta ? (
          <Text type="secondary" style={{ fontSize: 12 }}>
            {' '}
            · {meta}
          </Text>
        ) : null}
        {band === 'weak' ? (
          <Tooltip title="Relationship has gone cold — verify before relying on it">
            <Tag color="warning" style={{ marginLeft: 4 }}>
              stale
            </Tag>
          </Tooltip>
        ) : null}
        {/* Context-only rows are clearly marked so a user never mistakes one for a target. */}
        {entry.outreachEligible !== true ? (
          <Tooltip title="Context only — not an outreach/lobbying target">
            <Text type="secondary" style={{ fontSize: 11, marginLeft: 4 }}>
              context
            </Text>
          </Tooltip>
        ) : null}
      </div>

      <div className="coverage-row-meta">
        <Space size={4}>
          <ClockCircleOutlined style={{ fontSize: 12 }} />
          <Text type="secondary" style={{ fontSize: 12 }}>
            last touch {formatTouch(entry.lastTouch)}
          </Text>
        </Space>
        {entry.owner ? (
          <Text type="secondary" style={{ fontSize: 12 }}>
            owner: {entry.owner}
          </Text>
        ) : null}
      </div>

      {isActionableGap ? (
        <div className="coverage-row-action">
          <Select<string>
            size="small"
            showSearch
            style={{ minWidth: 170 }}
            placeholder="Assign owner"
            value={ownerUserId}
            onChange={(v) => setOwnerUserId(v)}
            optionFilterProp="label"
            options={members.map((m) => ({ value: m.userId, label: memberName(m) }))}
            notFoundContent={members.length ? undefined : 'No team members'}
          />
          <Button
            size="small"
            type="primary"
            loading={createOutreach.isPending}
            disabled={!ownerUserId || createOutreach.isPending}
            onClick={handleCreate}
          >
            Assign &amp; create outreach
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function CoverageBand({
  band,
  entries,
  actionId,
  teamMembers,
}: {
  band: 'strong' | 'weak' | 'none';
  entries: CoverageEntry[];
  actionId: string;
  teamMembers: TeamMemberOption[];
}) {
  const rows = Array.isArray(entries) ? entries : [];
  if (!rows.length) return null;
  const meta = BAND_META[band];
  return (
    <div className="coverage-band">
      <div className="coverage-band-head" style={{ color: meta.color }}>
        {meta.label} ({rows.length})
      </div>
      {rows.map((entry, idx) => (
        <CoverageRow
          key={entryKey(entry, idx)}
          entry={entry}
          band={band}
          actionId={actionId}
          teamMembers={teamMembers}
        />
      ))}
    </div>
  );
}

/**
 * The coverage body — rendered ONLY when the parent has expanded the section (it owns the
 * lazy-fetch gate via the `enabled` prop on the query). Renders loading / error / empty / data.
 */
export function CoveragePanel({
  actionId,
  teamMembers,
  enabled,
}: {
  actionId: string;
  teamMembers: TeamMemberOption[];
  enabled: boolean;
}) {
  const { data, isLoading, isError, error } = useActionCoverage(actionId, enabled);

  if (isLoading) {
    return (
      <div className="coverage-panel" data-testid="coverage-panel">
        <Spin size="small" /> <Text type="secondary">Loading coverage…</Text>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="coverage-panel" data-testid="coverage-panel">
        <Text type="danger">
          {(error as Error)?.message || 'Could not load relationship coverage.'}
        </Text>
      </div>
    );
  }

  const result: CoverageResult | undefined = data;
  const strong = Array.isArray(result?.strong) ? result!.strong : [];
  const weak = Array.isArray(result?.weak) ? result!.weak : [];
  const none = Array.isArray(result?.none) ? result!.none : [];
  const hasAny = strong.length + weak.length + none.length > 0;

  return (
    <div className="coverage-panel" data-testid="coverage-panel">
      {result?.whyNow?.whatChanged ? (
        <div className="coverage-whynow">
          <Space size={6} align="start">
            <WarningOutlined style={{ color: '#faad14', marginTop: 2 }} />
            <Text type="secondary" style={{ fontSize: 12 }}>
              Why now: {result.whyNow.whatChanged}
            </Text>
          </Space>
        </div>
      ) : null}

      {hasAny ? (
        <>
          <CoverageBand band="strong" entries={strong} actionId={actionId} teamMembers={teamMembers} />
          <CoverageBand band="weak" entries={weak} actionId={actionId} teamMembers={teamMembers} />
          <CoverageBand band="none" entries={none} actionId={actionId} teamMembers={teamMembers} />
        </>
      ) : (
        <Text type="secondary">No relationship-coverage data for this PE yet</Text>
      )}
    </div>
  );
}
