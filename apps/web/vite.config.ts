import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
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
