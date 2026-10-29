/**
 * Push notifications in the browser (build plan step 2.5c): the standard Web Push API, with the
 * service worker in public/sw.js showing them. Safari on iPhone and iPad only offers it once the
 * game is added to the Home Screen (TRD FR-NOT-4): there the prompts stay hidden, and the
 * notifications screen says how. Staff alerts stay on the Android app.
 */
import { useEffect, useRef } from 'react';
import { routes, type WebPushKeyResponse } from '@whosabi/shared-types';
import { api } from '../api';
import { APP_VERSION } from '../config';
import { pushTarget, type PushTarget } from '../features/push/target';
import { isIos, isStandalone } from './browser';

const inBrowser = typeof window !== 'undefined' && typeof navigator !== 'undefined';

export const pushSupported =
  inBrowser && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/** Safari on iPhone or iPad, not opened from the Home Screen: no pushes until it is. */
export const needsHomeScreen = inBrowser && !pushSupported && isIos() && !isStandalone();

export type PushPermission = 'granted' | 'denied' | 'undetermined' | 'unsupported';

let webKey: Promise<string | null> | null = null;

/** The key the API signs pushes with; null while web push is off there. */
function serverKey(): Promise<string | null> {
  webKey ??= api
    .get<WebPushKeyResponse>(routes.pushWebKey(), { auth: 'none' })
    .then((r) => r.public_key)
    .catch(() => {
      webKey = null;
      return null;
    });
  return webKey;
}

export async function pushPermission(): Promise<PushPermission> {
  if (!pushSupported || !(await serverKey())) return 'unsupported';
  return Notification.permission === 'default' ? 'undetermined' : Notification.permission;
}

const bytes = (base64url: string) =>
  Uint8Array.from(atob(base64url.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

/** This browser's subscription for the API's current key (a new key needs a new subscription). */
async function subscription(key: string): Promise<PushSubscription> {
  await navigator.serviceWorker.register('/sw.js');
  const { pushManager } = await navigator.serviceWorker.ready;
  const wanted = bytes(key);
  const existing = await pushManager.getSubscription();
  if (existing) {
    const current = existing.options.applicationServerKey;
    const same = current && new Uint8Array(current).every((b, i) => b === wanted[i]);
    if (same && current.byteLength === wanted.length) return existing;
    await existing.unsubscribe();
  }
  return pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: wanted });
}

function browserName(): string {
  const ua = navigator.userAgent;
  const os = /Android/.test(ua) ? 'android' : isIos() ? 'ios' : 'desktop';
  const name = /Edg\//.test(ua)
    ? 'edge'
    : /Firefox\//.test(ua)
      ? 'firefox'
      : /SamsungBrowser\//.test(ua)
        ? 'samsung'
        : /OPR\//.test(ua)
          ? 'opera'
          : /Chrome\//.test(ua)
            ? 'chrome'
            : /Safari\//.test(ua)
              ? 'safari'
              : 'other';
  return `${name}_${os}`;
}

let registered: string | null = null;

async function register(): Promise<void> {
  try {
    const key = await serverKey();
    if (!key) return;
    const { endpoint, keys } = (await subscription(key)).toJSON();
    if (!endpoint || !keys?.p256dh || !keys.auth) return;
    await api.post(routes.meDevices(), {
      platform: 'web',
      subscription: { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } },
      app_version: APP_VERSION,
      browser: browserName(),
    });
    registered = endpoint;
  } catch (e) {
    // Offline, or the push service is unreachable: pushes wait for the next start.
    console.warn('web push registration failed', e);
  }
}

/** Asks the browser for permission, then registers this browser with the API. */
export async function enablePush(): Promise<PushPermission> {
  if ((await pushPermission()) === 'unsupported') return 'unsupported';
  const result = await Notification.requestPermission();
  if (result === 'granted') await register();
  return result === 'default' ? 'undetermined' : result;
}

/** On every start with a session, if pushes are allowed (the subscription can change). */
export async function syncPush(): Promise<void> {
  if ((await pushPermission()) === 'granted') await register();
}

/** Before signing out: this browser stops getting the player's pushes. */
export async function forgetPush(): Promise<void> {
  if (!registered) return;
  const endpoint = registered;
  registered = null;
  await api.request('DELETE', routes.meDevices(), { body: { push_token: endpoint } }).catch(() => undefined);
}

export async function staffPushToken(): Promise<string | null> {
  return null;
}

interface Handlers {
  /** A push was tapped. */
  open(target: PushTarget): void;
  /** A push arrived while the game was open. */
  received(target: PushTarget): void;
}

/** Hears from the service worker; and a push that opened a new window says so in the hash. */
export function usePushHandlers(handlers: Handlers): void {
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });
  useEffect(() => {
    if (!pushSupported) return;
    const onMessage = (event: MessageEvent) => {
      const message = event.data as { whosabi?: string; type?: string; url?: string } | null;
      if (message?.whosabi === 'open') latest.current.open(pushTarget(message));
      if (message?.whosabi === 'push') latest.current.received(pushTarget(message));
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    const opened = /^#push=([a-z_]{1,40})$/.exec(window.location.hash);
    if (opened) {
      const url = window.location.pathname;
      window.history.replaceState(null, '', url + window.location.search);
      latest.current.open(pushTarget({ type: opened[1], url }));
    }
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, []);
}
