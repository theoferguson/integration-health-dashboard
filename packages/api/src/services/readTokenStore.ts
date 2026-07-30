/**
 * Read Token Store
 * Org-scoped, read-only credentials for the `/api/v1` programmatic surface
 * (Door 2 - see ROADMAP #11). A read token is distinct from a project's ingest
 * `api_key` (write) and from the browser session: leaking one must not grant the
 * others. Only the SHA-256 hash is persisted - the plaintext secret is returned
 * once at creation and never retrievable again.
 */

import { randomUUID, randomBytes, createHash } from 'crypto';
import { db } from '../db/connection.js';

export interface ReadToken {
  id: string;
  orgId: string;
  name: string;
  /** Non-secret display snippet, e.g. "ihd_read_ab12cd". */
  prefix: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}

interface ReadTokenRow {
  id: string;
  org_id: string;
  name: string;
  token_hash: string;
  prefix: string;
  created_at: number;
  last_used_at: number | null;
  revoked_at: number | null;
}

const TOKEN_PREFIX = 'ihd_read_';
/** Skip a last_used_at write if the token was already stamped this recently - one write per read would hammer the single SQLite writer. */
const LAST_USED_THROTTLE_MS = 60_000;

function hashToken(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

function rowToToken(row: ReadTokenRow): ReadToken {
  return {
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    prefix: row.prefix,
    createdAt: new Date(row.created_at),
    lastUsedAt: row.last_used_at ? new Date(row.last_used_at) : null,
    revokedAt: row.revoked_at ? new Date(row.revoked_at) : null,
  };
}

/** Mint a token. Returns the row plus the one-time plaintext `secret` to show the caller. */
export function createReadToken(orgId: string, name: string): { token: ReadToken; secret: string } {
  const secret = `${TOKEN_PREFIX}${randomBytes(24).toString('hex')}`;
  const id = randomUUID();
  const now = Date.now();
  const prefix = secret.slice(0, TOKEN_PREFIX.length + 6);

  db.prepare(
    `INSERT INTO read_tokens (id, org_id, name, token_hash, prefix, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, orgId, name, hashToken(secret), prefix, now);

  return {
    token: { id, orgId, name, prefix, createdAt: new Date(now), lastUsedAt: null, revokedAt: null },
    secret,
  };
}

/**
 * Resolve a presented secret to its org, or null if unknown/revoked. Lookup is
 * by hash (indexed) so it doesn't leak timing about the secret itself. Stamps
 * last_used_at, throttled, for auditing.
 */
export function verifyReadToken(
  secret: string
): { orgId: string; tokenId: string; name: string } | null {
  if (!secret.startsWith(TOKEN_PREFIX)) return null;

  const row = db.prepare('SELECT * FROM read_tokens WHERE token_hash = ?').get(hashToken(secret)) as
    | ReadTokenRow
    | undefined;
  if (!row || row.revoked_at) return null;

  const now = Date.now();
  if (!row.last_used_at || now - row.last_used_at > LAST_USED_THROTTLE_MS) {
    db.prepare('UPDATE read_tokens SET last_used_at = ? WHERE id = ?').run(now, row.id);
  }

  // The row is already loaded, so returning the token name for the capability
  // doc's "you" block costs no extra query.
  return { orgId: row.org_id, tokenId: row.id, name: row.name };
}

/** All of an org's tokens (active + revoked), newest first. Never includes the hash or secret. */
export function listReadTokensForOrg(orgId: string): ReadToken[] {
  const rows = db
    .prepare('SELECT * FROM read_tokens WHERE org_id = ? ORDER BY created_at DESC')
    .all(orgId) as ReadTokenRow[];
  return rows.map(rowToToken);
}

/** Revoke a token (idempotent). Returns false if it doesn't exist, isn't this org's, or was already revoked - same signal, so ownership can't be probed by id. */
export function revokeReadTokenForOrg(id: string, orgId: string): boolean {
  const result = db
    .prepare('UPDATE read_tokens SET revoked_at = ? WHERE id = ? AND org_id = ? AND revoked_at IS NULL')
    .run(Date.now(), id, orgId);
  return result.changes > 0;
}
