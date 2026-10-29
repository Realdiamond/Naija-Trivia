/**
 * Installing the web app (build plan step 2.8c, TRD FR-WEB-3). Chrome, Edge and Samsung Internet
 * offer their own install prompt, which waits until the player taps Install on our card; Safari
 * on iPhone and iPad has none, so there the card gives the steps for "Add to Home Screen".
 */
import { create } from 'zustand';
import { trackEvent } from '../analytics';
import { isIos, isStandalone } from './browser';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** How this browser installs: its own prompt, Safari's steps, or not at all (or already done). */
export type InstallWay = 'prompt' | 'ios' | null;

const inBrowser = typeof window !== 'undefined' && typeof navigator !== 'undefined';

export const useInstall = create<{ way: InstallWay }>(() => ({
  way: inBrowser && isIos() && !isStandalone() ? 'ios' : null,
}));

let deferred: BeforeInstallPromptEvent | null = null;
let fromOurCard = false;

// Listened for as the app loads: the browser can offer the prompt before any screen is up.
if (inBrowser && !isStandalone()) {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferred = event as BeforeInstallPromptEvent;
    useInstall.setState({ way: 'prompt' });
  });
  window.addEventListener('appinstalled', () => {
    trackEvent('pwa_installed', { prompt: fromOurCard ? 'auto' : 'manual' });
    deferred = null;
    useInstall.setState({ way: null });
  });
}

/** Shows the browser's prompt (once: a prompt can't be shown twice). */
export async function promptInstall(): Promise<'accepted' | 'dismissed'> {
  const event = deferred;
  if (!event) return 'dismissed';
  deferred = null;
  fromOurCard = true;
  await event.prompt();
  const { outcome } = await event.userChoice;
  useInstall.setState({ way: null });
  return outcome;
}
