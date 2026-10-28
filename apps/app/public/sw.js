/**
 * The web app's service worker (build plan step 2.5c): shows pushes and opens what they are
 * about. The API encrypts each push for this browser (apps/api/src/push/webpush.ts) and the
 * browser decrypts it, so the data is the message itself: {title, body, url, type, tag}.
 */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

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
