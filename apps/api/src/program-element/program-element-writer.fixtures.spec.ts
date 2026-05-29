import { describe, expect, test } from '@jest/globals';
import {
  PROGRAM_ELEMENT_FIXTURES,
  REQUIRED_PE_CODES,
  type ProgramElementFixture,
} from './program-element-fixture-data.js';

interface ProgramElementWriterLike {
  upsertProgramElement(
    record: ProgramElementFixture['record'],
    source: string,
    sourceConfidence: number,
  ): Promise<{ inserted: boolean; pe_code: string }>;
  upsertProgramElementYear(
    record: ProgramElementFixture['years'][number],
    source: string,
  ): Promise<{ inserted: boolean; changed: boolean; delta?: Array<{ field: string; oldValue: unknown; newValue: unknown }> }>;
  upsertProgramElementMilestone(
    record: ProgramElementFixture['milestones'][number],
    source: string,
  ): Promise<{ inserted: boolean }>;
  refreshProgramElementDetailMaterializedView(source?: string): Promise<void>;
  emitRunSummary(source: string, startedAt: Date, inserted: number, updated: number, quarantined: number): Promise<void>;
  emitRunError(source: string): Promise<void>;
  emitInventoryMetrics(source?: string): Promise<void>;
}

interface SeedSummary {
  peInserted: number;
  yearInserted: number;
  yearChanged: number;
  milestoneInserted: number;
}

async function runSeed(writer: ProgramElementWriterLike): Promise<SeedSummary> {
  const startedAt = new Date();
  const summary: SeedSummary = {
    peInserted: 0,
    yearInserted: 0,
    yearChanged: 0,
    milestoneInserted: 0,
  };

  for (const fixture of PROGRAM_ELEMENT_FIXTURES) {
    const peResult = await writer.upsertProgramElement(fixture.record, 'fixture', 0.99);
    if (peResult.inserted) summary.peInserted += 1;

    for (const yearRecord of fixture.years) {
      const yearResult = await writer.upsertProgramElementYear(yearRecord, 'fixture');
      if (yearResult.inserted) summary.yearInserted += 1;
      if (yearResult.changed) summary.yearChanged += 1;
    }

    for (const milestoneRecord of fixture.milestones) {
      const milestoneResult = await writer.upsertProgramElementMilestone(milestoneRecord, 'fixture');
      if (milestoneResult.inserted) summary.milestoneInserted += 1;
    }
  }

  await writer.refreshProgramElementDetailMaterializedView('fixture');
  await writer.emitRunSummary(
    'fixture',
    startedAt,
    summary.peInserted + summary.yearInserted + summary.milestoneInserted,
    summary.yearChanged,
    0,
  );
  await writer.emitInventoryMetrics('fixture');

  return summary;
}

describe('program element fixture seed', () => {
  test('fixture set contains 10-15 PEs with required codes and 5 FY rows each', () => {
    expect(PROGRAM_ELEMENT_FIXTURES.length).toBeGreaterThanOrEqual(10);
    expect(PROGRAM_ELEMENT_FIXTURES.length).toBeLessThanOrEqual(15);

    const peCodes = new Set(PROGRAM_ELEMENT_FIXTURES.map((fixture: ProgramElementFixture) => fixture.record.peCode));
    for (const requiredCode of REQUIRED_PE_CODES) {
      expect(peCodes.has(requiredCode)).toBe(true);
    }

    for (const fixture of PROGRAM_ELEMENT_FIXTURES) {
      expect(fixture.years).toHaveLength(5);
    }

    const inProgressCount = PROGRAM_ELEMENT_FIXTURES.filter((fixture: ProgramElementFixture) =>
      fixture.years.some(
        (year: ProgramElementFixture['years'][number]) =>
          year.fy === fixture.currentCycleFy &&
          year.request != null &&
          year.hascMark == null &&
          year.sascMark == null,
      ),
    ).length;
    expect(inProgressCount).toBe(3);
  });

  test('seeding is idempotent when run twice', async () => {
    const writer = new InMemoryWriter();

    const first = await runSeed(writer);
    const second = await runSeed(writer);

    expect(first.peInserted).toBe(PROGRAM_ELEMENT_FIXTURES.length);
    expect(first.yearInserted).toBe(PROGRAM_ELEMENT_FIXTURES.length * 5);
    expect(first.yearChanged).toBe(PROGRAM_ELEMENT_FIXTURES.length * 5);
    expect(first.milestoneInserted).toBeGreaterThan(0);

    expect(second.peInserted).toBe(0);
    expect(second.yearInserted).toBe(0);
    expect(second.yearChanged).toBe(0);
    expect(second.milestoneInserted).toBe(0);
    expect(writer.refreshCalls).toBe(2);
    expect(writer.runSummaryCalls).toBe(2);
    expect(writer.inventoryMetricCalls).toBe(2);
    expect(writer.runErrorCalls).toBe(0);
  });
});

class InMemoryWriter implements ProgramElementWriterLike {
  private peCodes = new Set<string>();
  private years = new Map<string, string>();
  private milestones = new Set<string>();
  refreshCalls = 0;
  runSummaryCalls = 0;
  runErrorCalls = 0;
  inventoryMetricCalls = 0;

  async upsertProgramElement(record: { peCode: string }): Promise<{ inserted: boolean; pe_code: string }> {
    const exists = this.peCodes.has(record.peCode);
    if (!exists) this.peCodes.add(record.peCode);
    return { inserted: !exists, pe_code: record.peCode };
  }

  async upsertProgramElementYear(
    record: Record<string, unknown> & { peCode: string; fy: number },
    _source: string,
  ): Promise<{ inserted: boolean; changed: boolean; delta?: { field: string; oldValue: unknown; newValue: unknown }[] }> {
    const key = `${record.peCode}::${record.fy}`;
    const payload = JSON.stringify(record);
    const existing = this.years.get(key);

    if (!existing) {
      this.years.set(key, payload);
      return { inserted: true, changed: true };
    }

    if (existing === payload) {
      return { inserted: false, changed: false };
    }

    this.years.set(key, payload);
    return {
      inserted: false,
      changed: true,
      delta: [{ field: 'row', oldValue: existing, newValue: payload }],
    };
  }

  async upsertProgramElementMilestone(
    record: { peCode: string; milestoneType: string },
    _source: string,
  ): Promise<{ inserted: boolean }> {
    const key = `${record.peCode}::${record.milestoneType}`;
    const exists = this.milestones.has(key);
    if (!exists) this.milestones.add(key);
    return { inserted: !exists };
  }

  async refreshProgramElementDetailMaterializedView(_source?: string): Promise<void> {
    this.refreshCalls += 1;
  }

  async emitRunSummary(
    _source: string,
    _startedAt: Date,
    _inserted: number,
    _updated: number,
    _quarantined: number,
  ): Promise<void> {
    this.runSummaryCalls += 1;
  }

  async emitRunError(_source: string): Promise<void> {
    this.runErrorCalls += 1;
  }

  async emitInventoryMetrics(_source?: string): Promise<void> {
    this.inventoryMetricCalls += 1;
  }
}
