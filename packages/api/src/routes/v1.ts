/**
 * `/api/v1` - the versioned, read-only programmatic surface (Door 2, ROADMAP #11).
 *
 * GET-only. Authenticated by a read token (middleware/readAuth), rate-limited
 * (middleware/rateLimit.readApiRateLimiter), and org-scoped: every handler reads
 * `readOrgId(res)` and calls the same org-scoped stores the web app uses, so the
 * API and the dashboard never fork their query semantics. Errors use the shared
 * `{ error: { code, message } }` envelope.
 */

import { Router, type ErrorRequestHandler } from 'express';
import {
  getEvents,
  getEventsPaginated,
  getEventByIdForOrg,
  getDistinctIntegrations,
  type SortField,
  type SortOrder,
} from '../services/eventStore.js';
import {
  getOverallHealth,
  getAllIntegrationHealth,
  getIntegrationHealth,
} from '../services/healthCalculator.js';
import {
  listMonitorsForOrg,
  getMonitorForOrg,
  getMonitorSeries,
} from '../services/monitorStore.js';
import type { ResolutionStatus } from '../types/index.js';
import { requireReadToken, readOrgId, apiError } from '../middleware/readAuth.js';
import { readIpRateLimiter, readTokenRateLimiter } from '../middleware/rateLimit.js';

const router = Router();

// A coarse per-IP ceiling caps anonymous probing before the token check; the
// per-token budget runs after auth (see rateLimit.ts for why it's split).
router.use(readIpRateLimiter);
router.use(requireReadToken);
router.use(readTokenRateLimiter);

const EVENT_STATUSES = ['success', 'failure'] as const;
const RESOLUTION_STATUSES: ResolutionStatus[] = ['open', 'acknowledged', 'resolved'];
const SORT_FIELDS: SortField[] = ['timestamp', 'integration', 'eventType', 'status'];
const SORT_ORDERS: SortOrder[] = ['asc', 'desc'];

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 25;

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

// ---- Health -------------------------------------------------------------

// GET /api/v1/health - overall rollup + per-integration health.
router.get('/health', (req, res) => {
  const orgId = readOrgId(res);
  res.json({ health: getOverallHealth(orgId), integrations: getAllIntegrationHealth(orgId) });
});

// ---- Integrations -------------------------------------------------------

// GET /api/v1/integrations - every integration with its health status.
router.get('/integrations', (req, res) => {
  res.json({ integrations: getAllIntegrationHealth(readOrgId(res)) });
});

// GET /api/v1/integrations/:id - one integration's health + recent events.
// Integrations are discovered from events (no static registry), and health for
// an unseen id would be fabricated 'healthy' zeros - so 404 on an id the org has
// never reported, rather than inventing one.
router.get('/integrations/:id', (req, res) => {
  const orgId = readOrgId(res);
  if (!getDistinctIntegrations(orgId).includes(req.params.id)) {
    return apiError(res, 404, 'not_found', `Integration '${req.params.id}' not found`);
  }
  const integration = getIntegrationHealth(req.params.id, orgId);
  const recentEvents = getEvents({ integration: req.params.id, limit: 20, orgId });
  res.json({ integration, recentEvents });
});

// ---- Events -------------------------------------------------------------

// GET /api/v1/events - paginated, filterable event query. Same filters as the
// dashboard's All Events tab.
router.get('/events', (req, res) => {
  const q = req.query;

  // Express's qs parser turns ?k=a&k=b into an array and ?k[x]=a into an object;
  // either reaching the SQL bind layer throws a 500. Require every filter to be a
  // plain string (or absent) so nothing typed slips past into the query.
  const STRING_PARAMS = [
    'integration', 'search', 'since', 'status', 'resolution_status', 'sort_by', 'sort_order', 'limit', 'offset',
  ] as const;
  for (const name of STRING_PARAMS) {
    if (q[name] !== undefined && typeof q[name] !== 'string') {
      return apiError(res, 400, 'invalid_query', `${name} must be a single value`);
    }
  }

  if (q.status !== undefined && !EVENT_STATUSES.includes(q.status as (typeof EVENT_STATUSES)[number])) {
    return apiError(res, 400, 'invalid_query', `status must be one of: ${EVENT_STATUSES.join(', ')}`);
  }
  if (q.resolution_status !== undefined && !RESOLUTION_STATUSES.includes(q.resolution_status as ResolutionStatus)) {
    return apiError(res, 400, 'invalid_query', `resolution_status must be one of: ${RESOLUTION_STATUSES.join(', ')}`);
  }
  if (q.sort_by !== undefined && !SORT_FIELDS.includes(q.sort_by as SortField)) {
    return apiError(res, 400, 'invalid_query', `sort_by must be one of: ${SORT_FIELDS.join(', ')}`);
  }
  if (q.sort_order !== undefined && !SORT_ORDERS.includes(q.sort_order as SortOrder)) {
    return apiError(res, 400, 'invalid_query', `sort_order must be one of: ${SORT_ORDERS.join(', ')}`);
  }

  let since: Date | undefined;
  if (q.since !== undefined) {
    since = new Date(q.since as string);
    if (Number.isNaN(since.getTime())) {
      return apiError(res, 400, 'invalid_query', 'since must be a valid ISO date');
    }
  }

  const result = getEventsPaginated({
    integration: q.integration as string | undefined,
    status: q.status as 'success' | 'failure' | undefined,
    resolutionStatus: q.resolution_status as ResolutionStatus | undefined,
    limit: clampInt(q.limit, DEFAULT_LIMIT, 1, MAX_LIMIT),
    offset: clampInt(q.offset, 0, 0, Number.MAX_SAFE_INTEGER),
    since,
    sortBy: q.sort_by as SortField | undefined,
    sortOrder: q.sort_order as SortOrder | undefined,
    search: q.search as string | undefined,
    orgId: readOrgId(res),
  });

  res.json(result);
});

// GET /api/v1/events/:id - a single event, scoped to the caller's org.
router.get('/events/:id', (req, res) => {
  const event = getEventByIdForOrg(req.params.id, readOrgId(res));
  if (!event) return apiError(res, 404, 'not_found', 'Event not found');
  res.json({ event });
});

// ---- Monitors -----------------------------------------------------------

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const MAX_BUCKETS = 500;

// GET /api/v1/monitors - the org's saved monitors.
router.get('/monitors', (req, res) => {
  res.json({ monitors: listMonitorsForOrg(readOrgId(res)) });
});

// GET /api/v1/monitors/:id/series - a monitor's matching-event time series.
router.get('/monitors/:id/series', (req, res) => {
  const orgId = readOrgId(res);
  const monitor = getMonitorForOrg(req.params.id, orgId);
  if (!monitor) return apiError(res, 404, 'not_found', 'Monitor not found');

  const windowMs = Math.max(HOUR_MS, Number(req.query.window) || 7 * DAY_MS);
  let bucketMs = Math.max(60_000, Number(req.query.bucket) || HOUR_MS);
  if (windowMs / bucketMs > MAX_BUCKETS) bucketMs = Math.ceil(windowMs / MAX_BUCKETS);

  res.json({
    monitor,
    series: getMonitorSeries(orgId, monitor.matchSpec, windowMs, bucketMs),
    windowMs,
    bucketMs,
  });
});

// Safety net: any unexpected throw becomes the standard envelope, never a stack
// trace or SQL detail leaked to the caller (#12).
const errorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  console.error('v1 error:', err);
  if (res.headersSent) return next(err);
  apiError(res, 500, 'internal', 'Internal error');
};
router.use(errorHandler);

export default router;
