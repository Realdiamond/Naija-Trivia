/**
 * The web app served from the API's own origin (the Heroku launch setup): its files, and its
 * index.html for any other page path, since the app routes in the browser. Sharing the origin
 * keeps the refresh cookie first-party (FR-AUTH-7) on hosts like herokuapp.com, where two apps
 * are different sites.
 */
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

const API_PATHS = ['/v1/', '/admin/', '/.well-known/', '/health'];
const HASHED = ['_expo', 'assets'];

export async function serveWebApp(app: FastifyInstance, dir: string): Promise<void> {
  await app.register(fastifyStatic, {
    root: path.resolve(dir),
    prefix: '/',
    index: ['index.html'],
    wildcard: true,
    // Bundles and assets have content hashes in their names; pages must always be fresh.
    setHeaders: (res, filePath) => {
      const parts = path.relative(path.resolve(dir), filePath).split(path.sep);
      void res.header(
        'cache-control',
        HASHED.includes(parts[0] ?? '') ? 'public, max-age=31536000, immutable' : 'no-cache',
      );
    },
  });
}

/** For the not-found handler: page paths get the app; API paths keep their problem+json 404. */
export function webAppPage(request: FastifyRequest, reply: FastifyReply): boolean {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false;
  const url = request.url.split('?')[0] ?? '/';
  if (API_PATHS.some((p) => url === p.replace(/\/$/, '') || url.startsWith(p))) return false;
  void reply.sendFile('index.html');
  return true;
}
