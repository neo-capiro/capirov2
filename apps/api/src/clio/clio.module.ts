import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { TenantModule } from '../tenant/tenant.module.js';
import { ClioArtifactsModule } from './artifacts/artifacts.module.js';
import { ClioRuntimeClient } from './clio-runtime.client.js';
import { ClioController } from './clio.controller.js';
import { ClioService } from './clio.service.js';
import { ClioInternalAuthGuard } from './internal/clio-internal.guard.js';
import { ClioInternalController } from './internal/clio-internal.controller.js';
import { ClioMailModule } from './mail/clio-mail.module.js';
import { ClioMemoryModule } from './memory/memory.module.js';
import { ClioSkillsModule } from './skills/skills.module.js';
import { ApifyTool } from './tools/apify.tool.js';
import { BrowserbaseTool } from './tools/browserbase.tool.js';
import { CodeInterpreterTool } from './tools/code-interpreter.tool.js';
import { FetchUrlTool } from './tools/fetch-url.tool.js';
import { FirecrawlTool } from './tools/firecrawl.tool.js';
import { GetClientContextTool } from './tools/get-client-context.tool.js';
import { ReadwiseTool } from './tools/readwise.tool.js';
import { RedditTool } from './tools/reddit.tool.js';
import { ToolRegistryService } from './tools/tool-registry.service.js';
import { WebSearchTool } from './tools/web-search.tool.js';

@Module({
  imports: [
    PrismaModule,
    TenantModule,
    ClioArtifactsModule,
    ClioMemoryModule,
    ClioMailModule,
    ClioSkillsModule,
  ],
  controllers: [ClioController, ClioInternalController],
  providers: [
    ClioService,
    ClioRuntimeClient,
    ClioInternalAuthGuard,
    GetClientContextTool,
    WebSearchTool,
    FetchUrlTool,
    CodeInterpreterTool,
    FirecrawlTool,
    ReadwiseTool,
    ApifyTool,
    RedditTool,
    BrowserbaseTool,
    ToolRegistryService,
  ],
  exports: [ClioService, ToolRegistryService],
})
export class ClioModule {}
