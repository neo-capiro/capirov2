import { describe, expect, test } from '@jest/globals';
import { buildAuthorizeUrl, needsRefresh, type OAuthConfig } from './connector.types.js';

describe('needsRefresh', () => {
  const now = 1_000_000;
  test('no creds / no token => refresh', () => {
    expect(needsRefresh(null, now)).toBe(true);
    expect(needsRefresh({ accessToken: '' }, now)).toBe(true);
  });
  test('no expiry => assume valid', () => {
    expect(needsRefresh({ accessToken: 't' }, now)).toBe(false);
  });
  test('expired or within skew => refresh; comfortably valid => no', () => {
    expect(needsRefresh({ accessToken: 't', expiresAt: now - 1 }, now)).toBe(true);
    expect(needsRefresh({ accessToken: 't', expiresAt: now + 30_000 }, now, 60_000)).toBe(true);
    expect(needsRefresh({ accessToken: 't', expiresAt: now + 600_000 }, now, 60_000)).toBe(false);
  });
});

describe('buildAuthorizeUrl', () => {
  const config: OAuthConfig = {
    clientId: 'abc',
    clientSecret: 'secret',
    authorizeUrl: 'https://login.example.com/authorize',
    tokenUrl: 'https://login.example.com/token',
    redirectUri: 'https://app.capiro.ai/api/clio/connectors/cb',
    scopes: ['files.read', 'offline_access'],
  };
  test('includes the standard OAuth code-flow params', () => {
    const url = new URL(buildAuthorizeUrl(config, 'xyz-state'));
    expect(url.searchParams.get('client_id')).toBe('abc');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toBe('files.read offline_access');
    expect(url.searchParams.get('state')).toBe('xyz-state');
    expect(url.searchParams.get('redirect_uri')).toBe(config.redirectUri);
    // never leaks the secret into the front-channel URL
    expect(url.toString()).not.toContain('secret');
  });
});
