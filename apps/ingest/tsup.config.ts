import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts'],
  format: ['esm'],
  target: 'node22',
  clean: true,
  // The workspace packages ship TypeScript source, so they are bundled in; npm packages stay external.
  noExternal: [/^@whosabi\//],
});
