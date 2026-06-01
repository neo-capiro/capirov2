import { Controller, Get, UseGuards } from '@nestjs/common';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { HelpService } from './help.service.js';

/**
 * Help center. Content is product-wide (not tenant-scoped); any signed-in user
 * may read it. Assets are returned as short-lived presigned URLs.
 */
@Controller('help')
@UseGuards(RolesGuard)
@Roles('standard_user')
export class HelpController {
  constructor(private readonly service: HelpService) {}

  @Get('content')
  content() {
    return this.service.listContent();
  }
}
