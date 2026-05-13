import type { TenantRole } from '@capiro/shared';
import type { ToolExecutionContext } from './tool.types.js';

/**
 * Derives the agent tier ('internal' | 'customer') from a tool
 * execution context. Mirrors clio.service.ts:tierFor(): capiro_admin
 * is internal, everyone else is customer.
 *
 * Lives here (not in the service) because tools execute on the
 * internal callback route which doesn't have the ClioService in
 * scope. ToolExecutionContext doesn't carry the role today; we
 * reconstruct it via the helper in tool.types.ts which receives
 * a TenantContext-shaped role.
 *
 * Note: this is informational — security gates use the role directly
 * via the registry's `tier` resolver. Skill access checks call this
 * to filter visibility.
 */
export function tierContextFromExecution(
  _ctx: ToolExecutionContext,
): 'internal' | 'customer' {
  // ToolExecutionContext doesn't currently carry the user role.
  // For now the tool-invocation path passes through customer-tier;
  // the system-prompt-side index injection (which DOES have the
  // role) is the source of truth for what the model sees. Tools
  // that need tier-aware behavior at call time should add the role
  // to the context explicitly.
  // TODO: thread the role through ClioInternalController →
  // tool.execute so this returns the real tier per call.
  return 'customer';
}

/** Internal helper used by tier-aware tools to read a passed-in role. */
export function tierFromRole(role: TenantRole | undefined): 'internal' | 'customer' {
  return role === 'capiro_admin' ? 'internal' : 'customer';
}
