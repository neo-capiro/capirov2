import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProgramElementWriterService } from '../program-element/program-element-writer.service.js';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly peWriter: ProgramElementWriterService,
  ) {}

  @Get()
  async check() {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: 'ok', time: new Date().toISOString() };
  }

  @Get('pe')
  async peHealth() {
    return this.peWriter.getHealthSummary();
  }
}
