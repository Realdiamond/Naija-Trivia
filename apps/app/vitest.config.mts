import { defineConfig } from 'vitest/config';

// Unit tests for the parts with no React Native in them (the API client, helpers).
export default defineConfig({
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
});
