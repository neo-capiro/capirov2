import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module.js';
import { ForgetAboutUserTool } from '../tools/forget-about-user.tool.js';
import { RememberAboutUserTool } from '../tools/remember-about-user.tool.js';
import { UserMemoryService } from './user-memory.service.js';

@Module({
  imports: [PrismaModule],
  providers: [UserMemoryService, RememberAboutUserTool, ForgetAboutUserTool],
  exports: [UserMemoryService, RememberAboutUserTool, ForgetAboutUserTool],
})
export class ClioMemoryModule {}
