import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { RegulatoryDocketService } from './regulatory-docket.service.js';

class DocketsQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  agencyId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  documentType?: string;

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

/**
 * Regulatory dockets API. Read-only, global data.
 */
@Controller('regulatory-dockets')
@UseGuards(RolesGuard)
@Roles('standard_user')
export class RegulatoryDocketController {
  constructor(private readonly service: RegulatoryDocketService) {}

  @Get()
  listDockets(@Query() q: DocketsQueryDto) {
    return this.service.listDockets({
      agencyId: q.agencyId,
      documentType: q.documentType,
      page: q.page,
      limit: q.limit,
    });
  }

  @Get('upcoming-deadlines')
  upcomingDeadlines() {
    return this.service.getUpcomingDeadlines(30);
  }

  @Get(':documentId')
  getDocket(@Param('documentId') documentId: string) {
    return this.service.getDocket(documentId);
  }
}
