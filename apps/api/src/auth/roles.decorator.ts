import { SetMetadata } from '@nestjs/common';
import type { TenantRole } from '@capiro/shared';

/**
 * Marks a controller / handler with the minimum role required to access it.
 * Read by RolesGuard. Order in the array doesn't imply rank, it's a
 * whitelist; RolesGuard checks role-rank against the lowest-ranked entry.
 */
export const ROLES_KEY = 'capiro:roles';
export const Roles = (...roles: TenantRole[]) => SetMetadata(ROLES_KEY, roles);
