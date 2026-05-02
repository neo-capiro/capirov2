import { Module } from '@nestjs/common';
import { DirectoryController } from './directory.controller.js';
import { DirectoryService } from './directory.service.js';

@Module({
  controllers: [DirectoryController],
  providers: [DirectoryService],
})
export class DirectoryModule {}
