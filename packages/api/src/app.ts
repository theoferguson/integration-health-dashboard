import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import { mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import routes from './routes/index.js';
import oauthRoutes from './routes/oauth.js';
import { ihdOAuthProvider, MCP_SCOPE } from './mcp/oauthProvider.js';
import { renderLlmsTxt } from './services/apiContract.js';
import { resolveBaseUrl, publicBaseUrl } from './services/baseUrl.js';
import { READ_MAX, readIpRateLimiter, readTokenRateLimiter } from './middleware/rateLimit.js';
import {
  mcpOriginGuard,
  requireMcpAuth,
  handleMcpPost,
  mcpMethodNotAllowed,
} from './mcp/http.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createApp() {
  const app = express();

  // Fly terminates TLS at the edge and forwards over plain HTTP; without this,
  // req.protocol always reports 'http', breaking the GitHub OAuth redirect_uri.
  // Trust exactly ONE hop (Fly's edge proxy), not `true`: with `true`, Express
  // takes req.ip from the client-controlled leftmost X-Forwarded-For entry, so
  // the per-IP rate-limit buckets become attacker-spoofable. Fly appends the
  // real client IP as the last XFF entry, so trusting 1 hop reads that and
  // ignores any entries the client forged. (Adjust if Fly ever adds hops.)
  app.set('trust proxy', 1);

  // Middleware
  app.use(cors());
  app.use(express.json());
  app.use(cookieParser());

  // OAuth authorization server for the MCP connectors (ROADMAP #11, Phase 4).
  // MUST be mounted at the app root (the SDK requires it) and BEFORE the
  // static/SPA block, or /.well-known/* and /authorize would fall through to the
  // SPA shell in production. `issuerUrl` and `resourceServerUrl` come from
  // PUBLIC_BASE_URL so the advertised metadata never reflects a client's Host
  // header - a forged issuer would send clients to someone else's token endpoint.
  const baseUrl = new URL(publicBaseUrl());
  app.use(
    mcpAuthRouter({
      provider: ihdOAuthProvider,
      issuerUrl: baseUrl,
      resourceServerUrl: new URL('/mcp', baseUrl),
      resourceName: 'Integration Health Dashboard',
      scopesSupported: [MCP_SCOPE],
      serviceDocumentationUrl: new URL('/llms.txt', baseUrl),
    })
  );
  // The consent screen the provider's authorize() redirects to - our own route,
  // not the SDK's, because only we can read the session cookie.
  app.use('/oauth', oauthRoutes);

  // API routes
  app.use('/api', routes);

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Public agent-discovery doc (llms.txt convention). Unauthenticated - it
  // describes the shape of the API and how to get a token, never any org's data.
  // MUST be registered before the static/SPA block below, or production would
  // match the `app.get('*')` fallback and serve the SPA shell instead.
  app.get('/llms.txt', (req, res) => {
    res.type('text/markdown; charset=utf-8').send(renderLlmsTxt(resolveBaseUrl(req), READ_MAX));
  });

  // Remote MCP server over the /api/v1 read surface (ROADMAP #11, Phase 1). Same
  // reasoning as /llms.txt above: MUST be registered before the static/SPA block,
  // or in production /mcp would fall through to the `app.get('*')` shell. The
  // global express.json() above already parsed req.body, which the transport
  // consumes. The chain mirrors the /api/v1 door and REUSES the same limiter
  // instances, so a read token's budget is shared across both doors (no doubling
  // by hitting both): origin guard -> per-IP ceiling -> auth (sets tokenId) ->
  // per-token budget -> transport. The swappable auth boundary is mcp/auth.ts.
  app.post(
    '/mcp',
    mcpOriginGuard,
    readIpRateLimiter,
    requireMcpAuth,
    readTokenRateLimiter,
    handleMcpPost
  );
  // Non-POST /mcp gets a clean 405 instead of the SPA HTML shell.
  app.all('/mcp', mcpMethodNotAllowed);

  // Serve static frontend in production
  if (process.env.NODE_ENV === 'production') {
    const staticPath = path.join(__dirname, '../../web/dist');
    app.use(express.static(staticPath));

    // SPA fallback
    app.get('*', (req, res) => {
      res.sendFile(path.join(staticPath, 'index.html'));
    });
  }

  return app;
}
