/**
 * Phones send the first two codes of the day without a human check (doc 10 §1). After that the
 * API asks for one, which the app can't show yet, so the player signs in another way.
 */
export const captchaAvailable = false;

export async function captchaToken(): Promise<string | undefined> {
  return undefined;
}
