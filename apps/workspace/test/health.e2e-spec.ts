import { describe, expect, test, beforeAll, afterAll } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { HealthModule } from '../src/health/health.module.js';

describe('Workspace /health (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    // The bare HealthModule is sufficient — main.ts excludes /health from the
    // global `workspace-api` prefix so the route is mounted at the root. We
    // don't reach for AppModule here because that would also boot the Clerk
    // client; the contract under test is just that the controller is reachable.
    const moduleRef = await Test.createTestingModule({
      imports: [HealthModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  test('GET /health → 200 { ok: true, service: "workspace" }', async () => {
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, service: 'workspace' });
  });
});
