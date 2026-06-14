import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger, RequestMethod, ValidationPipe } from '@nestjs/common';
import { json, raw } from 'express';
import { AppModule } from './app.module.js';
import { PrismaClientExceptionFilter } from './common/prisma-exception.filter.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const logger = new Logger('Bootstrap');

  // Mount everything under `/api/*` to match the ALB listener rule. The ALB
  // forwards `/api/*` to this service without stripping the prefix, so every
  // controller route lives under `/api/...`. Two carve-outs:
  //   - `/health`  , the ALB target group hits this (and also routes /health
  //                   to the API), and we don't want it nested under /api.
  //   - `/webhooks/*`, Clerk's webhook URL is `/webhooks/clerk` (no /api),
  //                     so the route stays bare-mounted.
  app.setGlobalPrefix('api', {
    exclude: [
      { path: 'health', method: RequestMethod.ALL },
      { path: 'webhooks/(.*)', method: RequestMethod.ALL },
    ],
  });

  // Clerk webhook signature verification needs the raw body. Mount raw parser
  // ONLY on that path; everything else gets normal JSON.
  app.use('/webhooks/clerk', raw({ type: '*/*', limit: '1mb' }));
  app.use(json({ limit: '1mb' }));

  // Strict input validation at the edge, drop unknown fields, fail closed
  // on malformed bodies. class-validator + class-transformer must be installed
  // (apps/api/package.json) for this to work.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  // Map known Prisma errors (e.g. malformed UUID path params) to 4xx instead
  // of a generic 500. Registered after the pipes; only catches Prisma errors,
  // so HttpExceptions still flow through Nest's default handler.
  app.useGlobalFilters(new PrismaClientExceptionFilter());

  const allowedOrigins = new Set(
    [
      ...(process.env.WEB_ORIGIN?.split(',') ?? ['http://localhost:5173']),
      'https://capiro.ai',
      'https://www.capiro.ai',
    ]
      .map((origin) => origin.trim())
      .filter(Boolean),
  );

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error('Origin is not allowed by CORS'));
    },
    credentials: true,
  });

  const port = Number.parseInt(process.env.API_PORT ?? '4000', 10);
  const host = process.env.API_BIND_HOST ?? '0.0.0.0';
  await app.listen(port, host);

  // Behind the ALB these must outlast the ALB idle timeout (300s), or two
  // things break: (1) long AI content-generation requests (model calls up to
  // ~120s) get their socket cut by the server before the response is sent, and
  // (2) the ALB can reuse a connection the server just closed → sporadic 502s.
  // Node's defaults (keepAlive 5s, headers 60s) are far too low for an
  // AI-heavy app. headersTimeout must exceed keepAliveTimeout.
  const server = app.getHttpServer();
  server.keepAliveTimeout = 305_000;
  server.headersTimeout = 310_000;

  logger.log(`Capiro API listening on http://${host}:${port}`);
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal bootstrap error', err);
  process.exit(1);
});
