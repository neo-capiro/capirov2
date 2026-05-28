import { billStage, buildSectionNavMeta, daysUntil, formatDate, formatCompact, minutesAgoLabel } from './mappers.js';

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
    expect(formatDate(undefined)).toBe('—');
    expect(formatDate(null)).toBe('—');
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
});
