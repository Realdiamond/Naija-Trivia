/**
 * Native Google Sign-In needs a development build with its own native module (TRD §5.6), which
 * comes with the Android release build. Until then the app offers the other ways in.
 */
export const googleAvailable = false;

export function GoogleButton(_props: { onToken: (idToken: string) => void; label: string }) {
  return null;
}
