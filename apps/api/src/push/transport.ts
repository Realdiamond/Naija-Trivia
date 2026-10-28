/**
 * Getting a push to a phone. Android goes through Firebase Cloud Messaging (the HTTP v1 API,
 * signed in with the Firebase project's service account); until that is set up, a stand-in writes
 * each message to the log. Web push joins in step 2.5c.
 */
import type { FastifyBaseLogger } from 'fastify';
import { importPKCS8, SignJWT } from 'jose';
import { z } from 'zod';
import type { RenderedPush } from './messages';

export interface DeviceToken {
  id: string;
  platform: 'android' | 'ios' | 'web';
  token: string;
}

export interface OutgoingPush extends RenderedPush {
  /** One notification per key on the phone: a newer one replaces it. */
  collapseKey: string | null;
  /** How long the push service keeps trying to reach a phone that is off. */
  ttlSeconds: number;
}

/** The token is dead (app uninstalled, or the token was replaced): forget it. */
export const INVALID_TOKEN = 'invalid_token';

/** The push service refused this message for good; trying again won't help. */
export class PushRejected extends Error {}

export interface PushTransport {
  /** False for the stand-in, whose messages only reach the log (and are not counted as sent). */
  readonly real: boolean;
  /**
   * 'delivered' once the push service has the message, or INVALID_TOKEN. Throws PushRejected
   * for a refused message, and anything else for a failure worth trying again.
   */
  send(device: DeviceToken, push: OutgoingPush): Promise<'delivered' | typeof INVALID_TOKEN>;
}

export class LogTransport implements PushTransport {
  readonly real = false;
  constructor(private readonly log: FastifyBaseLogger) {}

  async send(device: DeviceToken, push: OutgoingPush): Promise<'delivered'> {
    this.log.info(
      { device: device.id, push: { type: push.type, title: push.title, body: push.body, url: push.url } },
      'push not sent (no FIREBASE_SERVICE_ACCOUNT yet): here is the message',
    );
    return 'delivered';
  }
}

/** The service account key file from Firebase (Project settings → Service accounts), as JSON. */
export const ServiceAccount = z.object({
  project_id: z.string().min(1),
  client_email: z.email(),
  private_key: z.string().includes('PRIVATE KEY'),
  token_uri: z.url().default('https://oauth2.googleapis.com/token'),
});
export type ServiceAccount = z.infer<typeof ServiceAccount>;

const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
/** A new sign-in this long before the last one runs out. */
const TOKEN_MARGIN_MS = 5 * 60_000;

export class FcmTransport implements PushTransport {
  readonly real = true;
  private access: { token: string; expiresAt: number } | null = null;
  private signingIn: Promise<string> | null = null;

  constructor(
    private readonly account: ServiceAccount,
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args),
    private readonly now: () => number = Date.now,
  ) {}

  async send(device: DeviceToken, push: OutgoingPush): Promise<'delivered' | typeof INVALID_TOKEN> {
    if (device.platform !== 'android') throw new PushRejected(`no ${device.platform} pushes yet`);
    const res = await this.fetchImpl(
      `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(this.account.project_id)}/messages:send`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${await this.accessToken()}`, 'content-type': 'application/json' },
        body: JSON.stringify({ message: fcmMessage(device.token, push) }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (res.ok) return 'delivered';
    const error = await fcmError(res);
    if (error.code === 'UNREGISTERED' || error.code === 'SENDER_ID_MISMATCH') return INVALID_TOKEN;
    if (res.status === 401) this.access = null; // signed out early: sign in again next time
    // Too many, or Google's side: worth another go later. Anything else is about this message.
    if (res.status === 401 || res.status === 429 || res.status >= 500) {
      throw new Error(`FCM ${res.status} ${error.code}: ${error.message}`);
    }
    throw new PushRejected(`FCM ${res.status} ${error.code}: ${error.message}`);
  }

  /** An OAuth access token for the service account, shared by concurrent sends. */
  private async accessToken(): Promise<string> {
    if (this.access && this.access.expiresAt - this.now() > TOKEN_MARGIN_MS) return this.access.token;
    this.signingIn ??= this.signIn().finally(() => {
      this.signingIn = null;
    });
    return this.signingIn;
  }

  private async signIn(): Promise<string> {
    const now = Math.floor(this.now() / 1000);
    const assertion = await new SignJWT({ scope: SCOPE })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
      .setIssuer(this.account.client_email)
      .setAudience(this.account.token_uri)
      .setIssuedAt(now)
      .setExpirationTime(now + 3600)
      .sign(await importPKCS8(this.account.private_key, 'RS256'));
    const res = await this.fetchImpl(this.account.token_uri, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Google sign-in for FCM failed: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as { access_token: string; expires_in: number };
    this.access = { token: body.access_token, expiresAt: this.now() + body.expires_in * 1000 };
    return body.access_token;
  }
}

/** The FCM v1 message: shown by Android itself, on the push's channel, replacing older ones of its key. */
export function fcmMessage(token: string, push: OutgoingPush) {
  return {
    token,
    notification: { title: push.title, body: push.body },
    data: { ...push.data, type: push.type, url: push.url },
    android: {
      priority: push.type === 'your_turn' || push.type === 'staff_alert' ? 'HIGH' : 'NORMAL',
      ttl: `${Math.max(0, Math.floor(push.ttlSeconds))}s`,
      ...(push.collapseKey ? { collapse_key: push.collapseKey } : {}),
      notification: {
        channel_id: push.channel,
        color: '#008751',
        ...(push.collapseKey ? { tag: push.collapseKey } : {}),
      },
    },
  };
}

async function fcmError(res: Response): Promise<{ code: string; message: string }> {
  try {
    const body = (await res.json()) as {
      error?: { status?: string; message?: string; details?: Array<{ errorCode?: string }> };
    };
    const code = body.error?.details?.find((d) => d.errorCode)?.errorCode ?? body.error?.status ?? 'UNKNOWN';
    return { code, message: body.error?.message ?? '' };
  } catch {
    return { code: 'UNKNOWN', message: res.statusText };
  }
}
