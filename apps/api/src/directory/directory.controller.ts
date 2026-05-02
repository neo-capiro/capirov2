import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { DirectoryService } from './directory.service.js';

@Controller('directory')
@UseGuards(RolesGuard)
@Roles('standard_user')
export class DirectoryController {
  constructor(private readonly service: DirectoryService) {}

  @Get('contacts')
  contacts(
    @Query('q') q?: string,
    @Query('chamber') chamber?: string,
    @Query('region') region?: string,
    @Query('state') state?: string,
    @Query('sort') sort?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.service.getContacts({
      q,
      chamber,
      region,
      state,
      sort,
      page,
      pageSize,
    });
  }
}
