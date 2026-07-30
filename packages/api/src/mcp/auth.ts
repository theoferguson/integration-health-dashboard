/**
 * The SWAPPABLE auth boundary for the MCP server (ROADMAP #11, Phase 1).
 *
 * This is the ONLY file in packages/api/src/mcp that knows how MCP requests are
 * authenticated. Everything downstream - the tool handlers in server.ts and the
 * transport wiring in http.ts - depends only on the resolved
 * `{ orgId, tokenName }` context, never on how it was obtained.
 *
 * Phase 1 (this file): validate the same org-scoped `ihd_read_*` bearer token the
 * `/api/v1` HTTP surface uses (services/readTokenStore.verifyReadToken).
 *
 * Phase 4 replaces the BODY of resolveMcpAuth with OAuth access-token validation
 * (audience-checked per RFC 8707); the tools and transport wiring below never
 * change. Keep the return shape (`McpAuthResult`) and the bearer-parsing contract
 * stable so that swap stays local to this function.
 */

import type { Request } from 'express';
import { verifyReadToken } from '../services/readTokenStore.js';

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
 * Extract the Bearer token exactly as middleware/readAuth does, so the MCP door
 * and the HTTP door parse credentials identically.
 */
function bearerToken(req: Request): string | null {
  const header = req.header('authorization') || '';
  return header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : null;
}

/**
 * Resolve an MCP request to its org context, or a typed failure.
 *
 * Phase 4 swaps the implementation below (read-token lookup) for OAuth
 * access-token validation without changing this signature. NOTE: verifyReadToken
 * does synchronous better-sqlite3 I/O and can throw (SQLITE_BUSY, disk error);
 * callers MUST run this inside a try/catch (see mcp/http.requireMcpAuth) so a DB
 * blip becomes a structured 500, not an unhandled rejection.
 */
export function resolveMcpAuth(req: Request): McpAuthResult {
  const token = bearerToken(req);
  if (!token) {
    return {
      ok: false,
      code: 'unauthorized',
      message: 'Provide a read token via Authorization: Bearer <token>',
    };
  }

  const ctx = verifyReadToken(token);
  if (!ctx) {
    return { ok: false, code: 'invalid_token', message: 'Invalid or revoked read token' };
  }

  return { ok: true, orgId: ctx.orgId, tokenId: ctx.tokenId, tokenName: ctx.name };
}
