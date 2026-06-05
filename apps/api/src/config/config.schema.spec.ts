import { describe, expect, test } from '@jest/globals';
import { configSchema } from './config.schema.js';

/**
 * Guards the Microsoft 365 OAuth authority configuration. Regression context:
 * the authority was hard-pinned to a single Azure AD tenant (the capiro.ai
 * tenant GUID via MICROSOFT_TENANT_ID), which rejected every customer on a
 * different M365 tenant (e.g. c2strategies.com) with AADSTS50020. It must
 * default to the shared multi-tenant endpoint.
 */
describe('configSchema — MICROSOFT_AUTHORITY', () => {
  const field = configSchema.shape.MICROSOFT_AUTHORITY;

  test('defaults to the shared multi-tenant /organizations authority', () => {
    expect(field.parse(undefined)).toBe('https://login.microsoftonline.com/organizations');
  });

  test('default is multi-tenant, never pinned to a single tenant GUID', () => {
    const value = field.parse(undefined);
    expect(value).toMatch(/\/(organizations|common)$/);
    // A single-tenant authority embeds a tenant GUID — that must never be the default.
    expect(value).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });

  test('is overridable for a deliberate single-tenant deployment, and must be a URL', () => {
    expect(field.parse('https://login.microsoftonline.com/common')).toBe(
      'https://login.microsoftonline.com/common',
    );
    expect(() => field.parse('organizations')).toThrow();
  });
});
