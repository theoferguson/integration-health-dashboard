import type { Request } from 'express';

/**
 * The canonical public origin (no trailing slash) for absolute URLs the API
 * hands out.
 *
 * The agent-discovery docs (llms.txt, the /api/v1 capability doc) tell an agent
 * where to send its bearer token, so they must not echo a client-controlled
 * Host header - a request with `Host: evil.example` would otherwise produce a
 * doc pointing credentials at the attacker. Prefer an explicit PUBLIC_BASE_URL
 * (set it in prod), and fall back to the request origin only for local dev,
 * where no env is set and there is no trust boundary to cross.
 */
export function resolveBaseUrl(req: Request): string {
  const configured = process.env.PUBLIC_BASE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, '');
  return `${req.protocol}://${req.get('host')}`;
}
