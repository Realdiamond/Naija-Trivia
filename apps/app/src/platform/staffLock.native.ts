/**
 * The lock on the Staff tab (step 2.9a): the phone's fingerprint, face or PIN, asked each time
 * staff tools open. A phone with no screen lock at all can't hold a staff session.
 */
import * as LocalAuthentication from 'expo-local-authentication';

export const staffToolsHere = true;

/** True when the phone has a fingerprint, face or a PIN, pattern or password set. */
export async function phoneHasLock(): Promise<boolean> {
  return (await LocalAuthentication.getEnrolledLevelAsync()) !== LocalAuthentication.SecurityLevel.NONE;
}

export async function unlockStaff(): Promise<boolean> {
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: 'Open staff tools',
    cancelLabel: 'Cancel',
    // The PIN or pattern works too, for phones without a fingerprint reader.
    disableDeviceFallback: false,
  });
  return result.success;
}
