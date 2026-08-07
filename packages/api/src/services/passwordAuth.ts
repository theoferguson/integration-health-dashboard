/**
 * Password hashing (Phase 3 Build 2)
 *
 * Email+password is just another identity provider (`provider='password'`,
 * `provider_user_id` = the normalized email), so signup/login reuse the same
 * userStore path as GitHub/Google/Facebook. The only thing that provider needs
 * beyond the others is a stored secret - that's this file.
 *
 * scrypt comes from Node's stdlib (`crypto`), so there's no bcrypt/argon2
 * dependency. It's memory-hard and the parameters below are Node's defaults
 * (N=16384, r=8, p=1), which is the standard interactive-login work factor.
 *
 * NOTE ON VERIFICATION: a password signup is NEVER treated as an email-verified
 * identity (there is no mailer yet - see ROADMAP #11). userStore therefore drops
 * the address as an account-linking key, so a password account can't link to,
 * or be linked from, an OAuth account. Signing up as someone else's address
 * gains an attacker nothing but their own isolated account.
 */
import { randomBytes, scrypt, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number
) => Promise<Buffer>;

const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

/** Minimum password length enforced at the trust boundary (routes/auth.ts). */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * A well-formed hash that no password matches. Login verifies against this when
 * the account doesn't exist, so the response takes the same ~scrypt time whether
 * or not the address is registered - otherwise the endpoint is a fast/slow
 * account-existence oracle. (32 hex = the 16-byte salt, 64 hex = the 32-byte key.)
 */
export const DUMMY_PASSWORD_HASH = `scrypt$${'0'.repeat(SALT_LENGTH * 2)}$${'0'.repeat(
  KEY_LENGTH * 2
)}`;

/**
 * `scrypt$<salt-hex>$<key-hex>`. The scheme prefix means a future upgrade (more
 * expensive params, a different KDF) can be rehashed on next login without a
 * migration - unrecognized schemes simply fail closed in verifyPassword.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await scryptAsync(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

/** Constant-time compare against a stored hash. False on any malformed input. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, keyHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !keyHex) return false;

  const expected = Buffer.from(keyHex, 'hex');
  if (expected.length !== KEY_LENGTH) return false;

  const actual = await scryptAsync(password, Buffer.from(saltHex, 'hex'), KEY_LENGTH);
  return timingSafeEqual(actual, expected);
}
