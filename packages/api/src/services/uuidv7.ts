import { randomBytes } from 'node:crypto';

/**
 * UUIDv7 (RFC 9562): a 48-bit big-endian millisecond timestamp followed by
 * random bits, with the version (7) and variant (10) nibbles set. Unlike v4 it
 * sorts by creation time, which makes it a clean, distinct, time-ordered event
 * id. Entropy comes from crypto.randomBytes; only the bit layout is hand-rolled.
 */
export function uuidv7(): string {
  const ts = Date.now();
  const b = randomBytes(16);

  // 48-bit timestamp -> bytes 0..5 (big-endian). Use Math.floor over division
  // to stay exact above 2^32.
  b[0] = Math.floor(ts / 2 ** 40) & 0xff;
  b[1] = Math.floor(ts / 2 ** 32) & 0xff;
  b[2] = Math.floor(ts / 2 ** 24) & 0xff;
  b[3] = Math.floor(ts / 2 ** 16) & 0xff;
  b[4] = Math.floor(ts / 2 ** 8) & 0xff;
  b[5] = ts & 0xff;

  b[6] = (b[6] & 0x0f) | 0x70; // version 7
  b[8] = (b[8] & 0x3f) | 0x80; // variant 10

  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
