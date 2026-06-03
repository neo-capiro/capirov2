import {
  billStage,
  buildSectionNavMeta,
  daysUntil,
  formatBillIdentifier,
  formatCompact,
  formatDate,
  formatRatio,
  minutesAgoLabel,
} from './mappers.js';

describe('intelligence-v1 mappers fallbacks', () => {
  test('buildSectionNavMeta returns safe defaults for missing profile payload', () => {
    const meta = buildSectionNavMeta(null);
    expect(meta).toEqual({ syncedAt: null, sourceCount: 0 });
  });

  test('buildSectionNavMeta counts only matched sources when payload is partially missing', () => {
    const meta = buildSectionNavMeta({
      lastUpdated: '2026-05-27T10:00:00.000Z',
      lda: { matched: true },
      contracting: {},
      lobbyIntel: { matched: false },
    } as any);

    expect(meta.syncedAt).toBe('2026-05-27T10:00:00.000Z');
    expect(meta.sourceCount).toBe(1);
  });

  test('formatCompact tolerates malformed numeric inputs', () => {
    expect(formatCompact(undefined)).toBe('$0');
    expect(formatCompact(null)).toBe('$0');
    expect(formatCompact(Number.NaN)).toBe('$0');
    expect(formatCompact(0)).toBe('$0');
  });

  test('formatDate falls back safely for missing or malformed date strings', () => {
    expect(formatDate(undefined)).toBe('-');
    expect(formatDate(null)).toBe('-');
    expect(formatDate('not-a-date')).toBe('not-a-date');
  });

  test('daysUntil returns null for malformed/missing payload values', () => {
    expect(daysUntil(undefined)).toBeNull();
    expect(daysUntil(null)).toBeNull();
    expect(daysUntil('bad-date')).toBeNull();
  });

  test('billStage remains deterministic for missing or noisy latestActionText', () => {
    expect(billStage(undefined)).toBe('introduced');
    expect(billStage(null)).toBe('introduced');
    expect(billStage('Referred to committee on energy and commerce')).toBe('committee');
    expect(billStage('Passed House by recorded vote')).toBe('passed');
    expect(billStage('Became Public Law No: 119-17')).toBe('enacted');
  });

  test('minutesAgoLabel handles malformed timestamp input without throwing', () => {
    expect(minutesAgoLabel(undefined)).toBe('Synced recently');
    expect(minutesAgoLabel(null)).toBe('Synced recently');
    expect(minutesAgoLabel('not-a-timestamp')).toBe('Synced recently');
  });

  test('formatBillIdentifier humanizes congress bill slugs and passes through unknowns', () => {
    expect(formatBillIdentifier('119-hr-1742')).toBe('H.R. 1742');
    expect(formatBillIdentifier('119-s-260')).toBe('S. 260');
    expect(formatBillIdentifier('118-hjres-100')).toBe('H.J.Res. 100');
    expect(formatBillIdentifier('119-sconres-5')).toBe('S.Con.Res. 5');
    // Unknown bill type / unparseable slug is returned verbatim, never mangled.
    expect(formatBillIdentifier('119-zz-9')).toBe('119-zz-9');
    expect(formatBillIdentifier('not-a-bill')).toBe('not-a-bill');
    expect(formatBillIdentifier('')).toBe('');
    expect(formatBillIdentifier(null)).toBe('');
    expect(formatBillIdentifier(undefined)).toBe('');
  });

  test('formatRatio rounds large ratios and keeps a decimal for small ones', () => {
    expect(formatRatio(null)).toBe('-');
    expect(formatRatio(undefined)).toBe('-');
    expect(formatRatio(Number.NaN)).toBe('-');
    expect(formatRatio(Number.POSITIVE_INFINITY)).toBe('-');
    expect(formatRatio(2.4)).toBe('2.4×');
    expect(formatRatio(99.9)).toBe('99.9×');
    // >= 100 rounds and adds thousands separators (no false precision).
    expect(formatRatio(14275.9)).toBe('14,276×');
    expect(formatRatio(20996.5)).toBe('20,997×');
  });
});
