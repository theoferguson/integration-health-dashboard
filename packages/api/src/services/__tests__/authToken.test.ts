import { describe, it, expect, vi, afterEach } from 'vitest';
import { createSessionToken, verifySessionToken } from '../authToken.js';

describe('session token', () => {
  it('should round-trip a valid token carrying only the user id', () => {
    const token = createSessionToken('user-1');
    const payload = verifySessionToken(token);

    expect(payload).not.toBeNull();
    expect(payload?.userId).toBe('user-1');
    // The token no longer carries any display field (no PII in the cookie).
    expect(Object.keys(payload!)).not.toContain('login');
  });

  it('should reject a tampered payload', () => {
    const token = createSessionToken('user-1');
    const dotIndex = token.lastIndexOf('.');
    const signature = token.slice(dotIndex + 1);

    const tamperedPayload = Buffer.from(
      JSON.stringify({ userId: 'attacker', login: 'attacker', exp: Date.now() + 100000 })
    ).toString('base64url');
    const tampered = `${tamperedPayload}.${signature}`;

    expect(verifySessionToken(tampered)).toBeNull();
  });

  it('should reject a tampered signature', () => {
    const token = createSessionToken('user-1');
    const tampered = token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a');

    expect(verifySessionToken(tampered)).toBeNull();
  });

  it('should reject an expired token', () => {
    const token = createSessionToken('user-1');
    expect(verifySessionToken(token)?.userId).toBe('user-1');

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 8 * 24 * 60 * 60 * 1000); // past the 7-day expiry
    expect(verifySessionToken(token)).toBeNull();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should reject missing or malformed tokens', () => {
    expect(verifySessionToken(undefined)).toBeNull();
    expect(verifySessionToken(null)).toBeNull();
    expect(verifySessionToken('')).toBeNull();
    expect(verifySessionToken('no-dot-separator')).toBeNull();
  });
});
