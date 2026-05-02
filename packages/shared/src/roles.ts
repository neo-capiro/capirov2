// Mirrors the role enum in the database (tenant_role). Keep in sync with
// apps/api/prisma/migrations/0001_init/migration.sql.

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

export function isTenantAdmin(role: TenantRole): boolean {
  // user_admin manages their tenant; capiro_admin can do anything a
  // user_admin can do (cross-tenant via the role rank).
  return role === 'user_admin' || role === 'capiro_admin';
}
