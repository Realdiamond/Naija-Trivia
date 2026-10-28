/**
 * Access tokens: ES256 JWTs, 15 minutes (TRD §3). Refresh tokens: 32 random bytes, stored
 * only as a SHA-256 hash, rotated on every use with reuse detection (doc 09 §2.1).
 */
import { createHash, randomBytes } from 'node:crypto';
import {
  calculateJwkThumbprint,
  exportJWK,
  generateKeyPair,
  importPKCS8,
  importSPKI,
  jwtVerify,
  SignJWT,
  type JWK,
} from 'jose';
import type { PartySeatKind, Platform } from '@whosabi/shared-types';

export const ACCESS_TTL_SECONDS = 15 * 60;
/** A party seat lasts the evening: it also reconnects after a drop. */
export const PARTY_SEAT_TTL_SECONDS = 12 * 3600;
export const REFRESH_TTL_SECONDS = 30 * 24 * 3600;
const ISSUER = 'whosabi-api';
const AUDIENCE = 'whosabi';
/** Party seats are only for the room's WebSocket, never the API (FR-PARTY-7). */
const PARTY_AUDIENCE = 'whosabi-party';

export interface AccessClaims {
  userId: string;
  platform: Platform;
  guest: boolean;
}

/** A seat in one party room: a player (signed in or a web guest with a nickname) or a big screen. */
export interface PartySeatClaims {
  roomId: string;
  /** `u:<user id>`, `g:<random>` for a web guest, `s:<random>` for a screen. */
  seat: string;
  name: string;
  kind: PartySeatKind;
  role: 'player' | 'screen';
  userId: string | null;
  avatarId: string | null;
  platform: Platform;
}

export interface TokenService {
  signAccess(claims: AccessClaims): Promise<string>;
  verifyAccess(token: string): Promise<AccessClaims>;
  signPartySeat(claims: PartySeatClaims): Promise<string>;
  verifyPartySeat(token: string): Promise<PartySeatClaims>;
  /** Public key set served at /.well-known/jwks.json for other services (ingest) to verify tokens. */
  jwks: { keys: JWK[] };
}

type PrivateKey = Awaited<ReturnType<typeof importPKCS8>>;
type PublicKey = Awaited<ReturnType<typeof importSPKI>>;

export async function createTokenService(
  keys: { privateKeyPem?: string; publicKeyPem?: string },
  clock: () => number = Date.now,
): Promise<TokenService> {
  let privateKey: PrivateKey;
  let publicKey: PublicKey;
  if (keys.privateKeyPem && keys.publicKeyPem) {
    privateKey = await importPKCS8(keys.privateKeyPem, 'ES256');
    publicKey = await importSPKI(keys.publicKeyPem, 'ES256');
  } else {
    // Development and tests: a fresh key pair per process.
    const pair = await generateKeyPair('ES256', { extractable: true });
    privateKey = pair.privateKey;
    publicKey = pair.publicKey;
  }
  const publicJwk = await exportJWK(publicKey);
  const kid = await calculateJwkThumbprint(publicJwk);

  return {
    jwks: { keys: [{ ...publicJwk, kid, alg: 'ES256', use: 'sig' }] },
    async signAccess({ userId, platform, guest }) {
      const nowSeconds = Math.floor(clock() / 1000);
      return new SignJWT({ typ: 'access', plt: platform, gst: guest })
        .setProtectedHeader({ alg: 'ES256', kid })
        .setSubject(userId)
        .setIssuer(ISSUER)
        .setAudience(AUDIENCE)
        .setIssuedAt(nowSeconds)
        .setExpirationTime(nowSeconds + ACCESS_TTL_SECONDS)
        .sign(privateKey);
    },
    async verifyAccess(token) {
      const { payload } = await jwtVerify(token, publicKey, {
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithms: ['ES256'],
        currentDate: new Date(clock()),
      });
      if (payload.typ !== 'access' || typeof payload.sub !== 'string') throw new Error('not an access token');
      const platform = payload.plt;
      if (platform !== 'android' && platform !== 'ios' && platform !== 'web')
        throw new Error('bad platform claim');
      return { userId: payload.sub, platform, guest: payload.gst === true };
    },
    async signPartySeat({ roomId, seat, name, kind, role, userId, avatarId, platform }) {
      const nowSeconds = Math.floor(clock() / 1000);
      const claims = { typ: 'party', room: roomId, nm: name, knd: kind, role, uid: userId, av: avatarId };
      return new SignJWT({ ...claims, plt: platform })
        .setProtectedHeader({ alg: 'ES256', kid })
        .setSubject(seat)
        .setIssuer(ISSUER)
        .setAudience(PARTY_AUDIENCE)
        .setIssuedAt(nowSeconds)
        .setExpirationTime(nowSeconds + PARTY_SEAT_TTL_SECONDS)
        .sign(privateKey);
    },
    async verifyPartySeat(token) {
      const { payload } = await jwtVerify(token, publicKey, {
        issuer: ISSUER,
        audience: PARTY_AUDIENCE,
        algorithms: ['ES256'],
        currentDate: new Date(clock()),
      });
      const { room, nm, knd, role, uid, av, plt } = payload;
      if (
        payload.typ !== 'party' ||
        typeof payload.sub !== 'string' ||
        typeof room !== 'string' ||
        typeof nm !== 'string' ||
        (knd !== 'app' && knd !== 'web' && knd !== 'web_guest') ||
        (role !== 'player' && role !== 'screen') ||
        (uid !== null && typeof uid !== 'string') ||
        (av !== null && typeof av !== 'string') ||
        (plt !== 'android' && plt !== 'ios' && plt !== 'web')
      ) {
        throw new Error('not a party seat');
      }
      const seat = payload.sub;
      return { roomId: room, seat, name: nm, kind: knd, role, userId: uid, avatarId: av, platform: plt };
    },
  };
}

export function newRefreshToken(): { token: string; hash: Buffer } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashRefreshToken(token) };
}

export function hashRefreshToken(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}
