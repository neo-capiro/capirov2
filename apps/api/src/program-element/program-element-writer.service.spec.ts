import { describe, expect, jest, test } from '@jest/globals';
import { ProgramElementWriterService } from './program-element-writer.service.js';

const basePe = {
  peCode: '0603270A',
  title: 'Test Program Element',
};

describe('ProgramElementWriterService', () => {
  test('Fresh PE upsert → inserted:true', async () => {
    const service = createService();

    const result = await service.upsertProgramElement(basePe, 'fixture', 0.9);

    expect(result).toEqual({ inserted: true, pe_code: '0603270A' });
  });

  test('Same PE again → inserted:false', async () => {
    const service = createService();

    await service.upsertProgramElement(basePe, 'fixture', 0.9);
    const result = await service.upsertProgramElement(basePe, 'fixture', 0.9);

    expect(result).toEqual({ inserted: false, pe_code: '0603270A' });
  });

  test('Update a year field → changed:true with delta', async () => {
    const service = createService();
    await service.upsertProgramElement(basePe, 'fixture', 0.9);

    await service.upsertProgramElementYear(
      {
        peCode: '0603270A',
        fy: 2026,
        request: '100.00',
      },
      'r_doc',
    );

    const result = await service.upsertProgramElementYear(
      {
        peCode: '0603270A',
        fy: 2026,
        request: '150.00',
      },
      'r_doc',
    );

    expect(result.inserted).toBe(false);
    expect(result.changed).toBe(true);
    expect(result.delta).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'request', oldValue: '100', newValue: '150' }),
      ]),
    );
  });

  test('No change → changed:false', async () => {
    const service = createService();
    await service.upsertProgramElement(basePe, 'fixture', 0.9);

    await service.upsertProgramElementYear(
      {
        peCode: '0603270A',
        fy: 2026,
        request: '100.00',
      },
      'r_doc',
    );

    const result = await service.upsertProgramElementYear(
      {
        peCode: '0603270A',
        fy: 2026,
        request: '100.00',
      },
      'r_doc',
    );

    expect(result).toEqual({ inserted: false, changed: false });
  });

  test('Bad pe_code → quarantined', async () => {
    const service = createService();

    const peResult = await service.upsertProgramElement({ peCode: 'BAD', title: 'Invalid' }, 'fixture', 0.1);
    const yearResult = await service.upsertProgramElementYear({ peCode: 'BAD', fy: 2026, request: '1.00' }, 'fixture');

    expect(peResult.inserted).toBe(false);
    expect(yearResult.changed).toBe(false);
    expect(service.__mock.quarantineRows.length).toBe(2);
  });

  test("Low-priority source doesn't override high-priority", async () => {
    const service = createService();
    await service.upsertProgramElement(basePe, 'fixture', 0.9);

    await service.upsertProgramElementYear(
      {
        peCode: '0603270A',
        fy: 2026,
        request: '500.00',
      },
      'conference_report',
    );

    const result = await service.upsertProgramElementYear(
      {
        peCode: '0603270A',
        fy: 2026,
        request: '100.00',
      },
      'fixture',
    );

    expect(result).toEqual({ inserted: false, changed: false });
    expect(String(service.__mock.years.get('0603270A::2026')?.request)).toBe('500');
  });
});

function createService(): ProgramElementWriterService & { __mock: ReturnType<typeof createPrismaMock> } {
  const mock = createPrismaMock();
  const service = new ProgramElementWriterService(mock as never) as ProgramElementWriterService & {
    __mock: ReturnType<typeof createPrismaMock>;
  };
  service.__mock = mock;
  return service;
}

function createPrismaMock() {
  const peRows = new Map<string, Record<string, unknown>>();
  const yearRows = new Map<string, Record<string, unknown>>();
  const milestoneRows = new Map<string, Record<string, unknown>>();
  const sourceRows: Array<Record<string, unknown>> = [];
  const quarantineRows: Array<Record<string, unknown>> = [];

  type PeWhere = { peCode: string };
  type PeData = Record<string, unknown> & { peCode: string };
  type PeYearWhere = { peCode_fy: { peCode: string; fy: number } };
  type PeYearData = Record<string, unknown> & { peCode: string; fy: number; id?: string };
  type MilestoneWhere = { peCode_milestoneType: { peCode: string; milestoneType: string } };
  type MilestoneData = Record<string, unknown> & { peCode: string; milestoneType: string };
  type SourceWhere = { peCode: string; fy: number; fieldName: string; isWinner: boolean };
  type SourceData = Record<string, unknown> & { recordedAt?: string };
  type QuarantineData = Record<string, unknown>;

  const key = (peCode: string, fy: number) => `${peCode}::${fy}`;
  const mkey = (peCode: string, milestoneType: string) => `${peCode}::${milestoneType}`;

  return {
    __store: { peRows, yearRows, milestoneRows, sourceRows, quarantineRows },
    get quarantineRows() {
      return quarantineRows;
    },
    get years() {
      return yearRows;
    },
    programElement: {
      findUnique: jest.fn(async ({ where }: { where: PeWhere }) => peRows.get(where.peCode) ?? null),
      create: jest.fn(async ({ data }: { data: PeData }) => {
        peRows.set(data.peCode, { ...data });
        return { ...data };
      }),
      update: jest.fn(async ({ where, data }: { where: PeWhere; data: Record<string, unknown> }) => {
        const current = peRows.get(where.peCode) ?? {};
        const next = { ...current, ...data };
        peRows.set(where.peCode, next);
        return next;
      }),
    },
    programElementYear: {
      findUnique: jest.fn(async ({ where }: { where: PeYearWhere }) => yearRows.get(key(where.peCode_fy.peCode, where.peCode_fy.fy)) ?? null),
      create: jest.fn(async ({ data }: { data: PeYearData }) => {
        const row = {
          id: data.id ?? `${Date.now()}`,
          ...data,
        };
        yearRows.set(key(data.peCode, data.fy), row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: { where: PeYearWhere; data: Record<string, unknown> }) => {
        const k = key(where.peCode_fy.peCode, where.peCode_fy.fy);
        const current = yearRows.get(k) ?? {};
        const next = { ...current, ...data };
        yearRows.set(k, next);
        return next;
      }),
    },
    programElementMilestone: {
      findUnique: jest.fn(async ({ where }: { where: MilestoneWhere }) =>
        milestoneRows.get(mkey(where.peCode_milestoneType.peCode, where.peCode_milestoneType.milestoneType)) ?? null,
      ),
      create: jest.fn(async ({ data }: { data: MilestoneData }) => {
        milestoneRows.set(mkey(data.peCode, data.milestoneType), { ...data });
        return { ...data };
      }),
      update: jest.fn(async ({ where, data }: { where: MilestoneWhere; data: Record<string, unknown> }) => {
        const k = mkey(where.peCode_milestoneType.peCode, where.peCode_milestoneType.milestoneType);
        const current = milestoneRows.get(k) ?? {};
        const next = { ...current, ...data };
        milestoneRows.set(k, next);
        return next;
      }),
    },
    programElementYearSourceValue: {
      findFirst: jest.fn(async ({ where }: { where: SourceWhere }) => {
        const filtered = sourceRows
          .filter(
            (r) =>
              r.peCode === where.peCode &&
              r.fy === where.fy &&
              r.fieldName === where.fieldName &&
              r.isWinner === where.isWinner,
          )
          .sort((a, b) => String(b.recordedAt).localeCompare(String(a.recordedAt)));
        return filtered[0] ?? null;
      }),
      updateMany: jest.fn(async ({ where, data }: { where: SourceWhere; data: Record<string, unknown> }) => {
        let count = 0;
        for (const row of sourceRows) {
          if (
            row.peCode === where.peCode &&
            row.fy === where.fy &&
            row.fieldName === where.fieldName &&
            row.isWinner === where.isWinner
          ) {
            Object.assign(row, data);
            count += 1;
          }
        }
        return { count };
      }),
      create: jest.fn(async ({ data }: { data: SourceData }) => {
        const row = { ...data, recordedAt: data.recordedAt ?? new Date().toISOString() };
        sourceRows.push(row);
        return row;
      }),
    },
    programElementQuarantine: {
      create: jest.fn(async ({ data }: { data: QuarantineData }) => {
        quarantineRows.push(data);
        return data;
      }),
    },
  };
}
