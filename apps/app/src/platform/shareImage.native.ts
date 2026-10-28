/** A share picture on a phone: saved to the app's cache, then the share sheet (WhatsApp Status and the rest). */
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { api } from '../api';

export type ImageShareOutcome = 'shared' | 'saved' | 'cancelled';

export async function shareImage(path: string, fileName: string, text: string): Promise<ImageShareOutcome> {
  const { url, headers } = await api.fileRequest(path);
  const file = await File.downloadFileAsync(url, new File(Paths.cache, fileName), {
    headers,
    idempotent: true,
  });
  if (!(await Sharing.isAvailableAsync())) return 'saved';
  await Sharing.shareAsync(file.uri, { mimeType: 'image/png', UTI: 'public.png', dialogTitle: text });
  return 'shared';
}
