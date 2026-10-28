/** The browser's share sheet where there is one (most phones); elsewhere the app offers copy and WhatsApp. */
export const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

export async function shareText(text: string, url: string): Promise<boolean> {
  try {
    await navigator.share({ text, url });
    return true;
  } catch {
    return false; // dismissed, or not allowed here
  }
}
