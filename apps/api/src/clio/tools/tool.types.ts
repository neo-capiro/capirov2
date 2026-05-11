import type { TenantContext } from '@capiro/shared';
import type { Prisma } from '@prisma/client';

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolExecutionContext {
  tenantId: string;
  userId: string;
  tx: Prisma.TransactionClient;
}

export interface Tool {
  readonly definition: ToolDefinition;
  readonly internal: boolean;
  execute(input: Record<string, unknown>, ctx: ToolExecutionContext): Promise<unknown>;
}

export function tenantContextFromExecution(ctx: ToolExecutionContext, role: string): TenantContext {
  return {
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    tenantSlug: '',
    clerkUserId: '',
    role: role as TenantContext['role'],
  };
}

