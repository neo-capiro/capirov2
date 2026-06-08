/**
 * Step 3.2 — guard tests for the `generate-actions` CLI.
 *
 * These verify the module is SAFE TO IMPORT (main() does not auto-run, no process.exit, no DB
 * connection on import) and that it exposes the `run` entrypoint. They also assert the CLI's
 * dry-run contract: the DEFAULT (no --commit) run threads `dryRun: true` into the generator so
 * NO DB write occurs, and --commit threads `dryRun: false`. The end-to-end generation logic is
 * covered by action-recommendation.service.spec.ts.
 */

describe('generate-actions CLI', () => {
  const realArgv = process.argv;
  let exitSpy: jest.SpyInstance;

  beforeEach(() => {
    // Simulate being imported by the test runner (argv[1] is jest, NOT generate-actions),
    // so the direct-invocation guard must stay false.
    process.argv = [realArgv[0] ?? 'node', '/some/path/jest-worker.js'];
    exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  });

  afterEach(() => {
    process.argv = realArgv;
    exitSpy.mockRestore();
    jest.resetModules();
    jest.restoreAllMocks();
    jest.dontMock('../src/prisma/prisma.service.js');
    jest.dontMock('../src/intelligence/client-pe-relevance.service.js');
    jest.dontMock('../src/intelligence/actions/action-recommendation.service.js');
  });

  test('importing the module does not auto-run main() or exit the process', async () => {
    const mod = await import('./generate-actions.js');
    expect(typeof mod.run).toBe('function');
    // The import guard keys off argv[1]; under jest it is not the script, so nothing ran.
    expect(exitSpy).not.toHaveBeenCalled();
  });

  test('exports a `run` entrypoint the script and tests can call', async () => {
    const mod = await import('./generate-actions.js');
    expect(mod).toHaveProperty('run');
  });

  describe('dry-run contract (G1)', () => {
    /**
     * Replace PrismaService / ClientPeRelevanceService / ActionRecommendationService with
     * stubs (via jest.doMock + resetModules) so run() never touches a real DB. The captured
     * generate() mock lets us assert EXACTLY which dryRun flag the CLI threads through, and
     * that NO DB write path was even reachable.
     */
    function mockDeps(): { generate: jest.Mock } {
      jest.resetModules();
      const generate = jest.fn(async () => ({ generated: 3 }));
      jest.doMock('../src/prisma/prisma.service.js', () => ({
        PrismaService: class {
          async onModuleInit() {}
          async onModuleDestroy() {}
        },
      }));
      jest.doMock('../src/intelligence/client-pe-relevance.service.js', () => ({
        ClientPeRelevanceService: class {},
      }));
      jest.doMock('../src/intelligence/actions/action-recommendation.service.js', () => ({
        ActionRecommendationService: class {
          generate = generate;
        },
      }));
      return { generate };
    }

    test('default (no --commit) calls generate with dryRun:true and writes nothing', async () => {
      const { generate } = mockDeps();
      const { run } = await import('./generate-actions.js');
      const summary = await run();

      expect(generate).toHaveBeenCalledTimes(1);
      expect(generate.mock.calls[0]![0]).toMatchObject({ dryRun: true });
      expect(summary).toMatchObject({ mode: 'DRY_RUN', generated: 3 });
    });

    test('--commit calls generate with dryRun:false (persisting)', async () => {
      process.argv = [realArgv[0] ?? 'node', '/some/path/jest-worker.js', '--commit'];
      const { generate } = mockDeps();
      const { run } = await import('./generate-actions.js');
      const summary = await run();

      expect(generate.mock.calls[0]![0]).toMatchObject({ dryRun: false });
      expect(summary).toMatchObject({ mode: 'COMMIT', generated: 3 });
    });
  });
});
