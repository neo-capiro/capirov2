import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module.js';
import { TenantModule } from '../../tenant/tenant.module.js';
import { GetMyClioEmailTool } from '../tools/get-my-clio-email.tool.js';
import { SendEmailTool } from '../tools/send-email.tool.js';
import { ClioMailController } from './clio-mail.controller.js';
import { ClioMailService } from './clio-mail.service.js';
import { ClioMailboxController } from './mailbox.controller.js';

@Module({
  imports: [PrismaModule, TenantModule],
  controllers: [ClioMailController, ClioMailboxController],
  providers: [ClioMailService, SendEmailTool, GetMyClioEmailTool],
  exports: [ClioMailService, SendEmailTool, GetMyClioEmailTool],
})
export class ClioMailModule {}
