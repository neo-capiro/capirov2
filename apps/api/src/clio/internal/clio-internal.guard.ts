import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import type { AppConfig } from '../../config/config.schema.js';

/**
 * Validates the Bearer token on /api/clio/internal/* requests against
 * CLIO_INBOUND_SHARED_SECRET. The secret is injected from Secrets Manager
 * at task start; both the Clio runtime (sender) and the API (validator)
 * read the same Secrets Manager entry, so a rotation flows to both after
 * the next restart.
 *
 * Comparison is constant-time so a malicious caller can't probe length
 * or prefix of the real secret. Empty configured secret means the guard
 * fails closed — internal routes are unreachable until ops fills it in.
 */
@Injectable()
export class ClioInternalAuthGuard implements CanActivate {
  private readonly logger = new Logger(ClioInternalAuthGuard.name);
  private readonly expected: string;

  constructor(config: ConfigService<AppConfig, true>) {
    this.expected = config.get('CLIO_INBOUND_SHARED_SECRET', { infer: true }) ?? '';
  }

  canActivate(ctx: ExecutionContext): boolean {
    if (!this.expected) {
      // Fail closed when the secret isn't configured — never accept
      // unauthenticated traffic just because ops forgot to wire it.
      throw new UnauthorizedException();
    }
    const req = ctx.switchToHttp().getRequest<Request>();
    const auth = req.headers.authorization ?? '';
    const presented = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : '';

    if (presented.length === 0 || presented.length !== this.expected.length) {
      throw new UnauthorizedException();
    }
    const a = Buffer.from(presented);
    const b = Buffer.from(this.expected);
    if (!timingSafeEqual(a, b)) {
      throw new UnauthorizedException();
    }
    return true;
  }
}
