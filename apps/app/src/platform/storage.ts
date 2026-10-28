/**
 * Small key-value storage (TRD §5.6). Web: localStorage, which can throw in private windows,
 * so every call is guarded. The app uses storage.native.ts instead.
 */
export const storage = {
  async getItem(key: string): Promise<string | null> {
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },
  async setItem(key: string, value: string): Promise<void> {
    try {
      globalThis.localStorage?.setItem(key, value);
    } catch {
      // Storage full or blocked: the app still works, it just forgets on reload.
    }
  },
  async removeItem(key: string): Promise<void> {
    try {
      globalThis.localStorage?.removeItem(key);
    } catch {
      // As above.
    }
  },
};
