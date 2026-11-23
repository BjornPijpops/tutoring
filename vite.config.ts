import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

// GitHub Pages serves the site from /tutoring/; override with VITE_BASE_PATH.
const DEFAULT_BASE_PATH = '/tutoring/';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    base: env['VITE_BASE_PATH'] || DEFAULT_BASE_PATH,
    plugins: [react()],
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
      css: { include: /.+/, modules: { classNameStrategy: 'non-scoped' } },
    },
  };
});
