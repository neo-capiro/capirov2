import { Controller, Get, Header } from '@nestjs/common';
import { InsightsService } from './insights.service.js';

/**
 * Public endpoint backing the capiro.ai Insights page. No auth (marketing site
 * is unauthenticated). CORS for https://capiro.ai is handled globally in
 * main.ts. Cache-Control mirrors the 1-hour server-side cache so CDNs/browsers
 * also avoid hammering the origin.
 */
@Controller('insights')
export class InsightsController {
  constructor(private readonly insights: InsightsService) {}

  @Get()
  @Header('Cache-Control', 'public, max-age=3600')
  async list() {
    return this.insights.getInsights();
  }
}
