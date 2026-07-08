import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node', // per-file override with @vitest-environment jsdom
    include: ['src/**/*.test.ts'],
  },
});
