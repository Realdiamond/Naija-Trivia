/**
 * Where the refresh token lives (TRD FR-AUTH-7). On the web it is an HttpOnly cookie that
 * JavaScript never sees, so there is nothing to store; refreshToken.native.ts keeps it in
 * the Keystore / Keychain on phones.
 */
export const refreshToken = {
  inBody: false,
  async get(): Promise<string | null> {
    return null;
  },
  async set(_token: string | undefined): Promise<void> {},
  async clear(): Promise<void> {},
};
