/**
 * The light party client's build: one small bundle under /party-client/, which the API serves
 * beside the room links (/r/{CODE}). VITE_API_URL points it at another host in development and
 * the end-to-end tests; in production it talks to its own origin.
 */
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/party-client/',
  esbuild: { jsx: 'automatic', jsxImportSource: 'preact' },
  build: {
    outDir: 'dist',
    // The WhatsApp browser on older Android phones.
    target: 'es2019',
    assetsInlineLimit: 0,
  },
});
