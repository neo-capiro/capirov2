import { Injectable, Logger } from '@nestjs/common';
import type { TenantRole } from '@capiro/shared';
import { PrismaService } from '../prisma/prisma.service.js';

interface ClerkUserPayload {
  id: string;
  email_addresses?: Array<{ id: string; email_address: string }>;
  primary_email_address_id?: string;
  first_name?: string | null;
  last_name?: string | null;
}

interface ClerkPublicUserData {
  user_id: string;
  identifier?: string;
  first_name?: string | null;
  last_name?: string | null;
}

interface ClerkOrgMembershipPayload {
  id: string;
  organization: { id: string; slug: string };
  public_user_data?: ClerkPublicUserData;
  role: string; // e.g. "org:admin" or "org:member" depending on Clerk config
}

interface ClerkEvent {
  type: string;
  data: unknown;
}

/**
 * Reserved Clerk org slug for Capiro internal staff. Membership in this org
 * grants the `capiro_admin` role (cross-tenant powers); membership in any
 * other org grants either `user_admin` (Clerk role admin) or `standard_user`.
 */
const CAPIRO_INTERNAL_SLUG = 'capiro-internal';

function mapClerkRoleToCapiro(orgSlug: string, clerkRole: string): TenantRole {
  if (orgSlug === CAPIRO_INTERNAL_SLUG) return 'capiro_admin';
  // Clerk's default org roles are `org:admin` and `org:member`. Some
  // instances customize them; we treat anything containing "admin" as
  // user_admin and everything else as standard_user.
  return clerkRole.toLowerCase().includes('admin') ? 'user_admin' : 'standard_user';
}

/**
 * Processes Clerk webhook events.
 *
 *   user.created / user.updated  → upsert `users` row
 *   user.deleted                 → soft-disable by rewriting clerkUserId
 *   organizationMembership.*     → sync `tenant_memberships`
 *
 * Idempotency: every event is persisted to `clerk_events` keyed by Svix message
 * id. Re-deliveries skip processing.
 */
@Injectable()
export class ClerkWebhookService {
  private readonly logger = new Logger(ClerkWebhookService.name);

  constructor(private readonly prisma: PrismaService) {}

  async handle(svixId: string, event: ClerkEvent): Promise<void> {
    await this.prisma.withSystem(async (tx) => {
      // Idempotency guard. ON CONFLICT DO NOTHING returns 0 rows — we detect
      // the dup by checking processed_at on the existing row.
      const existing = await tx.clerkEvent.findUnique({ where: { eventId: svixId } });
      if (existing?.processedAt) {
        this.logger.debug(`Skipping already-processed Clerk event ${svixId}`);
        return;
      }
      if (!existing) {
        await tx.clerkEvent.create({
          data: {
            eventId: svixId,
            eventType: event.type,
            payload: event as unknown as object,
          },
        });
      }

      try {
        await this.dispatch(tx, event);
        await tx.clerkEvent.update({
          where: { eventId: svixId },
          data: { processedAt: new Date(), error: null },
        });
      } catch (err) {
        const message = (err as Error).message;
        this.logger.error(`Failed to process Clerk event ${svixId} (${event.type}): ${message}`);
        await tx.clerkEvent.update({
          where: { eventId: svixId },
          data: { error: message },
        });
        throw err;
      }
    });
  }

  private async dispatch(
    tx: Parameters<Parameters<PrismaService['withSystem']>[0]>[0],
    event: ClerkEvent,
  ): Promise<void> {
    switch (event.type) {
      case 'user.created':
      case 'user.updated': {
        const u = event.data as ClerkUserPayload;
        const email = primaryEmail(u);
        if (!email) {
          this.logger.warn(`Clerk ${event.type} for ${u.id} missing primary email — skipping`);
          return;
        }
        await tx.user.upsert({
          where: { clerkUserId: u.id },
          create: {
            clerkUserId: u.id,
            email,
            firstName: u.first_name ?? null,
            lastName: u.last_name ?? null,
          },
          update: {
            email,
            firstName: u.first_name ?? null,
            lastName: u.last_name ?? null,
          },
        });
        return;
      }
      case 'user.deleted': {
        const u = event.data as { id: string; deleted?: boolean };
        // Soft handling: we don't hard-delete users because tenant_memberships
        // and audit_logs reference them. Mark as deleted via email rewrite +
        // null clerk_user_id so they cannot sign in. (Schema lacks a deleted_at
        // here; revisit when offboarding workflow lands.)
        await tx.user
          .update({
            where: { clerkUserId: u.id },
            data: { clerkUserId: `deleted:${u.id}:${Date.now()}` },
          })
          .catch(() => undefined);
        return;
      }
      case 'organizationMembership.created':
      case 'organizationMembership.updated': {
        const m = event.data as ClerkOrgMembershipPayload;
        const tenant = await tx.tenant.findUnique({
          where: { clerkOrgId: m.organization.id },
        });
        if (!tenant) {
          this.logger.warn(
            `Membership event for unknown Clerk org ${m.organization.id} (${m.organization.slug}); ignoring`,
          );
          return;
        }
        // The membership identifies a Clerk user by id (`public_user_data.user_id`).
        // The user row must exist — Clerk emits user.created BEFORE
        // organizationMembership.created when the user is new, but the events
        // can arrive out of order. Upsert defensively.
        const clerkUserId = m.public_user_data?.user_id;
        if (!clerkUserId) {
          this.logger.warn(`Membership ${m.id} missing public_user_data.user_id; ignoring`);
          return;
        }
        const email = m.public_user_data?.identifier ?? `${clerkUserId}@unknown.invalid`;
        const user = await tx.user.upsert({
          where: { clerkUserId },
          create: {
            clerkUserId,
            email,
            firstName: m.public_user_data?.first_name ?? null,
            lastName: m.public_user_data?.last_name ?? null,
          },
          update: {
            email,
            firstName: m.public_user_data?.first_name ?? null,
            lastName: m.public_user_data?.last_name ?? null,
          },
        });

        const role = mapClerkRoleToCapiro(m.organization.slug, m.role);
        await tx.tenantMembership.upsert({
          where: { tenantId_userId: { tenantId: tenant.id, userId: user.id } },
          create: {
            tenantId: tenant.id,
            userId: user.id,
            role,
            status: 'active',
            joinedAt: new Date(),
          },
          update: { role, status: 'active', joinedAt: new Date() },
        });
        return;
      }
      case 'organizationMembership.deleted': {
        const m = event.data as ClerkOrgMembershipPayload;
        const tenant = await tx.tenant.findUnique({
          where: { clerkOrgId: m.organization.id },
        });
        const clerkUserId = m.public_user_data?.user_id;
        if (!tenant || !clerkUserId) return;
        const user = await tx.user.findUnique({ where: { clerkUserId } });
        if (!user) return;
        // Mark as removed rather than deleting — keeps audit_logs FKs intact
        // and lets Capiro Admins see the offboarding history.
        await tx.tenantMembership
          .update({
            where: { tenantId_userId: { tenantId: tenant.id, userId: user.id } },
            data: { status: 'removed' },
          })
          .catch(() => undefined);
        return;
      }
      case 'organization.created':
      case 'organization.updated':
      case 'organization.deleted': {
        // Tenants are owned by our DB; Clerk org changes are mostly informational
        // until we add cross-stack drift detection. Log and skip.
        this.logger.debug(`Clerk ${event.type} acknowledged (no-op)`);
        return;
      }
      default:
        this.logger.debug(`Ignoring Clerk event type ${event.type}`);
        return;
    }
  }
}

function primaryEmail(u: ClerkUserPayload): string | undefined {
  const list = u.email_addresses ?? [];
  if (list.length === 0) return undefined;
  if (u.primary_email_address_id) {
    const match = list.find((e) => e.id === u.primary_email_address_id);
    if (match) return match.email_address;
  }
  return list[0]?.email_address;
}
