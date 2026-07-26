import rateLimit, {
  ipKeyGenerator,
  type RateLimitRequestHandler,
} from 'express-rate-limit';
import type { Request, Response } from 'express';

const WINDOW_MS = 60_000;

/** The bearer-token value if present, else a per-IP bucket (IPv6-safe via ipKeyGenerator). */
function bearerOrIpKey(req: Request): string {
  const auth = req.header('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : '';
  return token || ipKeyGenerator(req.ip ?? 'unknown');
}

function ipKey(req: Request): string {
  return ipKeyGenerator(req.ip ?? 'unknown');
}

interface LimiterOptions {
  limit: number;
  keyGenerator: (req: Request, res: Response) => string;
  message: unknown;
}

function makeLimiter({ limit, keyGenerator, message }: LimiterOptions): RateLimitRequestHandler {
  return rateLimit({
    windowMs: WINDOW_MS,
    limit,
    standardHeaders: 'draft-7', // emit RateLimit-* headers so clients can back off
    legacyHeaders: false,
    keyGenerator,
    message,
  });
}

// --- Ingest -------------------------------------------------------------
// Open signup + an unbounded event store makes /api/ingest abusable: one leaked
// key (or a buggy reporter in a retry loop) can flood the SQLite volume. Cap it,
// keyed by the project API key so each project gets its own budget regardless of
// where it reports from; missing/invalid keys fall to a per-IP bucket.
const INGEST_MAX = Number(process.env.INGEST_RATE_LIMIT_PER_MIN) || 120;

export const ingestRateLimiter = makeLimiter({
  limit: INGEST_MAX,
  keyGenerator: bearerOrIpKey,
  message: { error: 'Too many requests - slow down and retry after the window resets' },
});

// --- Read API (/api/v1) -------------------------------------------------
// Two layers, because a keyGenerator can't tell a real token from junk before
// auth: a single token-keyed limiter would let an attacker rotate bearer values
// for a fresh budget each (the per-IP fallback only fires when NO header is
// sent). So a coarse per-IP ceiling runs BEFORE auth to cap anonymous/invalid
// probing regardless of the bearer value, and a per-token budget runs AFTER auth
// for fair per-token quota. Reads are cheaper and polled more often than ingest
// (agents/MCP), so the default budget is higher.
const READ_MAX = Number(process.env.READ_API_RATE_LIMIT_PER_MIN) || 300;
// Generous multiple so several tokens behind one NAT aren't starved, while a
// single IP still can't send unbounded anonymous traffic.
const READ_IP_CEILING = READ_MAX * 5;

const readLimitMessage = {
  error: { code: 'rate_limited', message: 'Too many requests - retry after the window resets' },
};

/** Pre-auth: caps anonymous/invalid floods per IP, independent of the bearer value. */
export const readIpRateLimiter = makeLimiter({
  limit: READ_IP_CEILING,
  keyGenerator: ipKey,
  message: readLimitMessage,
});

/** Post-auth: per-token budget (requireReadToken stashes the token id on res.locals). */
export const readTokenRateLimiter = makeLimiter({
  limit: READ_MAX,
  keyGenerator: (_req, res) => (res.locals.tokenId as string) ?? 'unknown',
  message: readLimitMessage,
});
