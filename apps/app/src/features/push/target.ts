/**
 * Where a tapped push goes (doc 09 §4): the `url` the server put in it, if it is one of the
 * app's own screens for a push. Anything else opens Home, so a bad push can't send the app
 * somewhere odd.
 */
const SCREENS = [/^\/duel\/[A-Za-z0-9_-]{3,40}$/, /^\/friends$/, /^\/daily\/play$/];

export interface PushTarget {
  url: string;
  /** The push type, for analytics (push_opened, push_received). */
  type: string;
}

export function pushTarget(...sources: Array<Record<string, unknown> | null | undefined>): PushTarget {
  const data = Object.assign({}, ...sources.filter(Boolean)) as Record<string, unknown>;
  const type = typeof data.type === 'string' && /^[a-z_]{1,40}$/.test(data.type) ? data.type : 'unknown';
  const url =
    typeof data.url === 'string' && SCREENS.some((s) => s.test(data.url as string)) ? data.url : '/home';
  return { url, type };
}
