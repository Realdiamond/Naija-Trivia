/**
 * Push notifications on the phone (TRD §4.8): Android through Firebase Cloud Messaging, with a
 * channel per kind so players can switch each off in Settings. iOS joins with its build (2.8).
 * The token is sent to the API on every start, since FCM can change it.
 */
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { routes } from '@whosabi/shared-types';
import { api } from '../api';
import { APP_VERSION } from '../config';
import { pushTarget, type PushTarget } from '../features/push/target';

export const pushSupported = Platform.OS === 'android';

/** Only Safari on iPhone needs the game on the Home Screen first (see push.ts). */
export const needsHomeScreen = false;

export type PushPermission = 'granted' | 'denied' | 'undetermined' | 'unsupported';

/** The server's channels (push/messages.ts), as Android shows them in Settings. */
const CHANNELS = [
  {
    id: 'duels',
    name: 'Duels',
    description: 'Your turn, time running out, and results',
    importance: Notifications.AndroidImportance.HIGH,
  },
  {
    id: 'friends',
    name: 'Friends',
    description: 'Friend requests',
    importance: Notifications.AndroidImportance.DEFAULT,
  },
  {
    id: 'daily',
    name: 'Daily challenge',
    description: 'A morning reminder when you have not played',
    importance: Notifications.AndroidImportance.DEFAULT,
  },
];

let channels: Promise<unknown> | null = null;
/** Channels first: Android 13 asks for permission once one exists. */
function ensureChannels(): Promise<unknown> {
  channels ??= Promise.all(
    CHANNELS.map(({ id, ...channel }) =>
      Notifications.setNotificationChannelAsync(id, { ...channel, lightColor: '#008751' }),
    ),
  );
  return channels;
}

let registered: string | null = null;

async function register(token?: string): Promise<void> {
  try {
    const value = token ?? (await Notifications.getDevicePushTokenAsync()).data;
    if (typeof value !== 'string') return;
    await api.post(routes.meDevices(), { platform: 'android', push_token: value, app_version: APP_VERSION });
    registered = value;
  } catch (e) {
    // No Firebase in this build yet, or offline: pushes wait for the next start.
    console.warn('push registration failed', e);
  }
}

export async function pushPermission(): Promise<PushPermission> {
  if (!pushSupported) return 'unsupported';
  return (await Notifications.getPermissionsAsync()).status as PushPermission;
}

/** Asks for permission (the system prompt on Android 13+), then registers this phone. */
export async function enablePush(): Promise<PushPermission> {
  if (!pushSupported) return 'unsupported';
  await ensureChannels();
  const { status } = await Notifications.requestPermissionsAsync();
  if (status === 'granted') await register();
  return status as PushPermission;
}

/** On every start with a session, if pushes are allowed. */
export async function syncPush(): Promise<void> {
  if ((await pushPermission()) !== 'granted') return;
  await ensureChannels();
  await register();
}

/**
 * Staff alerts on this phone (step 2.9b): their own channel, made only on staff phones so players
 * never see it in Settings. Asks for permission if need be; the token, or null without it.
 */
export async function staffPushToken(): Promise<string | null> {
  if (!pushSupported) return null;
  await ensureChannels();
  await Notifications.setNotificationChannelAsync('staff', {
    name: 'Staff alerts',
    description: 'Problems, sign-ups and payments, for the team',
    importance: Notifications.AndroidImportance.HIGH,
    lightColor: '#008751',
  });
  const status =
    (await pushPermission()) === 'granted'
      ? 'granted'
      : (await Notifications.requestPermissionsAsync()).status;
  if (status !== 'granted') return null;
  try {
    const token = (await Notifications.getDevicePushTokenAsync()).data;
    return typeof token === 'string' ? token : null;
  } catch {
    return null;
  }
}

/** Before signing out: this phone stops getting the player's pushes. */
export async function forgetPush(): Promise<void> {
  if (!registered) return;
  const token = registered;
  registered = null;
  await api.request('DELETE', routes.meDevices(), { body: { push_token: token } }).catch(() => undefined);
}

interface Handlers {
  /** A push was tapped, now or to start the app. */
  open(target: PushTarget): void;
  /** A push arrived while the app was open. */
  received(target: PushTarget): void;
}

const targetOf = (n: Notifications.Notification) => {
  const trigger = n.request.trigger as { remoteMessage?: { data?: Record<string, string> } } | null;
  return pushTarget(trigger?.remoteMessage?.data, n.request.content.data as Record<string, unknown>);
};

/** Shows pushes while the app is open, and reports taps and arrivals. For the root layout. */
export function usePushHandlers(handlers: Handlers): void {
  const latest = useRef(handlers);
  latest.current = handlers;
  useEffect(() => {
    if (!pushSupported) return;
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
    const seen = new Set<string>();
    const open = (response: Notifications.NotificationResponse) => {
      const id = response.notification.request.identifier;
      if (seen.has(id)) return;
      seen.add(id);
      latest.current.open(targetOf(response.notification));
      void Notifications.clearLastNotificationResponseAsync();
    };
    const subs = [
      Notifications.addNotificationResponseReceivedListener(open),
      Notifications.addNotificationReceivedListener((n) => latest.current.received(targetOf(n))),
      Notifications.addPushTokenListener((token) => {
        if (registered && typeof token.data === 'string') void register(token.data);
      }),
    ];
    // The tap that started the app.
    void Notifications.getLastNotificationResponseAsync().then((r) => r && open(r));
    return () => subs.forEach((s) => s.remove());
  }, []);
}
