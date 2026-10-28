/**
 * The web app served from the API's own origin (the Heroku launch setup): its files, and its
 * index.html for any other page path, since the app routes in the browser. Sharing the origin
 * keeps the refresh cookie first-party (FR-AUTH-7) on hosts like herokuapp.com, where two apps
 * are different sites.
 *
 * Each page carries its own link preview (Open Graph tags), so a challenge link pasted into
 * WhatsApp shows who sent it before anyone taps it (doc 09 §5).
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import type { NotFoundFallback } from './errors';
import { PREVIEW, type PageMeta } from './share/service';

const API_PATHS = ['/v1/', '/admin/', '/og/', '/.well-known/', '/health'];
const HASHED = ['_expo', 'assets'];

export async function serveWebApp(app: FastifyInstance, dir: string): Promise<void> {
  await app.register(fastifyStatic, {
    root: path.resolve(dir),
    prefix: '/',
    // Pages, "/" included, come from webAppPage with their link preview.
    index: false,
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
  // Without an index page the static files would refuse "/" as a folder.
  app.get('/', (_request, reply) => reply.callNotFound());
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** index.html with the page's preview tags added to its head. */
export function withPageMeta(html: string, meta: PageMeta): string {
  const tags = [
    ['name', 'description', meta.description],
    ['property', 'og:type', 'website'],
    ['property', 'og:site_name', 'Who Sabi?'],
    ['property', 'og:title', meta.title],
    ['property', 'og:description', meta.description],
    ['property', 'og:url', meta.url],
    ['property', 'og:image', meta.image],
    ['property', 'og:image:width', String(PREVIEW.width)],
    ['property', 'og:image:height', String(PREVIEW.height)],
    ['name', 'twitter:card', 'summary_large_image'],
  ]
    .map(([attr, key, value]) => `<meta ${attr}="${key}" content="${escapeHtml(value!)}">`)
    .join('\n    ');
  return html.replace('</head>', () => `    ${tags}\n  </head>`);
}

/**
 * For the not-found handler: page paths get the app with their preview; API paths keep their
 * problem+json 404. A preview that can't be worked out never stops the page loading.
 */
export function webAppPage(
  dir: string,
  metaFor: (pathname: string) => Promise<PageMeta>,
  log: FastifyBaseLogger,
): NotFoundFallback {
  let template: Promise<string> | null = null;
  return (request, reply) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') return false;
    const url = request.url.split('?')[0] ?? '/';
    if (API_PATHS.some((p) => url === p.replace(/\/$/, '') || url.startsWith(p))) return false;
    template ??= readFile(path.join(path.resolve(dir), 'index.html'), 'utf8');
    void (async () => {
      let html: string;
      try {
        html = await template;
      } catch (err) {
        template = null;
        throw err;
      }
      const meta = await metaFor(url).catch((err: unknown) => {
        log.warn({ err, url }, 'page preview failed');
        return null;
      });
      return reply
        .type('text/html; charset=utf-8')
        .header('cache-control', 'no-cache')
        .send(meta ? withPageMeta(html, meta) : html);
    })().catch((err: unknown) => reply.send(err));
    return true;
  };
}
