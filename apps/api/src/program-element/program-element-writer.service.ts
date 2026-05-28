import { Injectable, Logger } from '@nestjs/common';
import { Prisma, ProgramElementYear } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { FieldDelta, PeMilestoneInput, PeRecordInput, PeYearInput, SOURCE_PRIORITY } from './types.js';

const PE_CODE_REGEX = /^[0-9]{7}[A-Z]$/;

type YearChangeResult = {
  inserted: boolean;
  changed: boolean;
  delta?: FieldDelta[];
};

@Injectable()
export class ProgramElementWriterService {
  private readonly logger = new Logger(ProgramElementWriterService.name);

  constructor(private readonly prisma: PrismaService) {}

  async upsertProgramElement(
    record: PeRecordInput,
    source: string,
    sourceConfidence: number,
  ): Promise<{ inserted: boolean; pe_code: string }> {
    if (!this.isValidPeCode(record.peCode)) {
      await this.quarantine(record, `Invalid pe_code: ${record.peCode}`, source);
      return { inserted: false, pe_code: record.peCode };
    }

    const peCode = record.peCode;
    const existing = await this.prisma.programElement.findUnique({ where: { peCode } });

    const data: Prisma.ProgramElementUncheckedCreateInput = {
      peCode,
      service: record.service ?? null,
      serviceCode: record.serviceCode ?? null,
      appropriationType: record.appropriationType ?? null,
      budgetActivity: record.budgetActivity ?? null,
      budgetActivityName: record.budgetActivityName ?? null,
      lineNumber: record.lineNumber ?? null,
      title: record.title,
      description: record.description ?? null,
      acatLevel: record.acatLevel ?? null,
      programOfRecord: record.programOfRecord ?? null,
      status: record.status ?? null,
      rDocUrl: record.rDocUrl ?? null,
      pDocUrl: record.pDocUrl ?? null,
      oDocUrl: record.oDocUrl ?? null,
      raw: this.toJsonValue(record.raw),
      source,
      sourceConfidence,
      firstSeenFy: record.firstSeenFy ?? null,
      lastSyncedAt: new Date(),
    };

    if (!existing) {
      await this.prisma.programElement.create({ data });
      return { inserted: true, pe_code: peCode };
    }

    await this.prisma.programElement.update({
      where: { peCode },
      data: {
        ...data,
        firstSeenFy: existing.firstSeenFy ?? data.firstSeenFy,
      },
    });

    return { inserted: false, pe_code: peCode };
  }

  async upsertProgramElementYear(record: PeYearInput, source: string): Promise<YearChangeResult> {
    if (!this.isValidPeCode(record.peCode)) {
      await this.quarantine(record, `Invalid pe_code: ${record.peCode}`, source);
      return { inserted: false, changed: false };
    }

    const sourceRank = this.getSourceRank(source);
    const winner = await this.prisma.programElementYearSourceValue.findFirst({
      where: {
        peCode: record.peCode,
        fy: record.fy,
        fieldName: '__row__',
        isWinner: true,
      },
      orderBy: { recordedAt: 'desc' },
    });

    if (winner) {
      const winnerRank = this.getSourceRank(winner.source);
      if (sourceRank > winnerRank) {
        await this.logSourceValue(record, source, false);
        return { inserted: false, changed: false };
      }
    }

    const existing = await this.prisma.programElementYear.findUnique({
      where: { peCode_fy: { peCode: record.peCode, fy: record.fy } },
    });

    const normalized = this.normalizeYearInput(record);

    if (!existing) {
      await this.prisma.programElementYear.create({
        data: {
          ...normalized,
          peCode: record.peCode,
          fy: record.fy,
          lastSyncedAt: new Date(),
        },
      });
      await this.logSourceValue(record, source, true);
      return { inserted: true, changed: true };
    }

    const delta = this.computeYearDelta(existing, normalized);
    if (delta.length === 0) {
      await this.logSourceValue(record, source, true);
      return { inserted: false, changed: false };
    }

    await this.prisma.programElementYear.update({
      where: { peCode_fy: { peCode: record.peCode, fy: record.fy } },
      data: {
        ...normalized,
        lastSyncedAt: new Date(),
      },
    });

    await this.logSourceValue(record, source, true);
    return { inserted: false, changed: true, delta };
  }

  async upsertProgramElementMilestone(
    record: PeMilestoneInput,
    source: string,
  ): Promise<{ inserted: boolean }> {
    if (!this.isValidPeCode(record.peCode)) {
      await this.quarantine(record, `Invalid pe_code: ${record.peCode}`, source);
      return { inserted: false };
    }

    const existing = await this.prisma.programElementMilestone.findUnique({
      where: {
        peCode_milestoneType: {
          peCode: record.peCode,
          milestoneType: record.milestoneType,
        },
      },
    });

    const data: Prisma.ProgramElementMilestoneUncheckedCreateInput = {
      peCode: record.peCode,
      milestoneType: record.milestoneType,
      plannedDate: this.toDate(record.plannedDate),
      actualDate: this.toDate(record.actualDate),
      status: record.status ?? null,
      source,
      notes: record.notes ?? null,
      lastSyncedAt: new Date(),
    };

    if (!existing) {
      await this.prisma.programElementMilestone.create({ data });
      return { inserted: true };
    }

    await this.prisma.programElementMilestone.update({
      where: {
        peCode_milestoneType: {
          peCode: record.peCode,
          milestoneType: record.milestoneType,
        },
      },
      data,
    });

    return { inserted: false };
  }

  async quarantine(rawRecord: unknown, reason: string, source: string): Promise<void> {
    await this.prisma.programElementQuarantine.create({
      data: {
        rawRecord: this.toJsonValue(rawRecord),
        reason,
        source,
      },
    });
    this.logger.warn(`Program element quarantined: ${reason} (${source})`);
  }

  private isValidPeCode(peCode: string): boolean {
    return PE_CODE_REGEX.test(peCode);
  }

  private getSourceRank(source: string): number {
    const idx = SOURCE_PRIORITY.indexOf(source as (typeof SOURCE_PRIORITY)[number]);
    return idx === -1 ? SOURCE_PRIORITY.length : idx;
  }

  private normalizeYearInput(
    record: PeYearInput,
  ): Omit<Prisma.ProgramElementYearUncheckedCreateInput, 'id' | 'peCode' | 'fy' | 'lastSyncedAt'> {
    return {
      request: this.toDecimal(record.request),
      hascMark: this.toDecimal(record.hascMark),
      sascMark: this.toDecimal(record.sascMark),
      hacDMark: this.toDecimal(record.hacDMark),
      sacDMark: this.toDecimal(record.sacDMark),
      conference: this.toDecimal(record.conference),
      enacted: this.toDecimal(record.enacted),
      reprogrammed: this.toDecimal(record.reprogrammed),
      executed: this.toDecimal(record.executed),
      notes: record.notes ?? null,
      rDocSection: record.rDocSection ?? null,
      raw: this.toJsonValue(record.raw),
    };
  }

  private computeYearDelta(
    existing: ProgramElementYear,
    incoming: Omit<Prisma.ProgramElementYearUncheckedCreateInput, 'id' | 'peCode' | 'fy' | 'lastSyncedAt'>,
  ): FieldDelta[] {
    const fields: Array<keyof Omit<Prisma.ProgramElementYearUncheckedCreateInput, 'id' | 'peCode' | 'fy' | 'lastSyncedAt'>> = [
      'request',
      'hascMark',
      'sascMark',
      'hacDMark',
      'sacDMark',
      'conference',
      'enacted',
      'reprogrammed',
      'executed',
      'notes',
      'rDocSection',
      'raw',
    ];

    const delta: FieldDelta[] = [];

    for (const field of fields) {
      const newValue = incoming[field];
      const oldValue = (existing as Record<string, unknown>)[field as string];
      const normalizedOld = this.normalizeComparableValue(oldValue);
      const normalizedNew = this.normalizeComparableValue(newValue);
      if (!this.valuesEqual(normalizedOld, normalizedNew)) {
        delta.push({ field, oldValue: normalizedOld, newValue: normalizedNew });
      }
    }

    return delta;
  }

  private async logSourceValue(record: PeYearInput, source: string, isWinner: boolean): Promise<void> {
    if (isWinner) {
      await this.prisma.programElementYearSourceValue.updateMany({
        where: {
          peCode: record.peCode,
          fy: record.fy,
          fieldName: '__row__',
          isWinner: true,
        },
        data: { isWinner: false },
      });
    }

    await this.prisma.programElementYearSourceValue.create({
      data: {
        peCode: record.peCode,
        fy: record.fy,
        fieldName: '__row__',
        source,
        valueJsonb: this.toJsonValue(record),
        isWinner,
      },
    });
  }

  private valuesEqual(a: unknown, b: unknown): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  private normalizeComparableValue(value: unknown): unknown {
    if (value instanceof Prisma.Decimal) return value.toString();
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'undefined') return null;
    return value;
  }

  private toDecimal(value: string | number | null | undefined): Prisma.Decimal | null {
    if (value === null || value === undefined || value === '') return null;
    return new Prisma.Decimal(value);
  }

  private toDate(value: Date | string | null | undefined): Date | null {
    if (!value) return null;
    return value instanceof Date ? value : new Date(value);
  }

  private toJsonValue(value: unknown): Prisma.InputJsonValue {
    if (value === undefined || value === null) return {};
    if (this.isJsonValue(value)) {
      return value;
    }
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  private isJsonValue(value: unknown): value is Prisma.InputJsonValue {
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      return true;
    }

    if (Array.isArray(value)) {
      return value.every((item) => this.isJsonValue(item));
    }

    if (typeof value === 'object') {
      return Object.values(value as Record<string, unknown>).every((item) => this.isJsonValue(item));
    }

    return false;
  }
}
