/**
 * The analytics consent choice (doc 10 §2, TRD FR-WEB-11). Until the player chooses, only what
 * the service needs is kept (the session, this choice, the event queue) and only core events
 * are sent. The choice is saved on the device at once and sent to the server once signed in.
 */
import { create } from 'zustand';
import { routes } from '@whosabi/shared-types';
import { setBehaviourConsent } from '../../analytics';
import { api, onSession } from '../../api';
import { PLATFORM } from '../../config';
import { storage } from '../../platform/storage';

/** The privacy policy version the choice is given under; bump it to ask again. */
export const POLICY_VERSION = '2026-10';
const KEY = 'whosabi.consent';

interface Choice {
  analytics: boolean;
  version: string;
  /** False until the server has recorded it. */
  synced: boolean;
}

export const useConsent = create<{ choice: Choice | null; loaded: boolean }>(() => ({
  choice: null,
  loaded: false,
}));

function apply(choice: Choice | null): void {
  useConsent.setState({ choice, loaded: true });
  setBehaviourConsent(choice?.analytics === true);
}

export async function loadConsent(): Promise<void> {
  const raw = await storage.getItem(KEY);
  let choice: Choice | null = null;
  try {
    const parsed = raw ? (JSON.parse(raw) as Choice) : null;
    if (parsed && parsed.version === POLICY_VERSION && typeof parsed.analytics === 'boolean') choice = parsed;
  } catch {
    // A damaged value just asks again.
  }
  apply(choice);
  void syncConsent();
}

export async function chooseConsent(analytics: boolean): Promise<void> {
  const choice: Choice = { analytics, version: POLICY_VERSION, synced: false };
  apply(choice);
  await storage.setItem(KEY, JSON.stringify(choice));
  await syncConsent();
}

/** Records the choice on the server (POST /v1/me/consents); tried again at the next sign-in. */
export async function syncConsent(): Promise<void> {
  const choice = useConsent.getState().choice;
  if (!choice || choice.synced || !api.current) return;
  try {
    await api.post(routes.meConsents(), {
      source: PLATFORM === 'web' ? 'web_banner' : 'onboarding',
      consents: [{ purpose: 'analytics', granted: choice.analytics, policy_version: choice.version }],
    });
    const synced = { ...choice, synced: true };
    useConsent.setState({ choice: synced });
    await storage.setItem(KEY, JSON.stringify(synced));
  } catch {
    // Offline or signed out: the next session tries again.
  }
}

onSession((session) => {
  if (session) void syncConsent();
});
