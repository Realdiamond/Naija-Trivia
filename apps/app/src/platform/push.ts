/**
 * Push notifications in the browser come with web push (build plan step 2.5c); until then the
 * web app has none, and the prompts asking for them stay hidden.
 */
import type { PushTarget } from '../features/push/target';

export const pushSupported = false;

export type PushPermission = 'granted' | 'denied' | 'undetermined' | 'unsupported';

export async function pushPermission(): Promise<PushPermission> {
  return 'unsupported';
}

export async function enablePush(): Promise<PushPermission> {
  return 'unsupported';
}

export async function syncPush(): Promise<void> {}

export async function forgetPush(): Promise<void> {}

export async function staffPushToken(): Promise<string | null> {
  return null;
}

export function usePushHandlers(_handlers: {
  open(target: PushTarget): void;
  received(target: PushTarget): void;
}): void {}
