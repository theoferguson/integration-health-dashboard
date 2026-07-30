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
 * change. Keep the return shape (`McpAuthContext | null`) and the bearer-parsing
 * contract stable so that swap stays local to this function.
 */

import type { Request } from 'express';
import { verifyReadToken } from '../services/readTokenStore.js';

/** What a successfully authenticated MCP request resolves to. Tools scope on `orgId`. */
export interface McpAuthContext {
  orgId: string;
  tokenName: string;
}

/**
 * Extract the Bearer token exactly as middleware/readAuth does, so the MCP door
 * and the HTTP door parse credentials identically.
 */
function bearerToken(req: Request): string | null {
  const header = req.header('authorization') || '';
  return header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : null;
}

/**
 * Resolve an MCP request to its org context, or null if unauthenticated.
 *
 * Phase 4 swaps the implementation below (read-token lookup) for OAuth
 * access-token validation without changing this signature.
 */
export function resolveMcpAuth(req: Request): McpAuthContext | null {
  const token = bearerToken(req);
  if (!token) return null;

  const ctx = verifyReadToken(token);
  if (!ctx) return null;

  return { orgId: ctx.orgId, tokenName: ctx.name };
}
