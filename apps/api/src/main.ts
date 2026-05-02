import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger, RequestMethod, ValidationPipe } from '@nestjs/common';
import { json, raw } from 'express';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const logger = new Logger('Bootstrap');

  // Mount everything under `/api/*` to match the ALB listener rule. The ALB
  // forwards `/api/*` to this service without stripping the prefix, so every
  // controller route lives under `/api/...`. Two carve-outs:
  //   - `/health`   — the ALB target group hits this (and also routes /health
  //                   to the API), and we don't want it nested under /api.
  //   - `/webhooks/*` — Clerk's webhook URL is `/webhooks/clerk` (no /api),
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

  // Strict input validation at the edge — drop unknown fields, fail closed
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

  app.enableCors({
    origin: process.env.WEB_ORIGIN?.split(',') ?? ['http://localhost:5173'],
    credentials: true,
  });

  const port = Number.parseInt(process.env.API_PORT ?? '4000', 10);
  const host = process.env.API_BIND_HOST ?? '0.0.0.0';
  await app.listen(port, host);
  logger.log(`Capiro API listening on http://${host}:${port}`);
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal bootstrap error', err);
  process.exit(1);
});
