import type { ReactNode } from 'react';
import { ROLE_RANK, type TenantRole } from '@capiro/shared';
import { useMe } from '../lib/me.js';

interface Props {
  /** Lowest role allowed to see the children. */
  minimum: TenantRole;
  fallback?: ReactNode;
  children: ReactNode;
}

/**
 * Hides children when the current user's role rank is below the minimum.
 * Renders `fallback` (default: nothing) when blocked.
 *
 * The server enforces the same check on every endpoint via RolesGuard;
 * this is purely UI affordance, not a security boundary.
 */
export function RoleGate({ minimum, fallback = null, children }: Props) {
  const me = useMe();
  if (!me.data) return null;
  if (ROLE_RANK[me.data.role] < ROLE_RANK[minimum]) return <>{fallback}</>;
  return <>{children}</>;
}
