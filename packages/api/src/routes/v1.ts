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
  getMonitorMatches,
  getMonitorSeries,
} from '../services/monitorStore.js';
import type { ResolutionStatus } from '../types/index.js';
import { requireReadToken, readOrgId, readTokenName, apiError } from '../middleware/readAuth.js';
import { readIpRateLimiter, readTokenRateLimiter, READ_MAX } from '../middleware/rateLimit.js';
// The single source of truth for the v1 contract. These enums/bounds are both
// validated against here and documented (by GET / and llms.txt) - so a filter
// can't ship documented-but-unvalidated, or validated-but-undocumented.
import {
  EVENT_STATUSES,
  RESOLUTION_STATUSES,
  SORT_FIELDS,
  SORT_ORDERS,
  ERROR_CATEGORIES,
  HEALTH_STATUSES,
  SEVERITIES,
  MAX_LIMIT,
  DEFAULT_LIMIT,
  V1_ENDPOINTS,
  boundaries,
  RECOMMENDED_WORKFLOW,
} from '../services/apiContract.js';
import { resolveBaseUrl } from '../services/baseUrl.js';

const router = Router();

// A coarse per-IP ceiling caps anonymous probing before the token check; the
// per-token budget runs after auth (see rateLimit.ts for why it's split).
router.use(readIpRateLimiter);
router.use(requireReadToken);
router.use(readTokenRateLimiter);

// ---- Capability document ------------------------------------------------

// GET /api/v1 - the token-scoped capability document: who the caller is, the
// live filter vocabulary for THIS org (integration ids are pulled from the
// org's own events, so filters are real rather than guessed), the limits, and
// the advisory boundaries. Sits after the auth middleware, so it's scoped.
router.get('/', (req, res) => {
  const orgId = readOrgId(res);
  res.json({
    service: 'Integration Health Dashboard',
    apiVersion: 'v1',
    docs: `${resolveBaseUrl(req)}/llms.txt`,
    you: {
      orgId,
      tokenName: readTokenName(res),
      access: 'read-only',
      scope: 'single org',
    },
    endpoints: V1_ENDPOINTS,
    vocabulary: {
      // Legal values for the GET /api/v1/events filters, keyed by the EXACT
      // query-param name (snake_case) so an agent can copy a key straight into
      // a query string. `integration` is the org's own live set.
      filters: {
        integration: getDistinctIntegrations(orgId),
        status: EVENT_STATUSES,
        resolution_status: RESOLUTION_STATUSES,
        sort_by: SORT_FIELDS,
        sort_order: SORT_ORDERS,
      },
      // Enums that appear in RESPONSES (health, classification), not filters -
      // separated so an agent doesn't try ?health= or ?category= and have it
      // silently ignored. These are for interpreting results.
      responseValues: {
        healthStatus: HEALTH_STATUSES,
        errorCategory: ERROR_CATEGORIES,
        severity: SEVERITIES,
      },
    },
    limits: {
      maxLimit: MAX_LIMIT,
      defaultLimit: DEFAULT_LIMIT,
      rateLimit: { perTokenPerMinute: READ_MAX, headers: 'RateLimit-*' },
    },
    boundaries: boundaries(READ_MAX),
    gettingStarted: RECOMMENDED_WORKFLOW,
  });
});

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

/**
 * Advisory (non-fatal) notice naming any query params not in `recognized`.
 * Unknown params are ignored, not rejected - so discovery stays cheap - but a
 * guessed/typo'd filter would otherwise return an unfiltered set that looks
 * filtered, so we surface it and point back at the discovery doc. Returns
 * undefined when everything is recognized, so the key is simply omitted.
 */
function unknownParamWarnings(
  q: Record<string, unknown>,
  recognized: readonly string[]
): string[] | undefined {
  const unknown = Object.keys(q).filter((k) => !recognized.includes(k));
  if (unknown.length === 0) return undefined;
  return [
    `Ignored unrecognized query parameter(s): ${unknown.join(', ')}. Valid filters are listed at GET /api/v1 under vocabulary.filters.`,
  ];
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

  // STRING_PARAMS is the recognized set, so the advisory can't drift from what's
  // actually honored.
  const warnings = unknownParamWarnings(q, STRING_PARAMS);
  res.json(warnings ? { ...result, warnings } : result);
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

// GET /api/v1/monitors/:id - the monitor's config + the events its match spec
// currently selects (paginated, org-scoped). "View this monitor" = see what it's
// actually catching, without re-implementing its filter. The filter IS the
// monitor's spec, so this endpoint takes only pagination/sort params; any extra
// query param is ignored and reported via `warnings` (same as /events).
router.get('/monitors/:id', (req, res) => {
  const orgId = readOrgId(res);
  const monitor = getMonitorForOrg(req.params.id, orgId);
  // Same 404 (not 403) for an unknown id and another org's id, so ownership
  // can't be probed by id.
  if (!monitor) return apiError(res, 404, 'not_found', 'Monitor not found');

  const q = req.query;
  const RECOGNIZED = ['since', 'sort_by', 'sort_order', 'limit', 'offset'] as const;
  for (const name of RECOGNIZED) {
    if (q[name] !== undefined && typeof q[name] !== 'string') {
      return apiError(res, 400, 'invalid_query', `${name} must be a single value`);
    }
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

  const matches = getMonitorMatches(orgId, monitor.matchSpec, {
    limit: clampInt(q.limit, DEFAULT_LIMIT, 1, MAX_LIMIT),
    offset: clampInt(q.offset, 0, 0, Number.MAX_SAFE_INTEGER),
    since,
    sortBy: q.sort_by as SortField | undefined,
    sortOrder: q.sort_order as SortOrder | undefined,
  });

  const warnings = unknownParamWarnings(q, RECOGNIZED);
  res.json(warnings ? { monitor, ...matches, warnings } : { monitor, ...matches });
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
