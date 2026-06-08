import { describe, expect, jest, test } from '@jest/globals';
import * as os from 'node:os';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Step 2.4 follow-on — guard tests for the `sync-report-provisions` CLI.
 *
 * Verify the module is SAFE TO IMPORT (main() does not auto-run, no process.exit, no DB
 * connection on import), that it exposes `run` + `readArtifacts`, and that artifact
 * discovery is well-behaved (missing dir → [], only committee_provisions_*.json read).
 * End-to-end load logic is covered by provision-loader.spec.ts; this is glue + I/O only.
 * The DB-touching `run()` is intentionally NOT exercised here (no DB in unit tests).
 */
describe('sync-report-provisions CLI', () => {
  const realArgv = process.argv;
  let exitSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    // Simulate being imported by the test runner (argv[1] is jest, NOT the script), so the
    // direct-invocation guard stays false.
    process.argv = [realArgv[0] ?? 'node', '/some/path/jest-worker.js'];
    exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  });

  afterEach(() => {
    process.argv = realArgv;
    exitSpy.mockRestore();
    jest.resetModules();
    jest.restoreAllMocks();
  });

  test('importing the module does not auto-run main() or exit the process', async () => {
    const mod = await import('./sync-report-provisions.js');
    expect(typeof mod.run).toBe('function');
    expect(typeof mod.readArtifacts).toBe('function');
    expect(exitSpy).not.toHaveBeenCalled();
  });

  test('readArtifacts returns [] for a missing dir', async () => {
    const mod = await import('./sync-report-provisions.js');
    const missing = path.join(os.tmpdir(), `capiro-no-such-${Date.now()}`);
    expect(mod.readArtifacts(missing)).toEqual([]);
  });

  test('readArtifacts reads only committee_provisions_*.json and parses the shape', async () => {
    const mod = await import('./sync-report-provisions.js');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capiro-provisions-'));
    try {
      fs.writeFileSync(
        path.join(dir, 'committee_provisions_hasc_fy2027.json'),
        JSON.stringify({
          committee: 'HASC',
          fy: 2027,
          provisions: [{ heading: 'h', text: 't', pageStart: 1, pageEnd: 2 }],
        }),
      );
      // Decoy files that must be ignored.
      fs.writeFileSync(path.join(dir, 'something_else.json'), '{}');
      fs.writeFileSync(path.join(dir, 'committee_provisions_readme.txt'), 'nope');

      const artifacts = mod.readArtifacts(dir);
      expect(artifacts).toHaveLength(1);
      expect(artifacts[0]).toMatchObject({ committee: 'HASC', fy: 2027 });
      expect(artifacts[0]!.provisions).toHaveLength(1);
      expect(artifacts[0]!.sourceDocumentId).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
