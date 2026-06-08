import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { TenantContext } from '@capiro/shared';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { CurrentTenant } from '../tenant/current-tenant.decorator.js';
import {
  ActionRecommendationReadService,
  type ActionSort,
} from './actions/action-recommendation-read.service.js';
import { ActionRecommendationService } from './actions/action-recommendation.service.js';
import type {
  ActionStatus,
} from './actions/action-recommendation.types.js';

// The global ValidationPipe runs whitelist + forbidNonWhitelisted, so every DTO field
// MUST carry a class-validator decorator (mirrors ProgramsController / AcquisitionPersonnel).

const ACTION_STATUSES: ActionStatus[] = [
  'new',
  'triaged',
  'assigned',
  'drafting',
  'ready_for_review',
  'sent_to_client',
  'outreach_completed',
  'monitoring',
  'dismissed',
  'archived',
];

class ListActionsDto {
  @IsOptional()
  @IsIn(ACTION_STATUSES)
  status?: ActionStatus;

  // A non-UUID would reach a `WHERE client_id = $1` predicate and make Postgres throw a
  // 500 (invalid input syntax for type uuid); validate up front for a clean 400.
  @IsOptional()
  @IsString()
  @IsUUID()
  clientId?: string;

  @IsOptional()
  @IsIn(['deadline', 'priority'])
  sort?: ActionSort;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

class UpdateStatusDto {
  @IsIn(ACTION_STATUSES)
  status!: ActionStatus;

  @IsOptional()
  @IsString()
  dismissalReason?: string;
}

class UpdateOwnerDto {
  // null OR an absent key clears the owner; a non-null value must be a uuid.
  // @IsOptional lets the key be omitted; @ValidateIf still runs @IsUUID on a non-null value.
  @IsOptional()
  @ValidateIf((o: UpdateOwnerDto) => o.ownerUserId !== null)
  @IsUUID()
  ownerUserId!: string | null;
}

/**
 * Step 3.2 — ActionRecommendation CRUD API (plan §10 card, §19 workflow, §12.4 board).
 *
 * Mounted under `/intelligence` (same module, own controller — mirrors
 * ClientPeRelevanceController). Tenant-scoped via RolesGuard + @Roles(standard_user);
 * the read/write service enforces RLS through withTenant and writes AuditLog on every
 * mutation. The POST /generate route delegates to the (separately owned) generator
 * service, scoped to the caller's tenant.
 */
@Controller('intelligence')
@UseGuards(RolesGuard)
@Roles('standard_user')
export class ActionRecommendationController {
  constructor(
    private readonly readService: ActionRecommendationReadService,
    private readonly generator: ActionRecommendationService,
  ) {}

  /** List action cards for the tenant, filtered + sorted + paginated. */
  @Get('actions')
  list(@CurrentTenant() ctx: TenantContext, @Query() query: ListActionsDto) {
    return this.readService.list(ctx, {
      status: query.status,
      clientId: query.clientId,
      sort: query.sort,
      page: query.page,
      limit: query.limit,
    });
  }

  /** Regenerate cards for the caller's tenant. Declared before ':id' so 'generate' is
   * not captured as an id. */
  @Post('actions/generate')
  async generate(@CurrentTenant() ctx: TenantContext) {
    const { generated } = await this.generator.generate({ tenantId: ctx.tenantId });
    return { generated };
  }

  /** Fetch a single card by id. */
  @Get('actions/:id')
  getOne(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    return this.readService.getOne(ctx, id);
  }

  /** Change a card's workflow status (§19). Rejects illegal transitions / unreasoned
   * dismissals with 400 via validateTransition. */
  @Patch('actions/:id/status')
  updateStatus(
    @CurrentTenant() ctx: TenantContext,
    @Param('id') id: string,
    @Body() body: UpdateStatusDto,
  ) {
    return this.readService.updateStatus(ctx, id, body.status, body.dismissalReason);
  }

  /** Assign or clear a card's owner. */
  @Patch('actions/:id/owner')
  updateOwner(
    @CurrentTenant() ctx: TenantContext,
    @Param('id') id: string,
    @Body() body: UpdateOwnerDto,
  ) {
    return this.readService.updateOwner(ctx, id, body.ownerUserId);
  }
}
