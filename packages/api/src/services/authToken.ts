/**
 * Minimal HMAC-signed session cookie - same pattern as integrations-host-app's
 * authToken.ts. Here it identifies a signed-in user (not a single admin):
 * recompute the HMAC, compare in constant time, check expiry.
 */
import { createHmac, timingSafeEqual } from 'crypto';

export interface SessionPayload {
  userId: string;
  login: string;
  exp: number;
}

const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

function getSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (secret) return secret;
  console.warn(
    '[auth] SESSION_SECRET is not set - using an insecure dev-only default. Set a real secret before deploying.'
  );
  return 'dev-only-insecure-secret-do-not-use-in-production';
}

function sign(payload: string): string {
  return createHmac('sha256', getSecret()).update(payload).digest('hex');
}

export function createSessionToken(userId: string, login: string): string {
  const payload: SessionPayload = { userId, login, exp: Date.now() + SESSION_DURATION_MS };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encoded}.${sign(encoded)}`;
}

export function verifySessionToken(token: string | undefined | null): SessionPayload | null {
  if (!token) return null;

  const dotIndex = token.lastIndexOf('.');
  if (dotIndex === -1) return null;
  const encoded = token.slice(0, dotIndex);
  const signature = token.slice(dotIndex + 1);

  const expected = sign(encoded);
  const sigBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf-8')) as SessionPayload;
    if (typeof payload.exp !== 'number' || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}
