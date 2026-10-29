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

const API_PATHS = ['/v1/', '/admin/', '/og/', '/.well-known/', '/health', '/party-client/'];
const HASHED = ['_expo', 'assets'];
/** A party link opened fresh: the light party client, unless it asks for the full app (?app=1). */
const PARTY_LINK = /^\/r\/[A-Za-z0-9]{5}\/?$/;

export async function serveWebApp(app: FastifyInstance, dir: string): Promise<void> {
  await app.register(fastifyStatic, {
    root: path.resolve(dir),
    prefix: '/',
    // Pages, "/" included, come from webAppPage with their link preview.
    index: false,
    wildcard: true,
    // The .br and .gz copies scripts/precompress.mjs wrote at build time (step 2.8b).
    preCompressed: true,
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

/**
 * The light party client's files (apps/web-guest/dist) under /party-client/ (step 2.2c). Its
 * page itself comes from webAppPage, for party links.
 */
export async function serveWebGuest(app: FastifyInstance, dir: string): Promise<void> {
  await app.register(fastifyStatic, {
    root: path.resolve(dir),
    prefix: '/party-client/',
    index: false,
    wildcard: true,
    preCompressed: true,
    decorateReply: false,
    setHeaders: (res, filePath) => {
      const hashed = path.relative(path.resolve(dir), filePath).split(path.sep)[0] === 'assets';
      void res.header('cache-control', hashed ? 'public, max-age=31536000, immutable' : 'no-cache');
    },
  });
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
  dir: string | undefined,
  metaFor: (pathname: string) => Promise<PageMeta>,
  log: FastifyBaseLogger,
  guestDir?: string,
): NotFoundFallback {
  const templates = new Map<string, Promise<string>>();
  const load = (folder: string) => {
    let template = templates.get(folder);
    if (!template) {
      template = readFile(path.join(path.resolve(folder), 'index.html'), 'utf8');
      // A failed read is tried again next time.
      template.catch(() => templates.delete(folder));
      templates.set(folder, template);
    }
    return template;
  };
  return (request, reply) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') return false;
    const [url = '/', query = ''] = request.url.split('?');
    if (API_PATHS.some((p) => url === p.replace(/\/$/, '') || url.startsWith(p))) return false;
    const party = guestDir && PARTY_LINK.test(url) && !new URLSearchParams(query).has('app');
    const folder = party ? guestDir : dir;
    if (!folder) return false;
    void (async () => {
      const html = await load(folder);
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
