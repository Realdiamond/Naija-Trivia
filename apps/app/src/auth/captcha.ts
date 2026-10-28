/**
 * The human check before a phone code is sent (doc 10 §1): Cloudflare Turnstile, which the web
 * needs every time. It only shows a challenge when it is unsure. Without a site key
 * (development) the API's stand-in accepts any token.
 */
import { TURNSTILE_SITE_KEY } from '../config';
import { loadScript } from '../platform/loadScript';

interface Turnstile {
  render(
    container: HTMLElement,
    options: {
      sitekey: string;
      appearance: 'interaction-only';
      callback: (token: string) => void;
      'error-callback': () => void;
    },
  ): string;
  remove(widgetId: string): void;
}

export const captchaAvailable = true;

export async function captchaToken(): Promise<string | undefined> {
  if (!TURNSTILE_SITE_KEY) return 'development';
  await loadScript('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit');
  const turnstile = (window as unknown as { turnstile: Turnstile }).turnstile;
  const container = document.createElement('div');
  container.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:1000';
  document.body.appendChild(container);
  try {
    return await new Promise<string>((resolve, reject) => {
      const id = turnstile.render(container, {
        sitekey: TURNSTILE_SITE_KEY,
        appearance: 'interaction-only',
        callback: (token) => {
          turnstile.remove(id);
          resolve(token);
        },
        'error-callback': () => reject(new Error('Turnstile failed')),
      });
    });
  } finally {
    container.remove();
  }
}
