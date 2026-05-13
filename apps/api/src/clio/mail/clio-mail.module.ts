import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module.js';
import { SendEmailTool } from '../tools/send-email.tool.js';
import { ClioMailController } from './clio-mail.controller.js';
import { ClioMailService } from './clio-mail.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [ClioMailController],
  providers: [ClioMailService, SendEmailTool],
  exports: [ClioMailService, SendEmailTool],
})
export class ClioMailModule {}
