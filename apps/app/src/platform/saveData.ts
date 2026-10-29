/** A file from the API saved in the browser: the download goes to the player's Downloads. */
import { api } from '../api';

export async function saveFromApi(path: string, fileName: string): Promise<void> {
  const blob = await api.blob(path);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
