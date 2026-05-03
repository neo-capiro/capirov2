import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
  },
  // The dev server uses esbuild's depOptimizer rather than Rollup's commonjs
  // plugin, so the build-time `commonjsOptions` block below doesn't help.
  // Explicitly pre-bundle @capiro/shared so esbuild rewrites the CJS
  // `exports.X = ...` form into named ESM exports the browser can import.
  optimizeDeps: {
    include: ['@capiro/shared'],
  },
  build: {
    // @capiro/shared compiles to CommonJS so that the NestJS CJS runtime can
    // `require()` it. Rollup's default commonjs handling skips workspace
    // packages — explicitly opting it in lets named exports come through.
    commonjsOptions: {
      // Rollup's commonjs plugin sees resolved file paths, not import
      // specifiers, so we match the workspace dist path here.
      include: [/packages\/shared\/dist/, /node_modules/],
      transformMixedEsModules: true,
    },
  },
});
