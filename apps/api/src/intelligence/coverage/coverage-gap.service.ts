import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { TenantContext } from '@capiro/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  CONTACT_USE_LABELS,
  isExcludedFromRecommendations,
  type ContactUse,
} from '../../acquisition-personnel/contact-use.policy.js';
import type {
  AudienceMember,
  ConfidenceBands,
  EvidenceRef,
} from '../actions/action-recommendation.types.js';
import { coverageStrength, type CoverageStrength } from './coverage-strength.js';

/**
 * Step 3.4 — relationship-coverage GAP service (plan §14).
 *
 * For a (clientId, peCode) — or an existing ActionRecommendation — this computes which
 * acquisition OFFICES / PEOPLE that are RELEVANT to the PE the firm already has a warm
 * relationship with vs. which it has NEVER engaged. Relevance is the committed Step 2.2
 * accepted chain:
 *
 *     accepted PeProgramMatch (peCode -> program)
 *       -> accepted ProgramOfficeProgramLink (program -> office)
 *         -> accepted, non-stale PersonRole at that office (-> person)
 *
 * (the same join `ActionRecommendationService.loadEligiblePersonRoles` uses). Those graph
 * tables are GLOBAL reference data (no RLS) and are read via the base client.
 *
 * Coverage is computed READ-ONLY from the firm's EXISTING engagement history — meetings,
 * outreach records, and mail threads — which IS tenant-scoped (RLS): every engagement read
 * runs inside `withTenant`. A person is matched to engagement via the
 * `EngagementContact.acquisitionPersonnelId` link:
 *   - meetings  : MeetingAttendee.contactId -> an EngagementContact for the person (date = startsAt)
 *   - outreach  : OutreachRecord.meetingId -> one of those matched meetings (date = sentAt ?? createdAt)
 *   - mail      : MailThread.participants email matches one of the person's contact emails
 *                 (date = lastMessageAt ?? updatedAt)
 *
 * The ONLY write this feature performs is `createOutreachFromGap`, which creates a
 * `schedule_outreach` ActionRecommendation (mirroring the Step 3.2 card shape) assigned to
 * an owner. It NEVER mutates any engagement data.
 *
 * Money / unit conventions are irrelevant here (no dollars surfaced).
 */

/** One relevant office/person row, banded by relationship strength. */
export interface CoverageEntry {
  officeId: string;
  officeName: string;
  personId?: string;
  personName?: string;
  roleTitle?: string;
  /** §17 contact-use classification of the person's role (display badge + gap gating). */
  contactUse: ContactUse | string;
  contactUseLabel: string;
  /** Most recent firm touch (ISO) across meetings/outreach/mail, or null if never. */
  lastTouch: string | null;
  /** Owner (user id) of the engagement record that produced lastTouch, when known. */
  owner: string | null;
  strength: CoverageStrength;
  /**
   * True when this person may be OFFERED as a "go contact them" outreach gap. False for
   * §17-excluded contact-uses (procurement POC / source-selection / quarantined / candidate),
   * which still appear as CONTEXT but never as a suggested target.
   */
  outreachEligible: boolean;
}

/** Banded coverage result for a PE. `strong` = active|warm, `weak` = cold, `none` = never. */
export interface CoverageResult {
  peCode: string;
  clientId?: string;
  /** active or warm (we have a live relationship). */
  strong: CoverageEntry[];
  /** cold (we have a relationship but it has gone stale). */
  weak: CoverageEntry[];
  /** none (relevant, but the firm has never engaged this person). */
  none: CoverageEntry[];
  /** Present on the getCoverageForAction path: the card's why-now context. */
  whyNow?: { whatChanged: string | null; deadline: string | null };
}

export interface CreateOutreachFromGapInput {
  /** Supply EITHER peCode (+ clientId) OR actionId to resolve the (client, PE) context. */
  peCode?: string;
  actionId?: string;
  clientId?: string;
  /** The relevant office to target. Required. */
  officeId: string;
  /** Optional: a specific person at that office to target. */
  personId?: string;
  /** The user to assign the resulting schedule_outreach card to. Required. */
  ownerUserId: string;
}

export interface CreateOutreachResult {
  id: string;
  created: boolean;
  status: string;
}

@Injectable()
export class CoverageGapService {
  private readonly logger = new Logger(CoverageGapService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Coverage for a (client, PE): resolve the relevant offices/people (2.2 accepted chain),
   * compute each person's firm-wide lastTouch from engagement history, band by strength, and
   * return the rows grouped into strong / weak / none.
   */
  async getCoverageForPe(
    ctx: TenantContext,
    peCode: string,
    opts?: { clientId?: string; now?: Date },
  ): Promise<CoverageResult> {
    const code = peCode.trim().toUpperCase();
    const now = opts?.now ?? new Date();

    // 1) Relevant offices/people via the 2.2 accepted chain (GLOBAL graph, no RLS).
    const relevant = await this.resolveRelevantTargets(code);

    // 2) Firm-wide engagement touch per person (tenant-scoped, READ-ONLY).
    const personIds = relevant.filter((r) => r.personId).map((r) => r.personId as string);
    const touchByPerson = await this.computeTouchesByPerson(ctx, personIds);

    // 3) Band each row.
    const entries: CoverageEntry[] = relevant.map((r) => {
      const touch = r.personId ? touchByPerson.get(r.personId) : undefined;
      const lastTouch = touch?.lastTouch ?? null;
      const contactUse = r.contactUse;
      const excluded = isExcludedFromRecommendations(contactUse as ContactUse);
      return {
        officeId: r.officeId,
        officeName: r.officeName,
        personId: r.personId,
        personName: r.personName,
        roleTitle: r.roleTitle,
        contactUse,
        contactUseLabel: CONTACT_USE_LABELS[contactUse as ContactUse] ?? contactUse,
        lastTouch: lastTouch ? lastTouch.toISOString() : null,
        owner: touch?.owner ?? null,
        strength: coverageStrength(lastTouch, now),
        outreachEligible: !excluded,
      };
    });

    const strong = entries.filter((e) => e.strength === 'active' || e.strength === 'warm');
    const weak = entries.filter((e) => e.strength === 'cold');
    const none = entries.filter((e) => e.strength === 'none');

    return { peCode: code, clientId: opts?.clientId, strong, weak, none };
  }

  /**
   * Coverage for an existing action card: look up its peCode + clientId (tenant-scoped),
   * delegate to getCoverageForPe, and attach the card's why-now (whatChanged + deadline).
   */
  async getCoverageForAction(ctx: TenantContext, actionId: string): Promise<CoverageResult> {
    const action = await this.prisma.withTenant(ctx.tenantId, async (tx) =>
      tx.actionRecommendation.findFirst({
        where: { id: actionId, tenantId: ctx.tenantId },
        select: { peCode: true, clientId: true, whatChanged: true, deadline: true },
      }),
    );
    if (!action) throw new NotFoundException(`ActionRecommendation ${actionId} not found`);
    if (!action.peCode) {
      throw new BadRequestException(`ActionRecommendation ${actionId} has no peCode for coverage`);
    }

    const result = await this.getCoverageForPe(ctx, action.peCode, { clientId: action.clientId });
    result.whyNow = {
      whatChanged: action.whatChanged ?? null,
      deadline: action.deadline ? action.deadline.toISOString() : null,
    };
    return result;
  }

  /**
   * Create a `schedule_outreach` ActionRecommendation from a coverage gap, assigned to
   * `ownerUserId`. Resolves the (client, PE) from either an explicit peCode+clientId or an
   * actionId, validates the target office/person is actually a relevant + outreach-eligible
   * target for the PE (a §17-excluded person can NEVER be turned into an outreach card), and
   * writes the card + an AuditLog inside ONE tenant transaction.
   *
   * Idempotent-ish: an existing OPEN (non-dismissed / non-archived) schedule_outreach card for
   * the same (client, PE, person) is returned as-is rather than duplicated.
   */
  async createOutreachFromGap(
    ctx: TenantContext,
    input: CreateOutreachFromGapInput,
  ): Promise<CreateOutreachResult> {
    if (!input.ownerUserId) throw new BadRequestException('ownerUserId is required');
    if (!input.officeId) throw new BadRequestException('officeId is required');

    // 1) Resolve (clientId, peCode).
    const { clientId, peCode } = await this.resolveClientAndPe(ctx, input);

    // 2) Validate the target is relevant + outreach-eligible (re-uses the 2.2 chain;
    //    NEVER trust a client-supplied office/person without re-checking).
    const relevant = await this.resolveRelevantTargets(peCode);
    const target = relevant.find(
      (r) =>
        r.officeId === input.officeId &&
        (input.personId ? r.personId === input.personId : true),
    );
    if (!target) {
      throw new BadRequestException(
        `Office ${input.officeId}${input.personId ? `/person ${input.personId}` : ''} is not a relevant target for PE ${peCode}`,
      );
    }
    if (input.personId && isExcludedFromRecommendations(target.contactUse as ContactUse)) {
      // §17 hard rule: a procurement POC / source-selection / quarantined person is shown
      // as context but is NEVER a "go contact them" outreach target.
      throw new BadRequestException(
        `Person ${input.personId} (${target.contactUseLabel}) cannot be an outreach target`,
      );
    }

    // 3) Build the schedule_outreach card payload (mirrors the Step 3.2 card shape).
    const audience: AudienceMember[] = target.personId
      ? [
          {
            kind: 'person_role',
            id: target.personId,
            label: target.personName ?? 'Unknown',
            contactUse: target.contactUse,
            // person audience members are context-only until a human designates a lobbying
            // contact (see action-recommendation.types AudienceMember docs).
            outreachEligible: false,
          },
        ]
      : [{ kind: 'office', id: target.officeId, label: target.officeName }];

    const evidence: EvidenceRef[] = [
      {
        kind: 'provision',
        provisionId: target.programId ?? undefined,
        note: `Relationship-coverage gap: ${target.officeName}${
          target.personName ? ` — ${target.personName}` : ''
        } (PE ${peCode})`,
      },
    ];
    const confidence: ConfidenceBands = {
      peopleMatch: target.personId ? 'high' : 'medium',
      programMatch: 'high', // we only ever reach here off an ACCEPTED match chain.
    };
    const issueTitle = `Build coverage: ${target.officeName}${
      target.personName ? ` (${target.personName})` : ''
    }`;
    const whatChanged = `No active relationship with ${
      target.personName ? target.personName : target.officeName
    } for PE ${peCode}.`;
    const whyItMatters = `${target.officeName} is a relevant program office for PE ${peCode} but the firm has no current outreach coverage there.`;
    const recommendedAction = target.personName
      ? `Assign an owner and schedule outreach to ${target.personName} at ${target.officeName}.`
      : `Assign an owner and schedule outreach into ${target.officeName}.`;

    // 4) Idempotent create + AuditLog inside ONE tenant transaction.
    return this.prisma.withTenant(ctx.tenantId, async (tx) => {
      const existing = await this.findOpenOutreachCard(tx, ctx.tenantId, clientId, peCode, target.personId);
      if (existing) {
        return { id: existing.id, created: false, status: existing.status };
      }

      const card = await tx.actionRecommendation.create({
        data: {
          tenantId: ctx.tenantId,
          clientId,
          peCode,
          programId: target.programId,
          actionType: 'schedule_outreach',
          issueTitle,
          whatChanged,
          whyItMatters,
          recommendedAction,
          targetAudience: audience as unknown as Prisma.InputJsonValue,
          suggestedArtifactType: null,
          ownerUserId: input.ownerUserId,
          // Owner is assigned at creation -> the card starts in 'assigned', not 'new'.
          status: 'assigned',
          priority: 0,
          confidence: confidence as unknown as Prisma.InputJsonValue,
          uncertainty: null,
          evidence: evidence as unknown as Prisma.InputJsonValue,
        },
        select: { id: true, status: true },
      });

      await tx.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorUserId: ctx.userId,
          actorRole: ctx.role,
          action: 'intelligence.coverage.outreach.create',
          entityType: 'action_recommendation',
          entityId: card.id,
          after: {
            peCode,
            clientId,
            officeId: target.officeId,
            personId: target.personId ?? null,
            ownerUserId: input.ownerUserId,
            actionType: 'schedule_outreach',
          },
        },
      });

      return { id: card.id, created: true, status: card.status };
    });
  }

  // ── internals ─────────────────────────────────────────────────────────────────────

  /**
   * Resolve the relevant offices/people for a PE via the committed 2.2 accepted chain.
   * GLOBAL reference tables (no RLS) -> base client. Returns one row per (office, person)
   * plus office-only rows for relevant offices that have no eligible person yet.
   */
  private async resolveRelevantTargets(peCode: string): Promise<
    Array<{
      officeId: string;
      officeName: string;
      programId: string | null;
      personId?: string;
      personName?: string;
      roleTitle?: string;
      contactUse: string;
      contactUseLabel: string;
    }>
  > {
    // accepted PE -> program matches
    const matches = await this.prisma.peProgramMatch.findMany({
      where: { peCode, status: 'accepted' },
      select: { programId: true },
    });
    const programIds = [...new Set(matches.map((m) => m.programId))];
    if (programIds.length === 0) return [];

    // accepted program -> office links
    const links = await this.prisma.programOfficeProgramLink.findMany({
      where: { programId: { in: programIds }, reviewStatus: 'accepted' },
      select: { officeId: true, programId: true, office: { select: { id: true, name: true } } },
    });
    if (links.length === 0) return [];
    const officeIds = [...new Set(links.map((l) => l.officeId))];
    // pick a representative programId per office for evidence (first accepted link).
    const programByOffice = new Map<string, string>();
    const officeNameById = new Map<string, string>();
    for (const l of links) {
      if (!programByOffice.has(l.officeId)) programByOffice.set(l.officeId, l.programId);
      if (l.office) officeNameById.set(l.officeId, l.office.name);
    }

    // accepted, non-stale roles at those offices (-> person + role title).
    const roles = await this.prisma.personRole.findMany({
      where: { officeId: { in: officeIds }, reviewStatus: 'accepted', staleAt: null },
      select: {
        officeId: true,
        roleTitle: true,
        contactUse: true,
        personId: true,
        person: { select: { id: true, fullName: true } },
      },
    });

    const out: Array<{
      officeId: string;
      officeName: string;
      programId: string | null;
      personId?: string;
      personName?: string;
      roleTitle?: string;
      contactUse: string;
      contactUseLabel: string;
    }> = [];

    const officesWithPeople = new Set<string>();
    for (const r of roles) {
      const officeId = r.officeId as string;
      officesWithPeople.add(officeId);
      const contactUse = r.contactUse;
      out.push({
        officeId,
        officeName: officeNameById.get(officeId) ?? officeId,
        programId: programByOffice.get(officeId) ?? null,
        personId: r.personId,
        personName: r.person?.fullName ?? undefined,
        roleTitle: r.roleTitle,
        contactUse,
        contactUseLabel: CONTACT_USE_LABELS[contactUse as ContactUse] ?? contactUse,
      });
    }

    // Relevant offices with NO eligible person yet still surface as an office-level gap.
    for (const officeId of officeIds) {
      if (officesWithPeople.has(officeId)) continue;
      out.push({
        officeId,
        officeName: officeNameById.get(officeId) ?? officeId,
        programId: programByOffice.get(officeId) ?? null,
        contactUse: 'program_ownership_context',
        contactUseLabel: CONTACT_USE_LABELS.program_ownership_context,
      });
    }

    return out;
  }

  /**
   * Firm-wide most-recent touch per person, READ-ONLY and tenant-scoped (RLS via withTenant).
   * Returns Map<personId, { lastTouch, owner }>. Absent => never touched.
   *
   * A person is matched to engagement through `EngagementContact.acquisitionPersonnelId`:
   *   - meetings : an attendee whose contactId is one of the person's contacts (date startsAt)
   *   - outreach : an OutreachRecord linked (meetingId) to one of those meetings (date sentAt ?? createdAt)
   *   - mail     : a MailThread whose participant email matches one of the person's contact emails
   */
  private async computeTouchesByPerson(
    ctx: TenantContext,
    personIds: string[],
  ): Promise<Map<string, { lastTouch: Date; owner: string | null }>> {
    const result = new Map<string, { lastTouch: Date; owner: string | null }>();
    if (personIds.length === 0) return result;

    return this.prisma.withTenant(ctx.tenantId, async (tx) => {
      // The person's engagement contacts (carry the email + the contact id used by attendees).
      const contacts = await tx.engagementContact.findMany({
        where: { tenantId: ctx.tenantId, acquisitionPersonnelId: { in: personIds } },
        select: { id: true, acquisitionPersonnelId: true, email: true },
      });
      if (contacts.length === 0) return result;

      const personByContactId = new Map<string, string>();
      const personByEmail = new Map<string, string>();
      const contactIds: string[] = [];
      for (const c of contacts) {
        if (!c.acquisitionPersonnelId) continue;
        personByContactId.set(c.id, c.acquisitionPersonnelId);
        contactIds.push(c.id);
        if (c.email) personByEmail.set(c.email.toLowerCase(), c.acquisitionPersonnelId);
      }

      const record = (personId: string, when: Date | null | undefined, owner: string | null) => {
        if (!when) return;
        const prev = result.get(personId);
        if (!prev || when.getTime() > prev.lastTouch.getTime()) {
          result.set(personId, { lastTouch: when, owner: owner ?? prev?.owner ?? null });
        }
      };

      // Meetings via attendees -> contact -> person.
      const attendees =
        contactIds.length > 0
          ? await tx.meetingAttendee.findMany({
              where: { tenantId: ctx.tenantId, contactId: { in: contactIds } },
              select: {
                contactId: true,
                meeting: { select: { id: true, startsAt: true, createdByUserId: true } },
              },
            })
          : [];
      const matchedMeetingIds = new Set<string>();
      for (const a of attendees) {
        if (!a.contactId || !a.meeting) continue;
        const personId = personByContactId.get(a.contactId);
        if (!personId) continue;
        matchedMeetingIds.add(a.meeting.id);
        record(personId, a.meeting.startsAt, a.meeting.createdByUserId);
      }

      // Outreach records structurally linked to one of the matched meetings.
      if (matchedMeetingIds.size > 0) {
        const meetingToPersons = new Map<string, Set<string>>();
        for (const a of attendees) {
          if (!a.contactId || !a.meeting) continue;
          const personId = personByContactId.get(a.contactId);
          if (!personId) continue;
          const set = meetingToPersons.get(a.meeting.id) ?? new Set<string>();
          set.add(personId);
          meetingToPersons.set(a.meeting.id, set);
        }
        const outreach = await tx.outreachRecord.findMany({
          where: {
            tenantId: ctx.tenantId,
            meetingId: { in: [...matchedMeetingIds] },
            deletedAt: null,
          },
          select: { meetingId: true, sentAt: true, createdAt: true, createdByUserId: true },
        });
        for (const o of outreach) {
          if (!o.meetingId) continue;
          const persons = meetingToPersons.get(o.meetingId);
          if (!persons) continue;
          const when = o.sentAt ?? o.createdAt;
          for (const personId of persons) record(personId, when, o.createdByUserId);
        }
      }

      // Mail threads matched by participant email -> the person's contact email.
      if (personByEmail.size > 0) {
        const threads = await tx.mailThread.findMany({
          where: { tenantId: ctx.tenantId },
          select: { participants: true, lastMessageAt: true, updatedAt: true },
        });
        for (const t of threads) {
          const emails = extractParticipantEmails(t.participants);
          const when = t.lastMessageAt ?? t.updatedAt;
          for (const email of emails) {
            const personId = personByEmail.get(email);
            // Mail threads carry no owner-user FK; owner stays whatever a dated meeting/outreach set.
            if (personId) record(personId, when, null);
          }
        }
      }

      return result;
    });
  }

  /** Resolve (clientId, peCode) from either an explicit peCode+clientId or an actionId. */
  private async resolveClientAndPe(
    ctx: TenantContext,
    input: CreateOutreachFromGapInput,
  ): Promise<{ clientId: string; peCode: string }> {
    if (input.actionId) {
      const action = await this.prisma.withTenant(ctx.tenantId, async (tx) =>
        tx.actionRecommendation.findFirst({
          where: { id: input.actionId, tenantId: ctx.tenantId },
          select: { clientId: true, peCode: true },
        }),
      );
      if (!action) throw new NotFoundException(`ActionRecommendation ${input.actionId} not found`);
      if (!action.peCode) {
        throw new BadRequestException(`ActionRecommendation ${input.actionId} has no peCode`);
      }
      return { clientId: action.clientId, peCode: action.peCode.trim().toUpperCase() };
    }
    if (!input.peCode || !input.clientId) {
      throw new BadRequestException('Provide either actionId, or both peCode and clientId');
    }
    return { clientId: input.clientId, peCode: input.peCode.trim().toUpperCase() };
  }

  /**
   * Find an existing OPEN schedule_outreach card for (client, PE) — and, when a person is
   * targeted, one whose audience already targets that person. "Open" = not dismissed/archived.
   * Used to avoid creating a duplicate gap card.
   */
  private async findOpenOutreachCard(
    tx: Prisma.TransactionClient,
    tenantId: string,
    clientId: string,
    peCode: string,
    personId: string | undefined,
  ): Promise<{ id: string; status: string } | null> {
    const rows = await tx.actionRecommendation.findMany({
      where: {
        tenantId,
        clientId,
        peCode,
        actionType: 'schedule_outreach',
        status: { notIn: ['dismissed', 'archived'] },
      },
      select: { id: true, status: true, targetAudience: true },
    });
    for (const r of rows) {
      if (!personId) return { id: r.id, status: r.status };
      const audience = (r.targetAudience as unknown as AudienceMember[]) ?? [];
      if (audience.some((a) => a.kind === 'person_role' && a.id === personId)) {
        return { id: r.id, status: r.status };
      }
    }
    return null;
  }
}

/** Extract lowercased participant emails from a MailThread.participants JSON value. */
function extractParticipantEmails(value: Prisma.JsonValue): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    const raw =
      typeof record.email === 'string'
        ? record.email
        : typeof record.address === 'string'
          ? record.address
          : null;
    if (raw) out.push(raw.trim().toLowerCase());
  }
  return out;
}
