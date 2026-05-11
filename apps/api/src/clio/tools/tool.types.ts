import type { TenantContext } from '@capiro/shared';
import type { Prisma } from '@prisma/client';

/**
 * A Capiro-managed tool the Clio agent can call.
 *
 * The agent loop runs in the Clio Python service. When Bedrock returns a
 * `tool_use` stop reason, Clio POSTs to /api/clio/internal/tools/:name with
 * the tool's input args; that route looks up the tool by name in the
 * registry and calls .execute() here. Tools never see the raw Bedrock
 * response — they only see the structured input the model produced.
 *
 * `definition` is the JSON Schema Bedrock Converse expects in toolConfig.
 * `internal` flags whether the tool is gated to internal-tier users
 * (@capiro.ai). Customer-tier sessions filter the registry down to the
 * non-internal subset before passing tools to Clio.
 */
export interface ToolDefinition {
  name: string;
  description: string;
  // Bedrock JSON-Schema shape for the input. Keep it small and explicit;
  // the model uses the description verbatim to decide when to call.
  inputSchema: Record<string, unknown>;
}

export interface ToolExecutionContext {
  tenantId: string;
  // Resolved from the session's user — useful when a tool wants to
  // scope to "this user's clients" rather than the whole tenant.
  userId: string;
  // The Prisma transaction client already inside withTenant(). Tools
  // never open their own transaction; the controller wraps the call
  // so RLS is set + audit logging is one atomic unit.
  tx: Prisma.TransactionClient;
}

export interface Tool {
  readonly definition: ToolDefinition;
  readonly internal: boolean;
  execute(input: Record<string, unknown>, ctx: ToolExecutionContext): Promise<unknown>;
}

/**
 * Helper for tools that take TenantContext-style auth but need to be
 * callable from the internal route (no Clerk JWT). The internal
 * controller composes a synthetic TenantContext from the session row.
 */
export function tenantContextFromExecution(ctx: ToolExecutionContext, role: string): TenantContext {
  return {
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    // The internal route has no Clerk claims to back these; tools that
    // need real slug or clerkUserId should fetch them themselves.
    tenantSlug: '',
    clerkUserId: '',
    role: role as TenantContext['role'],
  };
}
