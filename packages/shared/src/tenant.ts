import type { TenantRole } from './roles';

export interface TenantContext {
  tenantId: string;
  tenantSlug: string;
  userId: string;
  clerkUserId: string;
  role: TenantRole;
}

export const TENANT_HEADER = 'x-capiro-tenant';
