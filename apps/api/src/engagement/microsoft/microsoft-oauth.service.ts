import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ConfidentialClientApplication,
  type AuthenticationResult,
  type Configuration,
} from '@azure/msal-node';
import {
  EngagementConnectionStatus,
  EngagementProvider,
  Prisma,
} from '@prisma/client';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { TenantContext } from '@capiro/shared';
import type { AppConfig } from '../../config/config.schema.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { TokenCryptoService } from './token-crypto.service.js';

const MICROSOFT_SCOPES = ['offline_access', 'User.Read', 'Mail.Read', 'Calendars.Read'];
const STATE_TTL_SECONDS = 600;

export interface MicrosoftAuthStartInput {
  connectionId?: string;
  accountEmail?: string;
  displayName?: string;
}

export interface MicrosoftAuthStartResult {
  authUrl: string;
  connectionId: string;
}

interface StatePayload {
  c: string; // connection id
  t: string; // tenant id
  n: string; // nonce
  e: number; // expires at (unix seconds)
}

@Injectable()
export class MicrosoftOAuthService {
  private readonly logger = new Logger(MicrosoftOAuthService.name);
  private readonly clientId?: string;
  private readonly tenantId?: string;
  private readonly thumbprint?: string;
  private readonly privateKey?: string;
  private readonly redirectUri: string;
  private readonly successRedirect: string;
  private readonly stateSecret?: Buffer;
  private msal?: ConfidentialClientApplication;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenCrypto: TokenCryptoService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.clientId = config.get('MICROSOFT_CLIENT_ID', { infer: true });
    this.tenantId = config.get('MICROSOFT_TENANT_ID', { infer: true });
    this.thumbprint = config.get('MICROSOFT_CERT_THUMBPRINT', { infer: true });
    const rawKey = config.get('MICROSOFT_CERT_PRIVATE_KEY', { infer: true });
    this.privateKey = rawKey ? normalizePem(rawKey) : undefined;
    this.redirectUri = config.get('MICROSOFT_REDIRECT_URI', { infer: true });
    this.successRedirect = config.get('MICROSOFT_OAUTH_SUCCESS_REDIRECT', { infer: true });
    const stateSecret = config.get('OAUTH_STATE_SECRET', { infer: true });
    this.stateSecret = stateSecret ? Buffer.from(stateSecret, 'utf8') : undefined;
  }

  capabilities() {
    const ready = Boolean(
      this.clientId &&
        this.tenantId &&
        this.thumbprint &&
        this.privateKey &&
        this.stateSecret &&
        this.tokenCrypto.isConfigured(),
    );
    return {
      configured: ready,
      redirectUri: this.redirectUri,
      scopes: MICROSOFT_SCOPES,
    };
  }

  getSuccessRedirect(): string {
    return this.successRedirect;
  }

  async start(
    ctx: TenantContext,
    input: MicrosoftAuthStartInput,
  ): Promise<MicrosoftAuthStartResult> {
    this.assertConfigured();

    const connection = await this.prisma.withTenant(ctx.tenantId, async (tx) => {
      if (input.connectionId) {
        const existing = await tx.integrationConnection.findUnique({
          where: { id: input.connectionId },
        });
        if (!existing) throw new NotFoundException('Integration connection not found');
        if (existing.provider !== EngagementProvider.microsoft_365) {
          throw new BadRequestException('Connection is not a Microsoft 365 integration');
        }
        return existing;
      }

      return tx.integrationConnection.create({
        data: {
          tenantId: ctx.tenantId,
          provider: EngagementProvider.microsoft_365,
          accountEmail: input.accountEmail?.trim().toLowerCase() || null,
          displayName: input.displayName?.trim() || null,
          status: EngagementConnectionStatus.needs_configuration,
          scopes: MICROSOFT_SCOPES,
          syncState: {
            calendar: { cursor: null, updatedAt: null },
            mail: { cursor: null, updatedAt: null },
            webhooks: { configured: false },
          },
          createdByUserId: ctx.userId,
        },
      });
    });

    const state = this.signState({
      c: connection.id,
      t: ctx.tenantId,
      n: randomBytes(16).toString('base64url'),
      e: Math.floor(Date.now() / 1000) + STATE_TTL_SECONDS,
    });

    const authUrl = await this.getMsal().getAuthCodeUrl({
      scopes: MICROSOFT_SCOPES,
      redirectUri: this.redirectUri,
      state,
      prompt: 'select_account',
    });

    return { authUrl, connectionId: connection.id };
  }

  async handleCallback(params: { code: string; state: string }): Promise<{
    tenantId: string;
    connectionId: string;
  }> {
    this.assertConfigured();

    const decoded = this.verifyState(params.state);
    const result = await this.getMsal().acquireTokenByCode({
      code: params.code,
      scopes: MICROSOFT_SCOPES,
      redirectUri: this.redirectUri,
    });

    if (!result?.accessToken) {
      throw new BadRequestException('Microsoft did not return an access token');
    }

    const refreshToken = this.extractRefreshToken();
    const expiresAt = result.expiresOn ?? new Date(Date.now() + 60 * 60 * 1000);

    await this.persistToken(decoded.t, decoded.c, result, refreshToken, expiresAt);

    return { tenantId: decoded.t, connectionId: decoded.c };
  }

  private async persistToken(
    tenantId: string,
    connectionId: string,
    result: AuthenticationResult,
    refreshToken: string | undefined,
    expiresAt: Date,
  ): Promise<void> {
    const accessEnvelope = this.tokenCrypto.encrypt(result.accessToken);
    const refreshEnvelope = refreshToken ? this.tokenCrypto.encrypt(refreshToken) : null;
    const homeAccountId = result.account?.homeAccountId ?? null;
    const accountEmail = result.account?.username?.toLowerCase() ?? null;
    const displayName = result.account?.name ?? null;

    await this.prisma.withTenant(tenantId, async (tx) => {
      await tx.integrationConnectionToken.upsert({
        where: { connectionId },
        update: {
          accessTokenCiphertext: accessEnvelope.ciphertext,
          accessTokenIv: accessEnvelope.iv,
          accessTokenAuthTag: accessEnvelope.authTag,
          ...(refreshEnvelope
            ? {
                refreshTokenCiphertext: refreshEnvelope.ciphertext,
                refreshTokenIv: refreshEnvelope.iv,
                refreshTokenAuthTag: refreshEnvelope.authTag,
              }
            : {}),
          keyVersion: this.tokenCrypto.getKeyVersion(),
          scopes: MICROSOFT_SCOPES,
          homeAccountId,
          expiresAt,
        },
        create: {
          tenantId,
          connectionId,
          accessTokenCiphertext: accessEnvelope.ciphertext,
          accessTokenIv: accessEnvelope.iv,
          accessTokenAuthTag: accessEnvelope.authTag,
          refreshTokenCiphertext: refreshEnvelope?.ciphertext ?? null,
          refreshTokenIv: refreshEnvelope?.iv ?? null,
          refreshTokenAuthTag: refreshEnvelope?.authTag ?? null,
          keyVersion: this.tokenCrypto.getKeyVersion(),
          scopes: MICROSOFT_SCOPES,
          homeAccountId,
          expiresAt,
        },
      });

      await tx.integrationConnection.update({
        where: { id: connectionId },
        data: {
          status: EngagementConnectionStatus.connected,
          accountEmail: accountEmail ?? undefined,
          displayName: displayName ?? undefined,
          scopes: MICROSOFT_SCOPES,
          lastError: null,
          syncState: {
            calendar: { cursor: null, updatedAt: null },
            mail: { cursor: null, updatedAt: null },
            webhooks: { configured: false },
          } as Prisma.InputJsonValue,
        },
      });
    });
  }

  private extractRefreshToken(): string | undefined {
    if (!this.msal) return undefined;
    try {
      const json = this.msal.getTokenCache().serialize();
      const cache = JSON.parse(json) as {
        RefreshToken?: Record<string, { secret?: string }>;
      };
      const entries = Object.values(cache.RefreshToken ?? {});
      const last = entries[entries.length - 1];
      return last?.secret;
    } catch (err) {
      this.logger.warn(`Failed to extract refresh token from MSAL cache: ${(err as Error).message}`);
      return undefined;
    } finally {
      // Discard the cache so the next OAuth flow starts clean.
      this.msal = undefined;
    }
  }

  private getMsal(): ConfidentialClientApplication {
    if (this.msal) return this.msal;
    const config: Configuration = {
      auth: {
        clientId: this.clientId!,
        authority: `https://login.microsoftonline.com/${this.tenantId}`,
        clientCertificate: {
          thumbprint: this.thumbprint!,
          privateKey: this.privateKey!,
        },
      },
    };
    this.msal = new ConfidentialClientApplication(config);
    return this.msal;
  }

  private assertConfigured(): void {
    if (
      !this.clientId ||
      !this.tenantId ||
      !this.thumbprint ||
      !this.privateKey ||
      !this.stateSecret ||
      !this.tokenCrypto.isConfigured()
    ) {
      throw new ServiceUnavailableException(
        'Microsoft OAuth is not fully configured. Required: MICROSOFT_CLIENT_ID, MICROSOFT_TENANT_ID, MICROSOFT_CERT_THUMBPRINT, MICROSOFT_CERT_PRIVATE_KEY, OAUTH_STATE_SECRET, OAUTH_TOKEN_ENCRYPTION_KEY.',
      );
    }
  }

  private signState(payload: StatePayload): string {
    const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const sig = createHmac('sha256', this.stateSecret!).update(body).digest('base64url');
    return `${body}.${sig}`;
  }

  private verifyState(state: string): StatePayload {
    if (!this.stateSecret) throw new ServiceUnavailableException('OAUTH_STATE_SECRET is not set');
    const [body, sig] = state.split('.');
    if (!body || !sig) throw new BadRequestException('Malformed state');
    const expected = createHmac('sha256', this.stateSecret).update(body).digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new BadRequestException('Invalid state signature');
    }
    let payload: StatePayload;
    try {
      payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as StatePayload;
    } catch {
      throw new BadRequestException('Malformed state payload');
    }
    if (payload.e < Math.floor(Date.now() / 1000)) {
      throw new BadRequestException('State has expired; restart the flow');
    }
    return payload;
  }
}

function normalizePem(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('-----BEGIN')) return trimmed;
  // Assume base64-encoded PEM transported via env var.
  return Buffer.from(trimmed, 'base64').toString('utf8');
}
