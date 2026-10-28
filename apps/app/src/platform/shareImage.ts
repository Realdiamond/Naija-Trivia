/**
 * A share picture in the browser: the share sheet with the picture where the browser can share
 * files (most phones), else a download the player can post to WhatsApp Status themselves.
 */
import { api } from '../api';

export type ImageShareOutcome = 'shared' | 'saved' | 'cancelled';

export async function shareImage(path: string, fileName: string, text: string): Promise<ImageShareOutcome> {
  const blob = await api.blob(path);
  const file = new File([blob], fileName, { type: 'image/png' });
  if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text });
      return 'shared';
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled';
      // NotAllowedError and the like: download it instead.
    }
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return 'saved';
}
