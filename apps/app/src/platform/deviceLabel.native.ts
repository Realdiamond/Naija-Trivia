import { Platform } from 'react-native';

/** The phone's make and model, for a message to support (step 2.7p), e.g. "TECNO Spark 10". */
export function deviceLabel(): string {
  const c = Platform.constants as { Brand?: string; Model?: string };
  return [c.Brand, c.Model].filter(Boolean).join(' ').slice(0, 80) || Platform.OS;
}
