import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

export interface AssociationCandidateInput {
  subject?: string | null;
  body?: string | null;
  attendeeEmails?: string[];
  participantEmails?: string[];
}

export interface AssociationResult {
  clientId: string | null;
  score: number;
  reason: string;
  signals: Record<string, unknown>;
}

interface ClientForAssociation {
  id: string;
  name: string;
  website: string | null;
  primaryContactEmail: string | null;
  intakeData: Prisma.JsonValue;
}

const AUTO_LINK_THRESHOLD = 0.5;

@Injectable()
export class ClientAssociationService {
  async associate(
    tx: Prisma.TransactionClient,
    tenantId: string,
    input: AssociationCandidateInput,
  ): Promise<AssociationResult> {
    const emails = uniqueEmails([...(input.attendeeEmails ?? []), ...(input.participantEmails ?? [])]);
    const clients = await tx.client.findMany({
      where: { tenantId, status: { not: 'archived' } },
      select: {
        id: true,
        name: true,
        website: true,
        primaryContactEmail: true,
        intakeData: true,
      },
    });

    if (clients.length === 0) {
      return {
        clientId: null,
        score: 0,
        reason: 'No active clients exist for this tenant.',
        signals: { emails },
      };
    }

    const knownContacts = emails.length
      ? await tx.engagementContact.findMany({
          where: { tenantId, email: { in: emails }, clientId: { not: null } },
          select: { email: true, clientId: true },
        })
      : [];

    const historicalMeetings = emails.length
      ? await tx.meeting.findMany({
          where: {
            tenantId,
            clientId: { not: null },
            attendees: { some: { email: { in: emails } } },
          },
          select: { clientId: true },
          take: 25,
        })
      : [];

    const text = `${input.subject ?? ''} ${input.body ?? ''}`.toLowerCase();
    const emailDomains = unique(emails.map(domainFromEmail).filter((item): item is string => Boolean(item)));
    const scored = clients.map((client) =>
      scoreClient(client, {
        emails,
        emailDomains,
        knownContacts,
        historicalMeetings,
        text,
      }),
    );

    const best = scored.sort((left, right) => right.score - left.score)[0];
    if (!best || best.score < AUTO_LINK_THRESHOLD) {
      return {
        clientId: null,
        score: best?.score ?? 0,
        reason:
          best?.score && best.score > 0
            ? `Closest match was ${best.clientName}, but confidence was below the automatic link threshold.`
            : 'No client match found from attendee domains, contacts, history, or subject/body.',
        signals: { emails, emailDomains, candidates: scored.slice(0, 5) },
      };
    }

    return {
      clientId: best.clientId,
      score: roundScore(best.score),
      reason: best.reasons.join(' '),
      signals: { emails, emailDomains, candidates: scored.slice(0, 5) },
    };
  }
}

function scoreClient(
  client: ClientForAssociation,
  context: {
    emails: string[];
    emailDomains: string[];
    knownContacts: Array<{ email: string | null; clientId: string | null }>;
    historicalMeetings: Array<{ clientId: string | null }>;
    text: string;
  },
) {
  let score = 0;
  const reasons: string[] = [];
  const clientDomain = normalizeDomain(domainFromWebsite(client.website));
  const primaryDomain = normalizeDomain(domainFromEmail(client.primaryContactEmail ?? undefined));
  const clientNameKey = normalizeName(client.name);
  const clientTokens = significantTokens(
    [
      client.name,
      client.website ?? '',
      intakeText(client.intakeData),
    ].join(' '),
  );

  const contactHit = context.knownContacts.find((contact) => contact.clientId === client.id);
  if (contactHit?.email) {
    score = Math.max(score, 0.95);
    reasons.push(`Known contact ${contactHit.email} belongs to ${client.name}.`);
  }

  for (const domain of context.emailDomains) {
    const normalizedDomain = normalizeDomain(domain);
    if (normalizedDomain && (normalizedDomain === clientDomain || normalizedDomain === primaryDomain)) {
      score = Math.max(score, 0.86);
      reasons.push(`Attendee email domain ${domain} matches ${client.name}.`);
    }

    const domainKey = normalizeName(normalizedDomain?.split('.')[0] ?? '');
    if (domainKey && clientNameKey) {
      const similarity = similarityScore(domainKey, clientNameKey);
      if (similarity >= 0.72) {
        score = Math.max(score, 0.68 + similarity * 0.12);
        reasons.push(`Attendee domain ${domain} is close to client name ${client.name}.`);
      }
    }
  }

  const historicalCount = context.historicalMeetings.filter(
    (meeting) => meeting.clientId === client.id,
  ).length;
  if (historicalCount > 0) {
    score = Math.min(0.96, score + Math.min(0.16, historicalCount * 0.04));
    reasons.push(`${historicalCount} prior attendee pattern(s) point to ${client.name}.`);
  }

  const textTokens = significantTokens(context.text);
  const overlap = jaccard(clientTokens, textTokens);
  if (context.text.includes(client.name.toLowerCase()) || overlap >= 0.22) {
    const lexicalScore = context.text.includes(client.name.toLowerCase()) ? 0.72 : 0.44 + overlap;
    score = Math.max(score, lexicalScore);
    reasons.push(`Subject/body language aligns with ${client.name}.`);
  }

  return {
    clientId: client.id,
    clientName: client.name,
    score: roundScore(score),
    reasons: reasons.length ? reasons : ['No strong signals.'],
  };
}

function intakeText(value: Prisma.JsonValue): string {
  if (!value || typeof value !== 'object') return '';
  return JSON.stringify(value);
}

function uniqueEmails(values: string[]): string[] {
  return unique(
    values
      .map((value) => value.trim().toLowerCase())
      .filter((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)),
  );
}

function domainFromEmail(value?: string | null): string | null {
  const email = value?.trim().toLowerCase();
  if (!email || !email.includes('@')) return null;
  return email.split('@').pop() ?? null;
}

function domainFromWebsite(value?: string | null): string | null {
  if (!value) return null;
  const normalized = value.startsWith('http') ? value : `https://${value}`;
  try {
    return new URL(normalized).hostname;
  } catch {
    return value.replace(/^www\./, '').split('/')[0]?.toLowerCase() ?? null;
  }
}

function normalizeDomain(value?: string | null): string | null {
  const domain = value?.trim().toLowerCase().replace(/^www\./, '');
  return domain || null;
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function significantTokens(value: string): Set<string> {
  const stop = new Set(['inc', 'llc', 'corp', 'corporation', 'company', 'the', 'and', 'for']);
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3 && !stop.has(token)),
  );
}

function jaccard(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const item of left) {
    if (right.has(item)) intersection += 1;
  }
  return intersection / new Set([...left, ...right]).size;
}

function similarityScore(left: string, right: string): number {
  if (left === right) return 1;
  const maxLen = Math.max(left.length, right.length);
  if (maxLen === 0) return 0;
  return 1 - levenshtein(left, right) / maxLen;
}

function levenshtein(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let prevDiagonal = previous[0] ?? 0;
    previous[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const temp = previous[j] ?? 0;
      previous[j] = Math.min(
        (previous[j] ?? 0) + 1,
        (previous[j - 1] ?? 0) + 1,
        prevDiagonal + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
      prevDiagonal = temp;
    }
  }
  return previous[right.length] ?? 0;
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function roundScore(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 100) / 100;
}
