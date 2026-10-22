import type { FastifyInstance, FastifyRequest } from 'fastify';
import { unauthorized } from '../errors';
import type { AccessClaims, TokenService } from './tokens';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set when a valid access token was presented. */
    auth: AccessClaims | null;
  }
}

/**
 * Reads `Authorization: Bearer <token>` on every request. A missing token leaves
 * `request.auth` null (routes decide); a bad or expired one is a 401 so the client refreshes.
 */
export function registerAuth(app: FastifyInstance, tokens: TokenService): void {
  app.decorateRequest('auth', null);
  app.addHook('onRequest', async (request) => {
    const header = request.headers.authorization;
    // Sign-in and refresh happen exactly when the access token has expired, so they ignore it.
    if (!header || request.url.startsWith('/v1/auth/')) return;
    const match = /^Bearer\s+(.+)$/i.exec(header);
    if (!match) throw unauthorized('Expected a Bearer token.');
    try {
      request.auth = await tokens.verifyAccess(match[1]!);
    } catch {
      throw unauthorized('Your session has expired. Refresh and try again.');
    }
  });
}

export function requireAuth(request: FastifyRequest): AccessClaims {
  if (!request.auth) throw unauthorized();
  return request.auth;
}

/**
 * For routes under /v1/auth, which skip the check above: the caller's session, if they sent
 * one. A token that is sent but invalid or expired is a 401, so the client refreshes and
 * retries rather than silently losing the guest it meant to keep.
 */
export async function sessionFromHeader(
  request: FastifyRequest,
  tokens: TokenService,
): Promise<AccessClaims | null> {
  const header = request.headers.authorization;
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) throw unauthorized('Expected a Bearer token.');
  try {
    return await tokens.verifyAccess(match[1]!);
  } catch {
    throw unauthorized('Your session has expired. Refresh and try again.');
  }
}
