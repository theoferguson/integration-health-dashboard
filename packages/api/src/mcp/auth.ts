/**
 * The SWAPPABLE auth boundary for the MCP server (ROADMAP #11).
 *
 * This is the ONLY file in packages/api/src/mcp that knows how MCP requests are
 * authenticated. Everything downstream - the tool handlers in server.ts and the
 * transport wiring in http.ts - depends only on the resolved
 * `{ orgId, tokenName }` context, never on how it was obtained.
 *
 * Phase 4 (now): DUAL-ACCEPT. Two credentials resolve to the same context.
 *   - `ihd_mcp_*`  - an OAuth access token from this app's authorization server
 *                    (mcp/oauthProvider.ts), which is what Claude.ai and Claude
 *                    Desktop obtain through browser sign-in.
 *   - `ihd_read_*` - the original org-scoped read token, shared with `/api/v1`.
 *
 * Keeping the read token working is deliberate: Phase 1 told people to run
 * `claude mcp add ... --header "Authorization: Bearer ihd_read_..."`, and those
 * setups must not break when OAuth lands. The two are distinguished by prefix,
 * so neither verifier ever sees the other's credential.
 */

import type { Request } from 'express';
import { verifyReadToken } from '../services/readTokenStore.js';
import { bearerToken } from '../middleware/readAuth.js';
import { verifyOAuthToken, isOAuthAccessToken } from '../services/oauthStore.js';
import { getOAuthClient } from '../services/oauthStore.js';
import { resolveBaseUrl } from '../services/baseUrl.js';

/** What a successfully authenticated MCP request resolves to. Tools scope on `orgId`. */
export interface McpAuthContext {
  orgId: string;
  tokenName: string;
}

/**
 * The outcome of authenticating an MCP request. On success it carries the org
 * context plus the `tokenId` the per-token rate limiter keys on; on failure it
 * carries the distinct code the HTTP door already uses (`unauthorized` for a
 * missing credential, `invalid_token` for a bad/revoked one) so both doors speak
 * the same error vocabulary.
 */
export type McpAuthResult =
  | ({ ok: true; tokenId: string } & McpAuthContext)
  | { ok: false; code: 'unauthorized' | 'invalid_token'; message: string };

/**
 * Resolve an MCP request to its org context, or a typed failure. Credentials are
 * parsed with the same `bearerToken` helper the HTTP door uses (readAuth), so
 * both doors accept a token identically.
 *
 * NOTE: both verifiers do synchronous better-sqlite3 I/O and can throw
 * (SQLITE_BUSY, disk error); callers MUST run this inside a try/catch (see
 * mcp/http.requireMcpAuth) so a DB blip becomes a structured 500, not an
 * unhandled rejection.
 */
export function resolveMcpAuth(req: Request): McpAuthResult {
  const token = bearerToken(req);
  if (!token) {
    return {
      ok: false,
      code: 'unauthorized',
      message: 'Sign in via OAuth, or provide a read token: Authorization: Bearer <token>',
    };
  }

  return isOAuthAccessToken(token) ? resolveOAuth(req, token) : resolveReadToken(token);
}

function resolveReadToken(token: string): McpAuthResult {
  const ctx = verifyReadToken(token);
  if (!ctx) {
    return { ok: false, code: 'invalid_token', message: 'Invalid or revoked read token' };
  }
  return { ok: true, orgId: ctx.orgId, tokenId: ctx.tokenId, tokenName: ctx.name };
}

function resolveOAuth(req: Request, token: string): McpAuthResult {
  const record = verifyOAuthToken(token, 'access');
  if (!record) {
    return { ok: false, code: 'invalid_token', message: 'Invalid or expired access token' };
  }

  // RFC 8707 audience check: a token minted for a different resource must not be
  // replayable here. Only enforced when the token actually carries an audience -
  // clients that omit `resource` get a token with none, and rejecting those would
  // break every client that doesn't implement the extension.
  if (record.resource && !matchesThisServer(req, record.resource)) {
    return {
      ok: false,
      code: 'invalid_token',
      message: 'Access token was issued for a different resource',
    };
  }

  return {
    ok: true,
    orgId: record.orgId,
    // Rate-limit bucket. Per (client, user) rather than per access token, so
    // rotating a token doesn't hand the caller a fresh budget.
    tokenId: `oauth:${record.clientId}:${record.userId}`,
    tokenName: getOAuthClient(record.clientId)?.client_name || 'OAuth client',
  };
}

/** Does a token's RFC 8707 audience name this MCP endpoint? */
function matchesThisServer(req: Request, resource: string): boolean {
  const canonical = (value: string) => {
    try {
      const url = new URL(value);
      url.hash = '';
      return url.href.replace(/\/$/, '');
    } catch {
      return value;
    }
  };
  return canonical(resource) === canonical(`${resolveBaseUrl(req)}/mcp`);
}
