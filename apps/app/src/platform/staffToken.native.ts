/** The staff session for this phone, in the Keystore (Android) or Keychain (iOS). */
import * as SecureStore from 'expo-secure-store';

const KEY = 'whosabi.staff';

export const staffToken = {
  get: () => SecureStore.getItemAsync(KEY),
  set: (value: string) => SecureStore.setItemAsync(KEY, value),
  clear: () => SecureStore.deleteItemAsync(KEY),
};
