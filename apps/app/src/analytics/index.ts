/**
 * The app's event tracker (doc 13, doc 18 §15): sessions, screens and time spent, sent in
 * batches to the event intake with the player's access token.
 *
 * Behaviour events wait for consent: the consent banner and the settings switch arrive in step
 * 1.4c, and until then only core events (sessions, time spent) are sent (FR-WEB-11).
 */
import { Platform as RNPlatform } from 'react-native';
import {
  Tracker,
  type ClientEventName,
  type EventBatch,
  type EventProps,
  type SendOutcome,
} from '@whosabi/analytics';
import { api, setAnalyticsSession } from '../api';
import { APP_VERSION, EVENTS_URL, PLATFORM } from '../config';
import { useLanguage } from '../i18n';
import { storage } from '../platform/storage';

let behaviourConsent = false;

export function setBehaviourConsent(granted: boolean): void {
  behaviourConsent = granted;
}

/**
 * 202 accepted (or already had it), 400 a batch the intake will never take, 401 an access token
 * to renew first. Anything else, or no network, is tried again later with the same batch_id.
 */
export async function sendBatch(batch: EventBatch): Promise<SendOutcome> {
  const access = api.current?.access;
  if (!access) return 'retry'; // not signed in yet; the queue waits
  const body = JSON.stringify(batch);
  const res = await fetch(`${EVENTS_URL}/v1/events`, {
    method: 'POST',
    headers: { authorization: `Bearer ${access}`, 'content-type': 'application/json' },
    body,
    // Lets the last batch leave as the tab closes; browsers refuse keepalive bodies over 64 KB.
    keepalive: PLATFORM === 'web' && body.length < 60_000,
  });
  if (res.status === 202) return 'accepted';
  if (res.status === 400 || res.status === 413) return 'drop';
  if (res.status === 401) await api.refresh().catch(() => null);
  return 'retry';
}

const tracker = new Tracker({
  transport: sendBatch,
  storage,
  getContext: () => ({
    platform: PLATFORM,
    app_version: APP_VERSION,
    os_version: String(RNPlatform.Version ?? '').slice(0, 32) || undefined,
    language: useLanguage.getState().language,
    data_saver: false,
  }),
  hasBehaviourConsent: () => behaviourConsent,
  validate: __DEV__,
  onError: (error) => {
    if (__DEV__) console.warn('analytics', error);
  },
});

setAnalyticsSession(() => tracker.sessionId);

let started = false;

/** Loads the saved queue and starts the session. Analytics never stops the app from working. */
export async function startAnalytics(): Promise<void> {
  try {
    await tracker.start();
    started = true;
  } catch (error) {
    if (__DEV__) console.warn('analytics did not start', error);
  }
}

/** The calls below do nothing until startAnalytics() has finished. */
export function trackEvent<E extends ClientEventName>(event: E, props: EventProps<E>): void {
  if (started) tracker.track(event, props);
}

export function trackScreen(name: string): void {
  if (started) tracker.screen(name);
}

/** The app or tab became visible (true) or hidden (false). */
export function appVisible(visible: boolean): void {
  if (!started) return;
  if (visible) tracker.foreground();
  else void tracker.background();
}

export { screenName } from './screens';
