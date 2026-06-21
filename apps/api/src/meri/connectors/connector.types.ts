/**
 * Shared connector + OAuth core for Meri external connectors (P2-10 / P3-2 / P3-3).
 *
 * Each connector (doc storage, CRM, chat) is defined as a provider interface
 * with an in-memory mock, so the feature is fully built + tested without live
 * credentials — drop a real provider implementation in later. These pure OAuth
 * helpers (token-refresh decision + authorize-URL building) are the shared flow
 * the guide requires connectors to cover, and unit-test under `src/**.spec.ts`.
 */

export type ConnectorStatus = 'connected' | 'disconnected' | 'error';

export interface OAuthCredentials {
  accessToken: string;
  refreshToken?: string;
  /** Epoch ms when the access token expires; omitted when unknown. */
  expiresAt?: number;
}

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  authorizeUrl: string;
  tokenUrl: string;
  redirectUri: string;
  scopes: string[];
}

/**
 * Whether the access token should be refreshed: no creds/token, or the token
 * expires within `skewMs`. Missing `expiresAt` is treated as still valid.
 */
export function needsRefresh(
  creds: OAuthCredentials | null | undefined,
  nowMs: number,
  skewMs = 60_000,
): boolean {
  if (!creds || !creds.accessToken) return true;
  if (creds.expiresAt == null) return false;
  return creds.expiresAt - skewMs <= nowMs;
}

/** Build a standard OAuth 2.0 authorize URL (code flow) for the connect step. */
export function buildAuthorizeUrl(config: OAuthConfig, state: string): string {
  const url = new URL(config.authorizeUrl);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', config.scopes.join(' '));
  url.searchParams.set('state', state);
  return url.toString();
}
