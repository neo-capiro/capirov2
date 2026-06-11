/**
 * Per-tenant Clio feature flags (assistant-parity cross-cutting convention).
 *
 * Flags live under tenants.settings_jsonb.clioFeatureFlags, e.g.
 *   { "clioFeatureFlags": { "runAnalysis": true } }
 * and compose with env kill-switches: a feature is active only when its env
 * switch is on AND the tenant flag resolves true (each feature picks its own
 * tenant default — pilot features default false, GA features default true).
 * Pure so it unit-tests under `src/**.spec.ts`.
 */

export function tenantFeatureEnabled(
  settings: unknown,
  flag: string,
  defaultValue: boolean,
): boolean {
  if (settings && typeof settings === 'object' && !Array.isArray(settings)) {
    const flags = (settings as Record<string, unknown>).clioFeatureFlags;
    if (flags && typeof flags === 'object' && !Array.isArray(flags)) {
      const value = (flags as Record<string, unknown>)[flag];
      if (typeof value === 'boolean') return value;
    }
  }
  return defaultValue;
}
