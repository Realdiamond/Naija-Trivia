/**
 * Web push (build plan step 2.5c, TRD FR-NOT-4): the standard Web Push protocol (RFC 8030) that
 * Chrome, Firefox, Edge and Safari share. Each message is encrypted for the browser (RFC 8291,
 * aes128gcm) and signed with our VAPID key (RFC 8292), so no Firebase SDK is needed on the web.
 */
import { createCipheriv, createECDH, createHash, hkdfSync, randomBytes, type ECDH } from 'node:crypto';
import { importJWK, SignJWT } from 'jose';
import {
  INVALID_TOKEN,
  PushRejected,
  type DeviceToken,
  type OutgoingPush,
  type PushTransport,
} from './transport';

export interface VapidKeys {
  /** The P-256 public key, uncompressed (65 bytes), base64url: what browsers subscribe with. */
  publicKey: string;
  /** The private scalar (32 bytes), base64url. */
  privateKey: string;
  /** Who to contact about our pushes: a mailto: or https: address. */
  subject: string;
}

export interface WebPushKeys {
  /** The browser's P-256 public key, base64url. */
  p256dh: string;
  /** Its 16-byte authentication secret, base64url. */
  auth: string;
}

/**
 * The push services browsers use. We only ever send to these: a subscription is something a
 * browser hands us, and its endpoint must not point our servers anywhere else.
 */
const PUSH_SERVICES = [
  'fcm.googleapis.com',
  'push.services.mozilla.com',
  'push.apple.com',
  'notify.windows.com',
];

export function isPushService(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.port !== '' || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  return PUSH_SERVICES.some((s) => host === s || host.endsWith(`.${s}`));
}

const b64 = (value: string) => Buffer.from(value, 'base64url');

/** A key pair from the keys script: the public key follows from the private one. */
export function vapidKeysFrom(privateKey: string, subject: string): VapidKeys {
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(b64(privateKey));
  return { publicKey: ecdh.getPublicKey().toString('base64url'), privateKey, subject };
}

export function newVapidKeys(subject: string): VapidKeys {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return vapidKeysFrom(ecdh.getPrivateKey().toString('base64url'), subject);
}

/** Record size: one record always holds our small messages. */
const RECORD_SIZE = 4096;

/**
 * RFC 8291 §3.4 and RFC 8188: the message as the browser decrypts it. `sender` and `salt` are new
 * for every message; tests pass the RFC's own to check the result.
 */
export function encryptForBrowser(
  plaintext: Buffer,
  keys: WebPushKeys,
  sender: ECDH = newSenderKey(),
  salt: Buffer = randomBytes(16),
): Buffer {
  const uaPublic = b64(keys.p256dh);
  const auth = b64(keys.auth);
  if (uaPublic.length !== 65 || auth.length !== 16) throw new PushRejected('bad subscription keys');
  const asPublic = sender.getPublicKey();
  const shared = sender.computeSecret(uaPublic);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = Buffer.from(hkdfSync('sha256', shared, auth, keyInfo, 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));

  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  // The last (and only) record ends with the 0x02 delimiter.
  const body = Buffer.concat([
    cipher.update(Buffer.concat([plaintext, Buffer.from([2])])),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, body]);
}

function newSenderKey(): ECDH {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return ecdh;
}

/** What the service worker reads (apps/app/public/sw.js). */
export interface WebPushPayload {
  title: string;
  body: string;
  url: string;
  type: string;
  tag: string | null;
}

/** Push services keep a message at most this long. */
const MAX_TTL_SECONDS = 28 * 24 * 3600;
/** A signature is good for 12 hours; we sign a new one after 11. */
const JWT_HOURS = 12;

export class WebPushTransport implements PushTransport {
  readonly real = true;
  private signer: ReturnType<typeof importJWK> | null = null;
  private readonly signatures = new Map<string, { jwt: string; until: number }>();

  constructor(
    private readonly keys: VapidKeys,
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args),
    private readonly now: () => number = Date.now,
  ) {}

  async send(device: DeviceToken, push: OutgoingPush): Promise<'delivered' | typeof INVALID_TOKEN> {
    if (device.platform !== 'web' || !device.keys) throw new PushRejected('not a web push subscription');
    if (!isPushService(device.token)) throw new PushRejected('not a known push service');
    const payload: WebPushPayload = {
      title: push.title,
      body: push.body,
      url: push.url,
      type: push.type,
      tag: push.collapseKey,
    };
    const res = await this.fetchImpl(device.token, {
      method: 'POST',
      headers: {
        authorization: `vapid t=${await this.vapidJwt(new URL(device.token).origin)}, k=${this.keys.publicKey}`,
        'content-encoding': 'aes128gcm',
        'content-type': 'application/octet-stream',
        ttl: String(Math.min(MAX_TTL_SECONDS, Math.max(0, Math.floor(push.ttlSeconds)))),
        urgency: push.type === 'your_turn' || push.type === 'staff_alert' ? 'high' : 'normal',
        // A newer message with the same topic replaces one still waiting at the push service.
        ...(push.collapseKey ? { topic: topicFor(push.collapseKey) } : {}),
      },
      body: new Uint8Array(encryptForBrowser(Buffer.from(JSON.stringify(payload)), device.keys)),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) return 'delivered';
    // The subscription has ended (the player blocked us, or the browser dropped it).
    if (res.status === 404 || res.status === 410) return INVALID_TOKEN;
    const detail = `web push ${res.status} from ${new URL(device.token).hostname}: ${(await res.text()).slice(0, 200)}`;
    if (res.status === 429 || res.status >= 500) throw new Error(detail);
    throw new PushRejected(detail);
  }

  /** RFC 8292: a signed note saying who we are, for each push service. */
  private async vapidJwt(audience: string): Promise<string> {
    const cached = this.signatures.get(audience);
    if (cached && cached.until > this.now()) return cached.jwt;
    this.signer ??= importJWK(
      {
        kty: 'EC',
        crv: 'P-256',
        x: b64(this.keys.publicKey).subarray(1, 33).toString('base64url'),
        y: b64(this.keys.publicKey).subarray(33, 65).toString('base64url'),
        d: this.keys.privateKey,
      },
      'ES256',
    );
    const now = Math.floor(this.now() / 1000);
    const jwt = await new SignJWT({ sub: this.keys.subject })
      .setProtectedHeader({ alg: 'ES256', typ: 'JWT' })
      .setAudience(audience)
      .setExpirationTime(now + JWT_HOURS * 3600)
      .sign(await this.signer);
    this.signatures.set(audience, { jwt, until: this.now() + (JWT_HOURS - 1) * 3_600_000 });
    return jwt;
  }
}

/** Topics are at most 32 URL-safe characters; our collapse keys are longer and have colons. */
function topicFor(collapseKey: string): string {
  return createHash('sha256').update(collapseKey).digest('base64url').slice(0, 32);
}
