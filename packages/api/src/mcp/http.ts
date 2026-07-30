/**
 * The `POST /mcp` transport endpoint (ROADMAP #11, Phase 1).
 *
 * Wires the Streamable HTTP MCP transport to Express. This file owns only
 * transport concerns - Origin/DNS-rebinding defense, the 401 gate, and one
 * stateless transport+server per request. Authentication is delegated wholly to
 * mcp/auth.resolveMcpAuth (the swappable boundary), and the tools live in
 * mcp/server.buildMcpServer. Neither changes when Phase 4 adds OAuth.
 */

import type { Request, Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { resolveMcpAuth } from './auth.js';
import { buildMcpServer } from './server.js';

/**
 * Hosts allowed in the Origin header. The public origin (never a client-supplied
 * Host - resolveBaseUrl's PUBLIC_BASE_URL is the trust anchor) plus loopback for
 * local dev and the Inspector. A request with any other Origin is rejected 403
 * to prevent DNS-rebinding attacks (a MUST in the MCP transport security spec).
 */
function allowedOriginHosts(): Set<string> {
  const hosts = new Set<string>(['localhost', '127.0.0.1', '[::1]']);
  const configured = process.env.PUBLIC_BASE_URL?.trim();
  if (configured) {
    try {
      hosts.add(new URL(configured).host);
    } catch {
      // Malformed PUBLIC_BASE_URL - fall through with just loopback allowed.
    }
  }
  return hosts;
}

/**
 * True if the Origin header (when present) names an allowed host. A missing
 * Origin (non-browser clients: Claude Code, curl, the Inspector CLI) is allowed -
 * DNS rebinding is a browser-only threat, so there is nothing to defend against.
 */
function originAllowed(req: Request): boolean {
  const origin = req.header('origin');
  if (!origin) return true;
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return false; // Unparseable Origin - reject.
  }
  return allowedOriginHosts().has(host);
}

/**
 * Express handler for POST /mcp.
 *
 * NOTE (Phase 1 scope): Claude.ai / Claude Desktop one-click connectors do not
 * accept a user-pasted bearer token, so this read-token server targets Claude
 * Code (`claude mcp add --transport http ... --header "Authorization: Bearer ..."`),
 * the MCP Inspector, and other header-capable hosts. Phase 4 adds OAuth so the
 * one-click connectors can sign in via the browser.
 */
export async function handleMcpPost(req: Request, res: Response): Promise<void> {
  // 1. DNS-rebinding defense: validate Origin before doing any work.
  if (!originAllowed(req)) {
    res.status(403).json({ error: { code: 'forbidden', message: 'Origin not allowed' } });
    return;
  }

  // 2. Auth gate (the swappable boundary).
  const ctx = resolveMcpAuth(req);
  if (!ctx) {
    res
      .status(401)
      .set('WWW-Authenticate', 'Bearer')
      .json({ error: { code: 'unauthorized', message: 'Provide a read token via Authorization: Bearer <token>' } });
    return;
  }

  // 3. One stateless transport + server per request. No session id (stateless
  // mode), so nothing is shared between callers; the server closes over ctx.orgId
  // for request scoping. The SDK transport negotiates MCP-Protocol-Version.
  //
  // Guard the whole transport dance: this is an async Express handler, and
  // Express 4 does NOT catch rejected promises - an unhandled throw here (from
  // buildMcpServer/connect, or before the transport has written) would leave the
  // socket hanging with no response. Match the house rule (structured errors,
  // never a leaked stack): reply 500 { error } if nothing has been sent yet.
  try {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      void transport.close();
    });

    const server = buildMcpServer(ctx);
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error('[mcp] request failed:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: { code: 'internal', message: 'Internal error' } });
    }
  }
}
