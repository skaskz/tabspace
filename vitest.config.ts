import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': resolve(__dirname, 'src') } },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['tests/setup.ts'],
    // Coverage instrumentation slows code 2-3x; timing budgets in tests scale by this factor.
    env: { TS_PERF_SLACK: process.env.TS_PERF_SLACK ?? (process.argv.includes('--coverage') ? '3' : '1') },
    include: ['tests/unit/**/*.test.{ts,tsx}', 'tests/integration/**/*.test.{ts,tsx}', 'tests/security/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      include: ['src/features/**', 'src/storage/**', 'src/utils/**', 'src/integrations/**'],
      reporter: ['text', 'html', 'json-summary'],
    },
  },
});
