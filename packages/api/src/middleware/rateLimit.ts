import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

// Open signup + an unbounded event store makes /api/ingest abusable: one leaked
// key (or a buggy reporter in a retry loop) can flood the SQLite volume. Cap it.
//
// Keyed by the project API key, not the IP - ingest is authenticated, so each
// project gets its own budget regardless of where it reports from (shared NATs,
// serverless, CI). Missing/invalid keys fall back to a per-IP bucket, which also
// caps anonymous floods and slows key-guessing before the 401.
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = Number(process.env.INGEST_RATE_LIMIT_PER_MIN) || 120;

export const ingestRateLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: MAX_PER_WINDOW,
  standardHeaders: 'draft-7', // emit RateLimit-* headers so clients can back off
  legacyHeaders: false,
  keyGenerator: (req) => {
    const auth = req.header('authorization') || '';
    const apiKey = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : '';
    return apiKey || ipKeyGenerator(req.ip ?? 'unknown');
  },
  message: { error: 'Too many requests - slow down and retry after the window resets' },
});
