// Single-file consumer-facing module. Earlier this file re-exported from
// roles.ts + tenant.ts, but Rollup (used by Vite) can't always trace named
// exports through CommonJS-compiled `export { x } from './y'` statements.
// Inlining keeps both Vite and the NestJS CJS runtime happy without dual
// builds or compatibility plugins.

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

export const TENANT_ROLES = [
  'capiro_admin',
  'user_admin',
  'standard_user',
  'client_portal_user',
] as const;

export type TenantRole = (typeof TENANT_ROLES)[number];

export const ROLE_RANK: Record<TenantRole, number> = {
  client_portal_user: 0,
  standard_user: 1,
  user_admin: 2,
  capiro_admin: 3,
};

export function hasAtLeast(role: TenantRole, minimum: TenantRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

export function isCapiroAdmin(role: TenantRole): boolean {
  return role === 'capiro_admin';
}

/** Tenant-admin power: own tenant for `user_admin`, any tenant for `capiro_admin`. */
export function isTenantAdmin(role: TenantRole): boolean {
  return role === 'user_admin' || role === 'capiro_admin';
}

// ---------------------------------------------------------------------------
// Tenant context
// ---------------------------------------------------------------------------

export interface TenantContext {
  tenantId: string;
  tenantSlug: string;
  userId: string;
  clerkUserId: string;
  role: TenantRole;
}

export const TENANT_HEADER = 'x-capiro-tenant';
