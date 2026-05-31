import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module.js';
import { GovInfoService } from './govinfo.service.js';

/**
 * Shared GovInfo (api.data.gov) client module. Exports GovInfoService for the
 * congressional sync scripts/services (bills, committee reports, public laws).
 */
@Module({
  imports: [PrismaModule],
  providers: [GovInfoService],
  exports: [GovInfoService],
})
export class GovInfoModule {}
