/**
 * OAuth Authorization Server storage (ROADMAP #11, Phase 4)
 *
 * All persistence for the AS that lets Claude.ai / Claude Desktop connect to the
 * MCP server via browser sign-in instead of a pasted read token. The protocol
 * logic lives in mcp/oauthProvider.ts; this file is only rows in and rows out.
 *
 * SECRET HANDLING mirrors readTokenStore: authorization codes and access/refresh
 * tokens are stored as SHA-256 hashes, never plaintext, so a database read can't
 * be replayed as a credential. Client secrets are NOT stored at all - every
 * client is registered public and authenticated by PKCE (see db/connection.ts).
 */

import { randomUUID, randomBytes, createHash } from 'crypto';
import { db } from '../db/connection.js';
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';

/** How long a parked /authorize request stays resumable while the user signs in. */
const PENDING_TTL_MS = 15 * 60_000;
/** Authorization codes are exchanged immediately; short per OAuth 2.1. */
const CODE_TTL_MS = 60_000;
/** Access-token lifetime. Refresh tokens don't expire (revocation is the control). */
export const ACCESS_TOKEN_TTL_MS = 60 * 60_000;

const ACCESS_PREFIX = 'ihd_mcp_';
const REFRESH_PREFIX = 'ihd_mcpr_';

function hash(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

function newSecret(prefix: string): string {
  return `${prefix}${randomBytes(32).toString('hex')}`;
}

// ---- Clients (RFC 7591 dynamic client registration) ----------------------

interface ClientRow {
  client_id: string;
  client_name: string | null;
  redirect_uris: string;
  grant_types: string;
  response_types: string;
  scope: string | null;
  created_at: number;
}

function rowToClient(row: ClientRow): OAuthClientInformationFull {
  return {
    client_id: row.client_id,
    client_name: row.client_name ?? undefined,
    redirect_uris: JSON.parse(row.redirect_uris),
    grant_types: JSON.parse(row.grant_types),
    response_types: JSON.parse(row.response_types),
    scope: row.scope ?? undefined,
    client_id_issued_at: Math.floor(row.created_at / 1000),
    // No client_secret, deliberately - see db/connection.ts. Its absence is what
    // makes the SDK's plaintext-comparison client auth a no-op for us.
    token_endpoint_auth_method: 'none',
  } as OAuthClientInformationFull;
}

export function getOAuthClient(clientId: string): OAuthClientInformationFull | undefined {
  const row = db.prepare('SELECT * FROM oauth_clients WHERE client_id = ?').get(clientId) as
    | ClientRow
    | undefined;
  return row ? rowToClient(row) : undefined;
}

export function registerOAuthClient(
  client: Omit<OAuthClientInformationFull, 'client_id' | 'client_id_issued_at'>
): OAuthClientInformationFull {
  const clientId = randomUUID();
  const now = Date.now();

  db.prepare(
    `INSERT INTO oauth_clients (client_id, client_name, redirect_uris, grant_types, response_types, scope, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    clientId,
    client.client_name ?? null,
    JSON.stringify(client.redirect_uris),
    JSON.stringify(client.grant_types ?? ['authorization_code', 'refresh_token']),
    JSON.stringify(client.response_types ?? ['code']),
    client.scope ?? null,
    now
  );

  return getOAuthClient(clientId)!;
}

// ---- Pending authorizations ----------------------------------------------

export interface PendingAuthorization {
  id: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state: string | null;
  scope: string | null;
  resource: string | null;
}

interface PendingRow {
  id: string;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  state: string | null;
  scope: string | null;
  resource: string | null;
  expires_at: number;
}

/** Park an /authorize request and return its id, to be resumed after consent. */
export function createPendingAuthorization(input: {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state?: string;
  scope?: string;
  resource?: string;
}): string {
  // Sweep here rather than on a timer: /authorize is the only thing that grows
  // these two tables, it's low-traffic, and both deletes are indexed on
  // expires_at. That's a whole scheduler avoided for one cheap statement.
  purgeExpiredOAuthRows();

  const id = randomUUID();
  db.prepare(
    `INSERT INTO oauth_pending (id, client_id, redirect_uri, code_challenge, state, scope, resource, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.clientId,
    input.redirectUri,
    input.codeChallenge,
    input.state ?? null,
    input.scope ?? null,
    input.resource ?? null,
    Date.now() + PENDING_TTL_MS
  );
  return id;
}

export function getPendingAuthorization(id: string): PendingAuthorization | undefined {
  const row = db.prepare('SELECT * FROM oauth_pending WHERE id = ?').get(id) as
    | PendingRow
    | undefined;
  if (!row || row.expires_at < Date.now()) return undefined;
  return {
    id: row.id,
    clientId: row.client_id,
    redirectUri: row.redirect_uri,
    codeChallenge: row.code_challenge,
    state: row.state,
    scope: row.scope,
    resource: row.resource,
  };
}

export function deletePendingAuthorization(id: string): void {
  db.prepare('DELETE FROM oauth_pending WHERE id = ?').run(id);
}

// ---- Authorization codes --------------------------------------------------

export interface AuthorizationCodeRecord {
  clientId: string;
  userId: string;
  orgId: string;
  redirectUri: string;
  codeChallenge: string;
  scope: string | null;
  resource: string | null;
}

interface CodeRow {
  code_hash: string;
  client_id: string;
  user_id: string;
  org_id: string;
  redirect_uri: string;
  code_challenge: string;
  scope: string | null;
  resource: string | null;
  expires_at: number;
  consumed_at: number | null;
}

/** Mint a single-use authorization code bound to the consenting user + org. */
export function createAuthorizationCode(input: AuthorizationCodeRecord): string {
  const code = newSecret('ihd_code_');
  db.prepare(
    `INSERT INTO oauth_codes (code_hash, client_id, user_id, org_id, redirect_uri, code_challenge, scope, resource, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    hash(code),
    input.clientId,
    input.userId,
    input.orgId,
    input.redirectUri,
    input.codeChallenge,
    input.scope,
    input.resource,
    Date.now() + CODE_TTL_MS
  );
  return code;
}

/** Look up a code without consuming it (the SDK reads the PKCE challenge first). */
export function getAuthorizationCode(code: string): AuthorizationCodeRecord | undefined {
  const row = db.prepare('SELECT * FROM oauth_codes WHERE code_hash = ?').get(hash(code)) as
    | CodeRow
    | undefined;
  if (!row || row.consumed_at || row.expires_at < Date.now()) return undefined;
  return {
    clientId: row.client_id,
    userId: row.user_id,
    orgId: row.org_id,
    redirectUri: row.redirect_uri,
    codeChallenge: row.code_challenge,
    scope: row.scope,
    resource: row.resource,
  };
}

/**
 * Atomically consume a code. Returns the record only for the FIRST caller - a
 * replayed code loses the UPDATE race and gets undefined, which is what makes
 * codes single-use even with two requests in flight.
 */
export function consumeAuthorizationCode(code: string): AuthorizationCodeRecord | undefined {
  const record = getAuthorizationCode(code);
  if (!record) return undefined;
  const result = db
    .prepare('UPDATE oauth_codes SET consumed_at = ? WHERE code_hash = ? AND consumed_at IS NULL')
    .run(Date.now(), hash(code));
  return result.changes > 0 ? record : undefined;
}

// ---- Access + refresh tokens ---------------------------------------------

export interface OAuthTokenRecord {
  clientId: string;
  userId: string;
  orgId: string;
  scope: string | null;
  resource: string | null;
  expiresAt: number | null;
}

interface TokenRow {
  token_hash: string;
  kind: 'access' | 'refresh';
  client_id: string;
  user_id: string;
  org_id: string;
  scope: string | null;
  resource: string | null;
  expires_at: number | null;
  revoked_at: number | null;
  created_at: number;
}

function insertToken(kind: 'access' | 'refresh', secret: string, rec: OAuthTokenRecord): void {
  db.prepare(
    `INSERT INTO oauth_tokens (token_hash, kind, client_id, user_id, org_id, scope, resource, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    hash(secret),
    kind,
    rec.clientId,
    rec.userId,
    rec.orgId,
    rec.scope,
    rec.resource,
    rec.expiresAt,
    Date.now()
  );
}

/** Issue an access+refresh pair for a grant. Returns the plaintext secrets once. */
export function issueTokenPair(rec: Omit<OAuthTokenRecord, 'expiresAt'>): {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
} {
  const accessToken = newSecret(ACCESS_PREFIX);
  const refreshToken = newSecret(REFRESH_PREFIX);
  const issue = db.transaction(() => {
    insertToken('access', accessToken, { ...rec, expiresAt: Date.now() + ACCESS_TOKEN_TTL_MS });
    insertToken('refresh', refreshToken, { ...rec, expiresAt: null });
  });
  issue();
  return { accessToken, refreshToken, expiresIn: Math.floor(ACCESS_TOKEN_TTL_MS / 1000) };
}

/** Resolve a presented token of the given kind, or null if unknown/expired/revoked. */
export function verifyOAuthToken(
  secret: string,
  kind: 'access' | 'refresh'
): OAuthTokenRecord | null {
  const row = db.prepare('SELECT * FROM oauth_tokens WHERE token_hash = ? AND kind = ?').get(
    hash(secret),
    kind
  ) as TokenRow | undefined;
  if (!row || row.revoked_at) return null;
  if (row.expires_at !== null && row.expires_at < Date.now()) return null;
  return {
    clientId: row.client_id,
    userId: row.user_id,
    orgId: row.org_id,
    scope: row.scope,
    resource: row.resource,
    expiresAt: row.expires_at,
  };
}

/** Revoke a single token (either kind). Idempotent, and silent on unknown tokens. */
export function revokeOAuthToken(secret: string): void {
  db.prepare('UPDATE oauth_tokens SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL').run(
    Date.now(),
    hash(secret)
  );
}

/** True when the access-token prefix says this is one of ours, so the MCP auth
 *  boundary can route a bearer value to the right verifier without a DB hit. */
export function isOAuthAccessToken(secret: string): boolean {
  return secret.startsWith(ACCESS_PREFIX);
}

/**
 * Drop expired codes and pending authorizations. Both are short-lived and
 * worthless once expired, but nothing else deletes them, so without this the
 * tables grow forever on the single SQLite volume (same unbounded-growth
 * problem as ROADMAP #4's events table).
 */
export function purgeExpiredOAuthRows(): number {
  const now = Date.now();
  const codes = db.prepare('DELETE FROM oauth_codes WHERE expires_at < ?').run(now).changes;
  const pending = db.prepare('DELETE FROM oauth_pending WHERE expires_at < ?').run(now).changes;
  return codes + pending;
}
