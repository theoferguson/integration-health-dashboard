import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import routes from './routes/index.js';
import { renderLlmsTxt } from './services/apiContract.js';
import { resolveBaseUrl } from './services/baseUrl.js';
import { READ_MAX } from './middleware/rateLimit.js';
import { handleMcpPost } from './mcp/http.js';

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
  // or in production POST /mcp would fall through to the `app.get('*')` shell.
  // The global express.json() above already parsed req.body, which the transport
  // consumes. GET/DELETE to /mcp fall through to the SDK's default 405 semantics
  // via the transport - here we only wire POST. Auth + Origin checks live in the
  // handler (mcp/http.ts); the swappable auth boundary is mcp/auth.ts.
  app.post('/mcp', handleMcpPost);

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
