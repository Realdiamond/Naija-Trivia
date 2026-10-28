import AsyncStorage from '@react-native-async-storage/async-storage';

/** Small key-value storage on Android and iOS (TRD §5.6). MMKV replaces it with the dev build. */
export const storage = {
  getItem: (key: string) => AsyncStorage.getItem(key),
  setItem: (key: string, value: string) => AsyncStorage.setItem(key, value),
  removeItem: (key: string) => AsyncStorage.removeItem(key),
};
