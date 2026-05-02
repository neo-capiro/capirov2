import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ROLE_RANK, type TenantContext, type TenantRole } from '@capiro/shared';
import { ROLES_KEY } from './roles.decorator.js';

/**
 * Enforces a minimum role for the route. The required roles come from the
 * @Roles() decorator on the handler or controller. Access is granted if the
 * caller's role rank >= the lowest-ranked required role.
 *
 * The TenantContext is set by TenantContextMiddleware. If it's missing the
 * route was reached without auth — fail closed.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<TenantRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) {
      return true;
    }

    const req = context.switchToHttp().getRequest<Request & { tenantContext?: TenantContext }>();
    const ctx = req.tenantContext;
    if (!ctx) {
      throw new ForbiddenException('No tenant context — auth middleware did not run');
    }

    const callerRank = ROLE_RANK[ctx.role];
    const minRequiredRank = Math.min(...required.map((r) => ROLE_RANK[r]));
    if (callerRank < minRequiredRank) {
      throw new ForbiddenException(
        `Role ${ctx.role} is below the required minimum (${required.join(' | ')})`,
      );
    }
    return true;
  }
}
