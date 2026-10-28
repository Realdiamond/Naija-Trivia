/**
 * The API client (doc 09 §1): JSON over HTTPS, problem+json errors, a 15-minute access token
 * refreshed with the refresh token (in the body on phones, an HttpOnly cookie on the web).
 *
 * No React Native imports, so it runs in unit tests as is; the platform pieces are injected.
 */
import {
  routes,
  type AuthMethodsResponse,
  type AuthResponse,
  type OtpSendResponse,
  type Platform,
  type PublicUser,
  type SignInResponse,
} from '@whosabi/shared-types';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    title: string,
    readonly detail?: string,
  ) {
    super(title);
    this.name = 'ApiError';
  }
}

export interface Session {
  access: string;
  /** Epoch ms when the access token stops working. */
  expiresAt: number;
  user: PublicUser;
}

export interface TokenStore {
  /** True on phones: the refresh token travels in the body. False on the web: it is a cookie. */
  inBody: boolean;
  get(): Promise<string | null>;
  set(token: string | undefined): Promise<void>;
  clear(): Promise<void>;
}

export interface ApiClientOptions {
  baseUrl: string;
  platform: Platform;
  appVersion: string;
  refreshToken: TokenStore;
  fetch?: typeof fetch;
  now?: () => number;
  /** The analytics session, sent as X-Session-Id so server events join it (doc 09 §1). */
  sessionId?: () => string | null;
  onSession?: (session: Session | null) => void;
}

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';
/** `optional`: send the token when there is one, but never refresh or retry (sign-in calls). */
type Auth = 'required' | 'optional' | 'none';

interface RequestOptions {
  body?: unknown;
  auth?: Auth;
  headers?: Record<string, string>;
}

/** Refresh this long before the access token runs out, so a request never starts on a dying token. */
const REFRESH_MARGIN_MS = 30_000;

export class ApiClient {
  private session: Session | null = null;
  private refreshing: Promise<Session | null> | null = null;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  constructor(private readonly opts: ApiClientOptions) {
    this.fetchImpl = opts.fetch ?? ((...args) => fetch(...args));
    this.now = opts.now ?? (() => Date.now());
  }

  get current(): Session | null {
    return this.session;
  }

  async request<T>(method: Method, path: string, options: RequestOptions = {}): Promise<T> {
    return this.read<T>(await this.exchange(method, path, options));
  }

  /** A picture the API draws (a share card), with the same token handling as any other call. */
  async blob(path: string): Promise<Blob> {
    const res = await this.exchange('GET', path, { headers: { accept: 'image/png' } });
    return res.ok ? res.blob() : this.read<never>(res);
  }

  /**
   * Where to fetch a file from outside fetch (a download straight to the phone's storage): its
   * address and headers, with a token that has time left on it.
   */
  async fileRequest(path: string): Promise<{ url: string; headers: Record<string, string> }> {
    if (!this.session || this.session.expiresAt - this.now() < REFRESH_MARGIN_MS) await this.refresh();
    if (!this.session) throw new ApiError(401, 'UNAUTHORIZED', 'You need to sign in');
    return {
      url: `${this.opts.baseUrl}${path}`,
      headers: { ...this.headers({}, 'required'), accept: 'image/png' },
    };
  }

  /** Sends a request, renewing the token first if it is about to run out, and once more after a 401. */
  private async exchange(method: Method, path: string, options: RequestOptions): Promise<Response> {
    const auth = options.auth ?? 'required';
    if (auth !== 'none' && this.session && this.session.expiresAt - this.now() < REFRESH_MARGIN_MS) {
      await this.refresh();
    }
    let res = await this.send(method, path, options, auth);
    if (res.status === 401 && auth === 'required' && this.session) {
      if (await this.refresh()) res = await this.send(method, path, options, auth);
    }
    return res;
  }

  get<T>(path: string, options?: RequestOptions) {
    return this.request<T>('GET', path, options);
  }

  post<T>(path: string, body?: unknown, options?: RequestOptions) {
    return this.request<T>('POST', path, { ...options, body });
  }

  patch<T>(path: string, body: unknown, options?: RequestOptions) {
    return this.request<T>('PATCH', path, { ...options, body });
  }

  /**
   * Renews the session from the refresh token. Concurrent callers share one request, because
   * the server rotates the token and treats a second use as theft. Returns null when signed out.
   */
  refresh(): Promise<Session | null> {
    this.refreshing ??= (async () => {
      try {
        const stored = this.opts.refreshToken.inBody ? await this.opts.refreshToken.get() : null;
        if (this.opts.refreshToken.inBody && !stored) return this.end();
        const res = await this.send(
          'POST',
          routes.authRefresh(),
          { body: stored ? { refresh: stored } : undefined },
          'none',
        );
        // 401: expired, revoked or reused; 403: the web cookie came from the wrong place.
        if (res.status === 401 || res.status === 403) return this.end();
        return this.adopt(await this.read<AuthResponse>(res));
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  /** Play straight away: the same device always gets the same guest back (doc 09 §2.1). */
  async signInGuest(deviceId: string): Promise<Session> {
    const res = await this.post<AuthResponse>(
      routes.authGuest(),
      { device_id: deviceId, platform: this.opts.platform },
      { auth: 'none' },
    );
    return this.adopt(res);
  }

  methods(): Promise<AuthMethodsResponse> {
    return this.get<AuthMethodsResponse>(routes.authMethods(), { auth: 'none' });
  }

  sendPhoneCode(phone: string, turnstileToken?: string): Promise<OtpSendResponse> {
    return this.post<OtpSendResponse>(
      routes.authOtpSend(),
      { phone, platform: this.opts.platform, ...(turnstileToken ? { turnstile_token: turnstileToken } : {}) },
      { auth: 'optional' },
    );
  }

  /** Signs in and keeps the current guest's progress (FR-AUTH-4). */
  async verifyPhoneCode(requestId: string, code: string): Promise<SignInResponse> {
    const res = await this.post<SignInResponse>(
      routes.authOtpVerify(),
      { request_id: requestId, code, merge_guest: true },
      { auth: 'optional' },
    );
    this.adopt(res);
    return res;
  }

  async signInWithGoogle(idToken: string): Promise<SignInResponse> {
    const res = await this.post<SignInResponse>(
      routes.authGoogle(),
      { id_token: idToken, platform: this.opts.platform, merge_guest: true },
      { auth: 'optional' },
    );
    this.adopt(res);
    return res;
  }

  async logout(): Promise<void> {
    const stored = this.opts.refreshToken.inBody ? await this.opts.refreshToken.get() : null;
    try {
      await this.send(
        'POST',
        routes.authLogout(),
        { body: stored ? { refresh: stored } : undefined },
        'none',
      );
    } finally {
      await this.end();
    }
  }

  private async adopt(res: AuthResponse): Promise<Session> {
    const session: Session = {
      access: res.access,
      expiresAt: this.now() + res.access_expires_in * 1000,
      user: res.user,
    };
    if (res.refresh) await this.opts.refreshToken.set(res.refresh);
    this.session = session;
    this.opts.onSession?.(session);
    return session;
  }

  private async end(): Promise<null> {
    await this.opts.refreshToken.clear();
    this.session = null;
    this.opts.onSession?.(null);
    return null;
  }

  private headers(extra: Record<string, string>, auth: Auth): Record<string, string> {
    const headers: Record<string, string> = {
      accept: 'application/json',
      'x-platform': this.opts.platform,
      'x-app-version': this.opts.appVersion,
      // The API only accepts a cookie refresh with this header (CSRF guard, FR-AUTH-7).
      'x-requested-with': 'whosabi',
      ...extra,
    };
    const sessionId = this.opts.sessionId?.();
    if (sessionId) headers['x-session-id'] = sessionId;
    if (auth !== 'none' && this.session) headers.authorization = `Bearer ${this.session.access}`;
    return headers;
  }

  private send(method: Method, path: string, options: RequestOptions, auth: Auth): Promise<Response> {
    const headers = this.headers(options.headers ?? {}, auth);
    if (options.body !== undefined) headers['content-type'] = 'application/json';
    return this.fetchImpl(`${this.opts.baseUrl}${path}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      // The web's refresh cookie; phones ignore it.
      credentials: 'include',
    });
  }

  private async read<T>(res: Response): Promise<T> {
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    const data: unknown = text ? JSON.parse(text) : undefined;
    if (res.ok) return data as T;
    const problem = (data ?? {}) as { code?: string; title?: string; detail?: string };
    throw new ApiError(
      res.status,
      problem.code ?? 'INTERNAL',
      problem.title ?? 'Something went wrong',
      problem.detail,
    );
  }
}

/** A message a player can act on, from any error; `offline` is the words for a failed connection. */
export function errorMessage(error: unknown, offline: string): string {
  if (error instanceof ApiError) return error.detail ?? error.message;
  return offline;
}
