/**
 * Serves the web export (web-build/) for the end-to-end tests: files as they are, and
 * index.html for every other path, like the production host will (the app routes in the browser).
 * Party links (/r/{CODE}) open the light party client (apps/web-guest/dist) when it is built,
 * unless they ask for the full app (?app=1), as the API does in production.
 *   node e2e/serve.mjs [port]
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../web-build/', import.meta.url));
const guest = fileURLToPath(new URL('../../web-guest/dist/', import.meta.url));
const port = Number(process.argv[2] ?? process.env.PORT ?? 8082);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
};

const exists = (file) =>
  stat(file).then(
    (s) => s.isFile(),
    () => false,
  );

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const pathname = decodeURIComponent(url.pathname);
  if (pathname.startsWith('/party-client/')) {
    const file = path.join(guest, pathname.slice('/party-client/'.length));
    if (file.startsWith(guest) && (await exists(file))) {
      res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' });
      return createReadStream(file).pipe(res);
    }
    res.writeHead(404);
    return res.end();
  }
  const partyLink = /^\/r\/[A-Za-z0-9]{5}\/?$/.test(pathname) && !url.searchParams.has('app');
  if (partyLink && (await exists(path.join(guest, 'index.html')))) {
    res.writeHead(200, { 'content-type': types['.html'] });
    return createReadStream(path.join(guest, 'index.html')).pipe(res);
  }
  let file = path.join(root, pathname);
  if (!file.startsWith(root)) file = path.join(root, 'index.html');
  try {
    if (!(await stat(file)).isFile()) throw new Error('not a file');
  } catch {
    file = path.join(root, 'index.html');
  }
  res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
}).listen(port, () => console.log(`web-build on http://localhost:${port}`));
