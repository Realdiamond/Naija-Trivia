import { defineConfig } from 'vitest/config';

// Unit tests for the console's pure helpers; the pages are covered end to end (e2e/).
export default defineConfig({ test: { include: ['src/**/*.test.ts'], environment: 'node' } });
