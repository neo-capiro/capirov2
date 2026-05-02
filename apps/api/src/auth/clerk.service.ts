import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClerkClient, type ClerkClient, verifyToken } from '@clerk/backend';
import type { AppConfig } from '../config/config.schema.js';

export interface ClerkSessionClaims {
  sub: string; // Clerk user id
  iss: string;
  email?: string;
  // Clerk Organizations claims (populated when the user has an active org):
  org_id?: string;
  org_slug?: string;
  org_role?: string;
  // Capiro custom claims, populated by the `capiro` JWT template configured
  // in the Clerk dashboard:
  //   capiro_tenant_id   = {{org.public_metadata.capiro_tenant_id}}
  //   capiro_tenant_slug = {{org.slug}}
  // Empty strings when the user has no active org. The middleware falls back
  // to header/subdomain resolution in that case.
  capiro_tenant_id?: string;
  capiro_tenant_slug?: string;
  capiro_org_role?: string;
}

/**
 * Thin wrapper around @clerk/backend. Centralizes JWT verification and
 * Backend API access so the rest of the codebase never imports Clerk
 * directly.
 */
@Injectable()
export class ClerkService {
  private readonly logger = new Logger(ClerkService.name);
  private readonly client: ClerkClient;
  private readonly secretKey: string;
  private readonly issuer: string | undefined;

  constructor(config: ConfigService<AppConfig, true>) {
    this.secretKey = config.get('CLERK_SECRET_KEY', { infer: true });
    this.issuer = config.get('CLERK_JWT_ISSUER', { infer: true });
    this.client = createClerkClient({ secretKey: this.secretKey });
  }

  get backend(): ClerkClient {
    return this.client;
  }

  /**
   * Verify a Clerk session JWT. Returns the claims if valid, throws otherwise.
   * Uses Clerk's JWKS (cached by the SDK).
   */
  async verifySessionToken(token: string): Promise<ClerkSessionClaims> {
    const claims = await verifyToken(token, {
      secretKey: this.secretKey,
      ...(this.issuer ? { issuer: this.issuer } : {}),
    });
    return claims as unknown as ClerkSessionClaims;
  }
}
