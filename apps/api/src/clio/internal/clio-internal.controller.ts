import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { IsObject, IsOptional, IsString } from 'class-validator';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ToolRegistryService, type ClioTier } from '../tools/tool-registry.service.js';
import { ClioInternalAuthGuard } from './clio-internal.guard.js';

class ExecuteToolDto {
  @IsString()
  sessionId!: string;

  @IsOptional()
  @IsObject()
  input?: Record<string, unknown>;
}

/**
 * Routes the Clio runtime calls back into during its agent loop.
 *
 * Auth: bearer token only (ClioInternalAuthGuard). NOT behind the Clerk
 * middleware — this is service-to-service, not user-to-API. The shared
 * secret is the boundary.
 *
 * Tenant scope: derived from the session row, not from a header. The
 * session_id in the request body uniquely identifies a tenant + user;
 * the controller looks them up and runs the tool inside withTenant().
 */
@Controller('clio/internal')
@UseGuards(ClioInternalAuthGuard)
export class ClioInternalController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ToolRegistryService,
  ) {}

  @Post('tools/:name')
  @HttpCode(200)
  async executeTool(
    @Param('name') name: string,
    @Body() body: ExecuteToolDto,
  ): Promise<{ output: unknown }> {
    // Look up the session *outside* the tenant transaction so we can
    // discover the right tenant_id to scope to. Sessions table is
    // tenant-scoped via RLS so we use a system-mode read.
    const session = await this.prisma.withSystem(async (tx) =>
      tx.clioSession.findUnique({
        where: { id: body.sessionId },
        select: {
          id: true,
          tenantId: true,
          userId: true,
          status: true,
          settings: true,
        },
      }),
    );
    if (!session || session.status === 'deleted') {
      throw new NotFoundException('Session not found');
    }
    if (body.sessionId !== session.id) {
      throw new BadRequestException('Session mismatch');
    }

    const tier = readTier(session.settings);
    const tool = this.registry.resolve(name, tier);

    return this.prisma.withTenant(session.tenantId, async (tx) => {
      const output = await tool.execute(body.input ?? {}, {
        tenantId: session.tenantId,
        userId: session.userId,
        tx,
      });
      return { output };
    });
  }
}

function readTier(settings: unknown): ClioTier {
  if (settings && typeof settings === 'object' && 'tier' in settings) {
    const t = (settings as { tier?: unknown }).tier;
    if (t === 'internal') return 'internal';
  }
  return 'customer';
}
