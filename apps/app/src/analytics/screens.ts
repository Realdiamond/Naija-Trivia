/**
 * Expo Router segments to a tracking-plan screen name: `['profile-setup']` → `profile_setup`,
 * `['duel', '[id]']` → `duel.id`. Route groups like `(tabs)` are left out.
 */
export function screenName(segments: readonly string[]): string {
  const parts = segments
    .filter((s) => !s.startsWith('('))
    .slice(0, 2)
    .map((s) =>
      s
        .replace(/[[\].]/g, '')
        .replace(/[^a-z0-9]+/gi, '_')
        .replace(/^_+|_+$/g, '')
        .toLowerCase(),
    )
    .filter(Boolean)
    .map((s) => (/^[a-z]/.test(s) ? s : `s_${s}`));
  return parts.length > 0 ? parts.join('.') : 'index';
}
