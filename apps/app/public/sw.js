/**
 * The web app's service worker.
 *
 * Pushes (build plan step 2.5c): shows them and opens what they are about. The API encrypts
 * each push for this browser (apps/api/src/push/webpush.ts) and the browser decrypts it, so the
 * data is the message itself: {title, body, url, type, tag}.
 *
 * The app's files on the phone (step 2.8c, TRD FR-WEB-3), so a repeat visit doesn't download
 * them again (UX §4) and the app still opens without a connection:
 * - bundles, fonts and pictures have content hashes in their names, so they come from the cache
 *   when they're there, and are kept when they're not (the newest 150);
 * - pages come from the network, and the last one is kept as the app shell, for when the network
 *   is gone or takes more than 4 seconds (the app routes in the browser, so any page will do);
 * - the API and everything else go straight to the network and are never kept.
 */

const FILES = 'whosabi-files-v1';
const SHELL = 'whosabi-shell-v1';
const MAX_FILES = 150;
const SHELL_KEY = '/__shell';
const SLOW_PAGE_MS = 4000;
const HASHED = /^\/(_expo\/static|assets|party-client\/assets)\//;
const NOT_PAGES = /^\/(v1|admin|og|\.well-known|health|party-client)(\/|$)/;
// A party link opened fresh gets the light party client (step 2.2c), not the app shell.
const PARTY_LINK = /^\/r\//;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      // The shell straight away, so even the next visit can open offline.
      try {
        const res = await fetch('/', { cache: 'no-cache' });
        if (res.ok) await (await caches.open(SHELL)).put(SHELL_KEY, res);
      } catch {
        // Offline while installing: the next page visit keeps it instead.
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) =>
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key !== FILES && key !== SHELL) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  ),
);

async function trim(cache) {
  const keys = await cache.keys();
  for (const key of keys.slice(0, Math.max(0, keys.length - MAX_FILES))) await cache.delete(key);
}

async function keep(cache, url) {
  if (await cache.match(url, { ignoreVary: true })) return;
  const res = await fetch(url);
  if (res.ok) await cache.put(url, res);
}

async function hashedFile(request) {
  const cache = await caches.open(FILES);
  const hit = await cache.match(request, { ignoreVary: true });
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) {
    await cache.put(request, res.clone());
    await trim(cache);
  }
  return res;
}

async function page(request, url) {
  const cache = await caches.open(SHELL);
  const network = fetch(request).then((res) => {
    if (res.ok && !PARTY_LINK.test(url.pathname)) void cache.put(SHELL_KEY, res.clone());
    return res;
  });
  const shell = await cache.match(SHELL_KEY);
  if (!shell) return network;
  const slow = new Promise((resolve) => setTimeout(() => resolve(null), SLOW_PAGE_MS));
  return (await Promise.race([network.catch(() => null), slow])) ?? shell;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (HASHED.test(url.pathname)) event.respondWith(hashedFile(request));
  else if (request.mode === 'navigate' && !NOT_PAGES.test(url.pathname)) {
    event.respondWith(page(request, url));
  }
});

// The files the page loaded before this worker took over (platform/serviceWorker.ts).
self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.whosabi !== 'cache' || !Array.isArray(data.urls)) return;
  event.waitUntil(
    (async () => {
      const cache = await caches.open(FILES);
      for (const href of data.urls.slice(0, MAX_FILES)) {
        const url = new URL(href, self.location.origin);
        if (url.origin !== self.location.origin || !HASHED.test(url.pathname)) continue;
        await keep(cache, url.pathname).catch(() => undefined);
      }
      await trim(cache);
    })(),
  );
});

const windows = () => self.clients.matchAll({ type: 'window', includeUncontrolled: true });

self.addEventListener('push', (event) => {
  let push = null;
  try {
    push = event.data ? event.data.json() : null;
  } catch {
    push = null;
  }
  // Every push must show something; one we can't read still says who it is from.
  push =
    push && typeof push.title === 'string'
      ? push
      : { title: 'Who Sabi?', body: '', url: '/', type: 'unknown' };
  event.waitUntil(
    (async () => {
      await self.registration.showNotification(push.title, {
        body: push.body,
        icon: '/icons/icon-192.png',
        badge: '/icons/badge-96.png',
        // A newer push about the same duel replaces the older one.
        ...(push.tag ? { tag: push.tag, renotify: true } : {}),
        data: { url: push.url, type: push.type },
      });
      // An open game refreshes whatever this is about.
      for (const client of await windows())
        client.postMessage({ whosabi: 'push', type: push.type, url: push.url });
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const { url = '/', type = 'unknown' } = event.notification.data || {};
  event.waitUntil(
    (async () => {
      const open = (await windows()).find((c) => new URL(c.url).origin === self.location.origin);
      if (open) {
        await open.focus();
        open.postMessage({ whosabi: 'open', type, url });
        return;
      }
      // A new window starts on the page itself; the hash tells the app a push opened it.
      await self.clients.openWindow(`${url}#push=${encodeURIComponent(type)}`);
    })(),
  );
});
