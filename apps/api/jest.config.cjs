module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  testMatch: ['**/src/**/*.spec.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json', diagnostics: { ignoreCodes: [151002] } }],
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
};
