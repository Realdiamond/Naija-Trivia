import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/server.ts',
    'src/worker.ts',
    'src/scripts/migrate.ts',
    'src/scripts/seed.ts',
    'src/scripts/admin-add.ts',
  ],
  format: ['esm'],
  target: 'node22',
  clean: true,
  // The workspace packages ship TypeScript source, so they are bundled in; npm packages stay external.
  noExternal: [/^@whosabi\//],
});
