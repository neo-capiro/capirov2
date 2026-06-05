import { describe, expect, test } from '@jest/globals';
import { MICROSOFT_SCOPES } from './microsoft-oauth.service.js';
import { hasRequiredResourceScopes, normalizeScopeNames } from './microsoft-graph-sync.service.js';

/**
 * Guards the Microsoft 365 token-refresh scope gate. Regression context (2026-06-05):
 * persistRefreshedAccessToken() used to persist Azure's response `scopes`, which never
 * echoes `offline_access` (and may return resource scopes as full Graph URIs). The stored
 * scope set therefore lost `offline_access`, so getValidAccessToken()'s
 * `MICROSOFT_SCOPES.every(...)` check went permanently false and forced a token refresh on
 * EVERY sync/webhook — a refresh storm against Azure (~1.2k warnings in 3 days for one
 * already-connected mailbox). The scope gate must be tolerant of how Azure reports scopes.
 */
describe('hasRequiredResourceScopes', () => {
  test('accepts the canonical requested scope set', () => {
    expect(hasRequiredResourceScopes(MICROSOFT_SCOPES)).toBe(true);
  });

  test('accepts a refresh response that omits offline_access (the storm regression)', () => {
    // Azure deliberately never returns offline_access/openid/profile in the scope claim.
    const azureRefreshScopes = [
      'User.Read',
      'Mail.Read',
      'Mail.ReadWrite',
      'Mail.Send',
      'Calendars.Read',
    ];
    expect(hasRequiredResourceScopes(azureRefreshScopes)).toBe(true);
  });

  test('accepts full Graph resource-URI scope forms', () => {
    const uriScopes = [
      'https://graph.microsoft.com/User.Read',
      'https://graph.microsoft.com/Mail.Read',
      'https://graph.microsoft.com/Mail.ReadWrite',
      'https://graph.microsoft.com/Mail.Send',
      'https://graph.microsoft.com/Calendars.Read',
    ];
    expect(hasRequiredResourceScopes(uriScopes)).toBe(true);
  });

  test('is case-insensitive', () => {
    expect(
      hasRequiredResourceScopes([
        'user.read',
        'mail.read',
        'mail.readwrite',
        'mail.send',
        'calendars.read',
      ]),
    ).toBe(true);
  });

  test('rejects when a real resource scope is genuinely missing', () => {
    const missingSend = ['User.Read', 'Mail.Read', 'Mail.ReadWrite', 'Calendars.Read'];
    expect(hasRequiredResourceScopes(missingSend)).toBe(false);
  });

  test('rejects empty / undefined scope sets', () => {
    expect(hasRequiredResourceScopes([])).toBe(false);
    expect(hasRequiredResourceScopes(undefined)).toBe(false);
  });
});

describe('normalizeScopeNames', () => {
  test('lower-cases and strips the Graph resource-URI prefix', () => {
    const normalized = normalizeScopeNames([
      'https://graph.microsoft.com/Mail.Read',
      'Calendars.Read',
    ]);
    expect(normalized.has('mail.read')).toBe(true);
    expect(normalized.has('calendars.read')).toBe(true);
  });
});
