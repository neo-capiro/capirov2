import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { TenantContext } from '@capiro/shared';

/**
 * Injects the current TenantContext into a controller method.
 * The middleware sets `req.tenantContext`; this decorator reads it.
 * Throws if the route did not pass through TenantContextMiddleware.
 */
export const CurrentTenant = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): TenantContext => {
    const req = ctx.switchToHttp().getRequest<Request & { tenantContext?: TenantContext }>();
    if (!req.tenantContext) {
      throw new Error(
        'TenantContext missing — route is not covered by TenantContextMiddleware',
      );
    }
    return req.tenantContext;
  },
);
