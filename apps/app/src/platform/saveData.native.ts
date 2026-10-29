/** A file from the API on a phone: saved to the app's cache, then the share sheet to keep or send it. */
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { api } from '../api';

export async function saveFromApi(path: string, fileName: string): Promise<void> {
  const { url, headers } = await api.fileRequest(path);
  const file = await File.downloadFileAsync(url, new File(Paths.cache, fileName), {
    headers,
    idempotent: true,
  });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, { mimeType: 'application/json', UTI: 'public.json' });
  }
}
