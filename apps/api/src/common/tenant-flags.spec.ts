import { describe, expect, test } from '@jest/globals';
import { tenantFeatureEnabled } from './tenant-flags.js';

describe('tenantFeatureEnabled', () => {
  test('reads explicit booleans from settings.clioFeatureFlags', () => {
    expect(tenantFeatureEnabled({ clioFeatureFlags: { runAnalysis: true } }, 'runAnalysis', false)).toBe(true);
    expect(tenantFeatureEnabled({ clioFeatureFlags: { runAnalysis: false } }, 'runAnalysis', true)).toBe(false);
  });

  test('falls back to the feature default when unset or malformed', () => {
    expect(tenantFeatureEnabled({}, 'runAnalysis', false)).toBe(false);
    expect(tenantFeatureEnabled({}, 'runAnalysis', true)).toBe(true);
    expect(tenantFeatureEnabled(null, 'runAnalysis', false)).toBe(false);
    expect(tenantFeatureEnabled({ clioFeatureFlags: 'oops' }, 'runAnalysis', true)).toBe(true);
    expect(tenantFeatureEnabled({ clioFeatureFlags: { runAnalysis: 'yes' } }, 'x', false)).toBe(false);
  });
});
