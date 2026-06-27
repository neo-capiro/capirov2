import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module.js';
import { HealthModule } from './health/health.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { CascadeModule } from './cascade/cascade.module.js';
import { TemplatesModule } from './templates/templates.module.js';
import { DraftsModule } from './drafts/drafts.module.js';
import { DocumentsModule } from './documents/documents.module.js';
import { CommentsModule } from './comments/comments.module.js';
import { ContextModule } from './context/context.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true }),
    PrismaModule,
    AuthModule,
    HealthModule,
    CascadeModule,
    TemplatesModule,
    DraftsModule,
    DocumentsModule,
    CommentsModule,
    ContextModule,
  ],
})
export class AppModule {}
