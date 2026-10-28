import * as SecureStore from 'expo-secure-store';

const KEY = 'whosabi.refresh';

/** The refresh token in the Keystore (Android) or Keychain (iOS), sent in request bodies. */
export const refreshToken = {
  inBody: true,
  get: () => SecureStore.getItemAsync(KEY),
  async set(token: string | undefined): Promise<void> {
    if (token) await SecureStore.setItemAsync(KEY, token);
  },
  clear: () => SecureStore.deleteItemAsync(KEY),
};
