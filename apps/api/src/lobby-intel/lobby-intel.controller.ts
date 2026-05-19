import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { LobbyIntelService } from './lobby-intel.service.js';

class SearchDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;
}

/**
 * Read-only federal lobbying intelligence API.
 * Auth required (standard_user+), but data is global / cross-tenant.
 */
@Controller('lobby-intel')
@UseGuards(RolesGuard)
@Roles('standard_user')
export class LobbyIntelController {
  constructor(private readonly service: LobbyIntelService) {}

  @Get('overview')
  overview() {
    return this.service.overview();
  }

  @Get('issues')
  issues() {
    return this.service.listIssues();
  }

  @Get('search')
  async search(@Query() query: SearchDto) {
    return this.service.search(query.q ?? '');
  }

  @Get('lookup')
  async lookup(@Query('name') name: string) {
    if (!name) return null;
    return this.service.lookupByClientName(name);
  }

  @Get(':slug')
  async getOne(@Param('slug') slug: string) {
    return this.service.getBySlug(slug);
  }
}
