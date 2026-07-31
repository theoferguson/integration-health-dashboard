/**
 * The `POST /mcp` transport endpoint (ROADMAP #11, Phase 1).
 *
 * Wires the Streamable HTTP MCP transport to Express as a middleware chain that
 * mirrors the /api/v1 door (origin guard -> per-IP limiter -> auth -> per-token
 * limiter -> handler), so the MCP door and the HTTP door share the same rate
 * budgets and error vocabulary over the same org-scoped data. Authentication is
 * delegated wholly to mcp/auth.resolveMcpAuth (the swappable boundary); the tools
 * live in mcp/server.buildMcpServer. Neither changes when Phase 4 adds OAuth.
 */

import type { Request, Response, NextFunction } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { resolveMcpAuth } from './auth.js';
import { buildMcpServer } from './server.js';

// Loopback hosts always allowed (local dev + the MCP Inspector, on any port).
const LOOPBACK_HOSTS = new Set<string>(['localhost', '127.0.0.1', '[::1]']);

/**
 * True if the Origin header (when present) names an allowed host: loopback, or
 * the configured public origin. PUBLIC_BASE_URL is read fresh (a cheap parse,
 * only when the origin isn't loopback) rather than cached, so there's no
 * first-request-freeze or test-ordering hazard. Compared against the Origin's
 * HOSTNAME (not host) so a loopback client on any port matches.
 *
 * A missing Origin (non-browser clients: Claude Code, curl, the Inspector CLI)
 * is allowed - DNS rebinding is a browser-only threat, nothing to defend against.
 */
function originAllowed(req: Request): boolean {
  const origin = req.header('origin');
  if (!origin) return true;
  let hostname: string;
  try {
    hostname = new URL(origin).hostname; // hostname excludes the port
  } catch {
    return false; // Unparseable Origin - reject.
  }
  if (LOOPBACK_HOSTS.has(hostname)) return true;

  const configured = process.env.PUBLIC_BASE_URL?.trim();
  if (!configured) return false;
  try {
    return new URL(configured).hostname === hostname;
  } catch {
    return false; // Malformed PUBLIC_BASE_URL - only loopback is allowed.
  }
}

/**
 * DNS-rebinding defense: reject a disallowed Origin before any work (a MUST in
 * the MCP transport security spec). Runs first in the chain.
 */
export function mcpOriginGuard(req: Request, res: Response, next: NextFunction): void {
  if (!originAllowed(req)) {
    res.status(403).json({ error: { code: 'forbidden', message: 'Origin not allowed' } });
    return;
  }
  next();
}

/**
 * The auth gate (the swappable boundary). Distinguishes a missing credential
 * (`unauthorized`) from a bad/revoked one (`invalid_token`), matching the HTTP
 * door. resolveMcpAuth does synchronous DB I/O that can throw, and this is an
 * Express handler on a route outside the /api errorHandler, so we catch here and
 * emit a structured 500 rather than leak a stack or hang the socket. On success
 * it stashes org + token id on res.locals for the per-token limiter and handler.
 *
 * NOTE (Phase 1 scope): Claude.ai / Claude Desktop one-click connectors do not
 * accept a user-pasted bearer token, so this read-token server targets Claude
 * Code (`claude mcp add --transport http ... --header "Authorization: Bearer ..."`),
 * the MCP Inspector, and other header-capable hosts. Phase 4 adds OAuth so the
 * one-click connectors can sign in via the browser.
 */
export function requireMcpAuth(req: Request, res: Response, next: NextFunction): void {
  let result: ReturnType<typeof resolveMcpAuth>;
  try {
    result = resolveMcpAuth(req);
  } catch (err) {
    console.error('[mcp] auth error:', err);
    res.status(500).json({ error: { code: 'internal', message: 'Internal error' } });
    return;
  }

  if (!result.ok) {
    res
      .status(401)
      .set('WWW-Authenticate', 'Bearer')
      .json({ error: { code: result.code, message: result.message } });
    return;
  }

  res.locals.orgId = result.orgId;
  res.locals.tokenId = result.tokenId; // the per-token rate limiter keys on this
  res.locals.tokenName = result.tokenName;
  next();
}

/**
 * The transport handler. Runs last, after the chain has validated the Origin,
 * the per-IP ceiling, the token, and the per-token budget. One stateless
 * transport + server per request (no session id), so nothing is shared between
 * callers; the server closes over res.locals.orgId for request scoping.
 */
export async function handleMcpPost(req: Request, res: Response): Promise<void> {
  const ctx = { orgId: res.locals.orgId as string, tokenName: res.locals.tokenName as string };

  // Guard the whole transport dance: this is an async Express handler and
  // Express 4 does NOT catch rejected promises, so an unhandled throw would leave
  // the socket hanging. Reply 500 { error } if nothing has been sent yet.
  let closed = false;
  try {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    const server = buildMcpServer(ctx);
    // Release both per-request objects when the socket closes (the SDK's
    // canonical stateless pattern tears down server and transport together).
    // The `closed` flag lets the catch below avoid writing to a socket the
    // client already aborted.
    res.on('close', () => {
      closed = true;
      void transport.close();
      void server.close();
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error('[mcp] request failed:', err);
    if (!closed && !res.headersSent) {
      res.status(500).json({ error: { code: 'internal', message: 'Internal error' } });
    }
  }
}

/**
 * Non-POST methods on /mcp. The stateless transport only uses POST; without this
 * a GET /mcp would fall through to the production SPA fallback and return the
 * HTML shell instead of a clean 405.
 */
export function mcpMethodNotAllowed(_req: Request, res: Response): void {
  res
    .status(405)
    .set('Allow', 'POST')
    .json({ error: { code: 'method_not_allowed', message: 'Use POST for MCP requests' } });
}
