import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module.js';
import { StrategiesController } from './strategies.controller.js';
import { StrategiesService } from './strategies.service.js';

@Module({
  imports: [PrismaModule, ConfigModule],
  controllers: [StrategiesController],
  providers: [StrategiesService],
  exports: [StrategiesService],
})
export class StrategiesModule {}
