module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  testMatch: [
    '<rootDir>/src/**/*.spec.ts',
    '<rootDir>/scripts/**/*.spec.ts',
    // Step 4.2 — slower end-to-end acceptance specs live under test/e2e/.
    '<rootDir>/test/**/*.e2e.spec.ts',
  ],
  setupFiles: ['<rootDir>/jest.setup.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json', diagnostics: { ignoreCodes: [151002] } }],
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    // Jest cannot resolve package-`imports` subpaths; map @clerk/backend's
    // #crypto to its node CJS runtime (needed by the AppModule DI smoke test).
    '^#crypto$': '@clerk/backend/dist/runtime/node/crypto.js',
    // Jest also cannot resolve the MCP SDK's `exports`-mapped subpaths; point
    // them at the CJS build directly (needed by clio-mcp-transport + the
    // AppModule DI smoke test).
    '^@modelcontextprotocol/sdk/(.*)\\.js$': '@modelcontextprotocol/sdk/dist/cjs/$1.js',
    // Same problem one layer down: the MCP SDK requires zod/v3 + zod/v4
    // subpaths whose `require` condition jest ignores, landing on the ESM
    // build. Pin them to the CJS files.
    '^zod/v3$': 'zod/v3/index.cjs',
    '^zod/v4$': 'zod/v4/index.cjs',
    '^zod/v4/core$': 'zod/v4/core/index.cjs',
    '^zod/v4-mini$': 'zod/v4-mini/index.cjs',
    '^zod/v4/mini$': 'zod/v4/mini/index.cjs',
    '^pkce-challenge$': 'pkce-challenge/dist/index.node.cjs',
  },
};
