/** The app is installed already; only the web app offers installing. */
import { create } from 'zustand';

export type InstallWay = 'prompt' | 'ios' | null;

export const useInstall = create<{ way: InstallWay }>(() => ({ way: null }));

export async function promptInstall(): Promise<'accepted' | 'dismissed'> {
  return 'dismissed';
}
