import { describe, expect, jest, test } from '@jest/globals';
import { ProgramElementMetricsService } from './program-element-metrics.service.js';

describe('ProgramElementMetricsService', () => {
  test('emits structured metric logs for count/seconds/gauge', async () => {
    const service = new ProgramElementMetricsService();

    const loggerRef = (service as unknown as { logger: { log: (message: string) => void } }).logger;
    const logSpy = jest.spyOn(loggerRef, 'log').mockImplementation(() => undefined);

    await service.emitCount('pe_sync.rows_inserted', 5, 'r_doc_army');
    await service.emitSeconds('pe_sync.duration_seconds', 12.5, 'r_doc_army');
    await service.emitGauge('pe_sync.quarantine_count', 4, 'r_doc_army');

    expect(logSpy).toHaveBeenCalledTimes(3);

    const first = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as { MetricName: string; Value: number; Dimensions: Array<{ Name: string; Value: string }> };
    expect(first.MetricName).toBe('pe_sync.rows_inserted');
    expect(first.Value).toBe(5);
    expect(first.Dimensions).toEqual([{ Name: 'source', Value: 'r_doc_army' }]);

    logSpy.mockRestore();
  });
});
