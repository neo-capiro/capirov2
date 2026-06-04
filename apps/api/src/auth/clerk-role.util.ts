import type { TenantRole } from '@capiro/shared';

/**
 * Reserved Clerk org slug for Capiro internal staff. Membership in this org can
 * grant the `capiro_admin` role (cross-tenant powers), but only when the Clerk
 * org role is admin; ordinary members remain `standard_user`.
 */
export const CAPIRO_INTERNAL_SLUG = 'capiro-internal';

/**
 * Map a Clerk organization role to a Capiro tenant role.
 *
 * Shared by the two paths that mirror Clerk org membership into Capiro:
 *   1. The Clerk webhook ingestion (`organizationMembership.*`).
 *   2. The tenant-context middleware self-heal (provisioning from a verified
 *      JWT when the local mirror is missing the row).
 * Keeping the mapping in one place guarantees both derive the SAME role from
 * the same (orgSlug, clerkRole) inputs.
 *
 * Clerk's default org roles are `org:admin` and `org:member`. Some instances
 * customize them, so we treat anything containing "admin" as elevated and
 * everything else as `standard_user`.
 */
export function mapClerkRoleToCapiro(orgSlug: string, clerkRole: string): TenantRole {
  const normalizedRole = clerkRole.toLowerCase();
  if (orgSlug === CAPIRO_INTERNAL_SLUG) {
    return normalizedRole.includes('admin') ? 'capiro_admin' : 'standard_user';
  }
  return normalizedRole.includes('admin') ? 'user_admin' : 'standard_user';
}
