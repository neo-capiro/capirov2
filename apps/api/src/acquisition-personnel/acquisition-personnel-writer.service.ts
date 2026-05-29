import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { MatchScorerService } from './matching/match-scorer.service.js';
import { normalizeName } from './normalization/name-normalizer.js';
import { PersonRecordInput } from './types.js';

export class MissingRequiredFieldError extends BadRequestException {
  constructor(field: string) {
    super(`Missing required field: ${field}`);
    this.name = 'MissingRequiredFieldError';
  }
}

@Injectable()
export class AcquisitionPersonnelWriterService {
  private readonly logger = new Logger(AcquisitionPersonnelWriterService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly matchScorer: MatchScorerService,
  ) {}

  async upsertPerson(
    record: PersonRecordInput,
    source: string,
    sourceUrl: string | undefined,
    snippet: string | undefined,
    observedAt: Date,
    confidence: number,
  ): Promise<{ inserted: boolean; person_id: string; mergedWith?: string }> {
    const fullName = (record.fullName ?? '').trim();
    if (!fullName) {
      await this.quarantine(record, 'Missing required field: full_name', source);
      throw new MissingRequiredFieldError('full_name');
    }

    const normalized = normalizeName(fullName);
    const emailDomain = this.extractEmailDomain(record.email, record.emailDomain);

    const matches = await this.matchScorer.findMatches({
      fullName,
      organization: record.organization ?? undefined,
      title: record.title ?? undefined,
      emailDomain: emailDomain ?? undefined,
      programs: record.programs ?? undefined,
      peCodesMentioned: record.peCodesMentioned ?? undefined,
    });

    const top = matches[0];
    if (top && top.score >= 0.92) {
      await this.addSourceMention(top.personId, source, sourceUrl, snippet, observedAt, confidence);
      return { inserted: false, person_id: top.personId, mergedWith: top.personId };
    }

    const created = await this.prisma.acquisitionPersonnel.create({
      data: {
        fullName,
        nameKey: normalized.nameKey,
        service: record.service ?? null,
        organization: record.organization ?? null,
        title: record.title ?? null,
        role: record.role ?? null,
        programOfRecord: record.programOfRecord ?? null,
        pePrimary: record.pePrimary ?? null,
        peSecondary: record.peSecondary ?? [],
        emailDomain,
        publicProfileUrl: record.publicProfileUrl ?? null,
        confidence: this.capConfidence(confidence),
        status: 'active',
        metadata: this.toJsonValue(record.metadata ?? {}),
        firstSeenAt: observedAt,
        lastSeenAt: observedAt,
      },
    });

    await this.addSourceMention(created.id, source, sourceUrl, snippet, observedAt, confidence);

    if (top && top.score >= 0.7 && top.score < 0.92) {
      await this.prisma.acquisitionPersonnelMergeCandidate.create({
        data: {
          primaryPersonId: top.personId,
          secondaryPersonId: created.id,
          similarityScore: top.score,
          scoreBreakdown: this.toJsonValue(top.breakdown),
          status: 'open',
        },
      });
    }

    return { inserted: true, person_id: created.id, mergedWith: top?.personId };
  }

  async addSourceMention(
    personId: string,
    source: string,
    sourceUrl: string | undefined,
    snippet: string | undefined,
    observedAt: Date,
    confidence: number,
  ): Promise<boolean> {
    const person = await this.prisma.acquisitionPersonnel.findUnique({ where: { id: personId } });
    if (!person) return false;

    const existing = await this.prisma.acquisitionPersonnelSource.findFirst({
      where: { personId, source, sourceUrl: sourceUrl ?? null },
      orderBy: { observedAt: 'desc' },
    });

    if (existing) {
      if (existing.observedAt.getTime() === observedAt.getTime() && existing.confidence === confidence) return false;
      await this.prisma.acquisitionPersonnelSource.update({
        where: { id: existing.id },
        data: { observedAt, snippet: snippet ?? existing.snippet, confidence },
      });
    } else {
      await this.prisma.acquisitionPersonnelSource.create({
        data: {
          personId,
          source,
          sourceUrl: sourceUrl ?? null,
          snippet: snippet ?? null,
          observedAt,
          confidence,
        },
      });
    }

    const mentions = await this.prisma.acquisitionPersonnelSource.findMany({ where: { personId } });
    const nextConfidence = this.aggregateConfidence(mentions.map((m) => m.confidence));

    await this.prisma.acquisitionPersonnel.update({
      where: { id: personId },
      data: {
        confidence: nextConfidence,
        lastSeenAt: observedAt > person.lastSeenAt ? observedAt : person.lastSeenAt,
      },
    });

    return true;
  }

  async mergePersons(primaryId: string, secondaryId: string, userId: string): Promise<void> {
    if (primaryId === secondaryId) return;
    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const [primary, secondary] = await Promise.all([
        tx.acquisitionPersonnel.findUnique({ where: { id: primaryId } }),
        tx.acquisitionPersonnel.findUnique({ where: { id: secondaryId } }),
      ]);
      if (!primary || !secondary) return;

      await tx.acquisitionPersonnelSource.updateMany({ where: { personId: secondaryId }, data: { personId: primaryId } });

      const mergedPeSecondary = Array.from(new Set([...(primary.peSecondary ?? []), ...(secondary.peSecondary ?? [])]));
      const mergedConfidence = this.aggregateConfidence([primary.confidence, secondary.confidence]);

      await tx.acquisitionPersonnel.update({
        where: { id: primaryId },
        data: {
          peSecondary: mergedPeSecondary,
          confidence: mergedConfidence,
          lastSeenAt: primary.lastSeenAt > secondary.lastSeenAt ? primary.lastSeenAt : secondary.lastSeenAt,
        },
      });

      await tx.acquisitionPersonnelMergeCandidate.updateMany({
        where: {
          OR: [
            { primaryPersonId: primaryId, secondaryPersonId: secondaryId },
            { primaryPersonId: secondaryId, secondaryPersonId: primaryId },
          ],
          status: 'open',
        },
        data: {
          status: 'merged',
          resolvedByUserId: userId,
          resolvedAt: new Date(),
          decisionNotes: 'merged by writer.mergePersons',
        },
      });

      await tx.acquisitionPersonnel.delete({ where: { id: secondaryId } });
    });
  }

  async markDeparted(personId: string, asOfDate: Date): Promise<void> {
    await this.prisma.acquisitionPersonnel.update({
      where: { id: personId },
      data: { status: 'departed', lastSeenAt: asOfDate },
    });
  }

  async quarantine(rawRecord: unknown, reason: string, source: string): Promise<void> {
    await this.prisma.acquisitionPersonnelQuarantine.create({
      data: { rawRecord: this.toJsonValue(rawRecord), reason, source },
    });
    this.logger.warn(`Acquisition personnel quarantined: ${reason} (${source})`);
  }

  private extractEmailDomain(email?: string | null, domain?: string | null): string | null {
    const source = email?.trim() || domain?.trim();
    if (!source) return null;
    const lowered = source.toLowerCase();
    if (lowered.includes('@')) return lowered.split('@')[1] ?? null;
    return lowered;
  }

  private aggregateConfidence(values: number[]): number {
    if (values.length === 0) return 0.5;
    let product = 1;
    for (const raw of values) {
      const value = this.capConfidence(raw);
      product *= 1 - value;
    }
    return this.capConfidence(1 - product);
  }

  private capConfidence(value: number): number {
    if (!Number.isFinite(value)) return 0.5;
    if (value <= 0) return 0;
    return Math.min(0.999, value);
  }

  private toJsonValue(input: unknown): Prisma.InputJsonValue {
    if (input === null || input === undefined) return {};
    return JSON.parse(JSON.stringify(input)) as Prisma.InputJsonValue;
  }
}
