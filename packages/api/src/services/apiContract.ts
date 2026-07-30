/**
 * The single description of the `/api/v1` read contract (Door 2, ROADMAP #11).
 *
 * Two consumers render this: the authenticated capability document at
 * `GET /api/v1`, and the public `GET /llms.txt` orientation doc. v1.ts also
 * validates incoming queries against the same enums and bounds declared here -
 * so the documented contract and the enforced one are the same values, and a
 * new filter can't ship documented-but-unvalidated (or the reverse).
 *
 * Nothing here is org-specific. Caller-scoped facts (org id, the integration
 * ids that org has actually reported) are assembled per-request in v1.ts.
 */

import type { ResolutionStatus, ErrorSeverity } from '../types/index.js';

// ---- Enums + bounds (imported by v1.ts for validation) ------------------

/** Values `?status=` accepts. Events themselves may also carry 'pending'; it isn't filterable. */
export const EVENT_STATUSES = ['success', 'failure'] as const;
export const RESOLUTION_STATUSES: ResolutionStatus[] = ['open', 'acknowledged', 'resolved'];
export const SORT_FIELDS = ['timestamp', 'integration', 'eventType', 'status'] as const;
export const SORT_ORDERS = ['asc', 'desc'] as const;

/** AI-derived error buckets on `event.classification.category`. */
export const ERROR_CATEGORIES = [
  'auth',
  'rate_limit',
  'data_validation',
  'data_state_mismatch',
  'network',
  'spending_control',
  'unknown',
] as const;

export const HEALTH_STATUSES = ['healthy', 'degraded', 'down'] as const;
/**
 * Severity levels on `event.classification.severity`. Also the values the ingest
 * path validates against - ingest.ts imports this, so the write validation and
 * the read documentation can't drift. `satisfies` pins them to ErrorSeverity.
 */
export const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const satisfies readonly ErrorSeverity[];

export const MAX_LIMIT = 100;
export const DEFAULT_LIMIT = 25;

/**
 * Agents that poll at UI cadence burn their rate budget for no benefit: health
 * rollups recompute from the same 24h windows and rarely move minute to minute.
 * Advisory only - nothing enforces it beyond the per-minute limiter.
 */
export const SUGGESTED_MIN_POLL_SECONDS = 30;

// ---- Endpoint reference -------------------------------------------------

export interface EndpointDoc {
  method: 'GET';
  path: string;
  summary: string;
  /** Query parameters, as `name` -> human description. */
  query?: Record<string, string>;
}

export const V1_ENDPOINTS: EndpointDoc[] = [
  {
    method: 'GET',
    path: '/api/v1',
    summary:
      'This document: your token scope, the live filter vocabulary, limits, and boundaries. Start here.',
  },
  {
    method: 'GET',
    path: '/api/v1/health',
    summary:
      'Whole-org rollup (counts by healthy/degraded/down) plus every integration with its health. One call answers "is anything wrong right now?".',
  },
  {
    method: 'GET',
    path: '/api/v1/integrations',
    summary: 'Every integration with its health status, without the org-level rollup.',
  },
  {
    method: 'GET',
    path: '/api/v1/integrations/:id',
    summary:
      "One integration's health plus its 20 most recent events. 404s on an id this org has never reported.",
  },
  {
    method: 'GET',
    path: '/api/v1/events',
    summary: 'Paginated, filterable event history. Filter server-side rather than fetching and narrowing locally.',
    query: {
      integration: 'Exact integration id.',
      status: `One of: ${EVENT_STATUSES.join(', ')}.`,
      resolution_status: `One of: ${RESOLUTION_STATUSES.join(', ')}.`,
      since: 'ISO 8601 timestamp; events at or after it.',
      search: 'Free-text match across the event.',
      sort_by: `One of: ${SORT_FIELDS.join(', ')}. Default timestamp.`,
      sort_order: `One of: ${SORT_ORDERS.join(', ')}. Default desc.`,
      limit: `1-${MAX_LIMIT}, default ${DEFAULT_LIMIT}. Out-of-range values are clamped, not rejected.`,
      offset: 'Rows to skip. Default 0.',
    },
  },
  {
    method: 'GET',
    path: '/api/v1/events/:id',
    summary: 'A single event by id, scoped to your org.',
  },
  {
    method: 'GET',
    path: '/api/v1/monitors',
    summary: "The org's saved monitors (named match specs over the event stream).",
  },
  {
    method: 'GET',
    path: '/api/v1/monitors/:id/series',
    summary: "A monitor's matching-event time series, bucketed.",
    query: {
      window: 'Lookback in ms. Minimum 1 hour, default 7 days.',
      bucket: 'Bucket width in ms. Minimum 1 minute, default 1 hour; widened automatically past 500 buckets.',
    },
  },
];

// ---- Boundaries (advisory) ----------------------------------------------

/**
 * What this surface will and won't do. Read-only, org scoping, and the limit
 * clamp are enforced in code (readAuth, the org-scoped stores, clampInt); the
 * polling and payload-handling lines are guidance an agent should follow but
 * nothing rejects a caller for ignoring them.
 */
export function boundaries(readRateLimitPerMin: number): string[] {
  return [
    'Read-only. Every v1 endpoint is a GET and a read token grants nothing else - there is no v1 write, delete, or acknowledge path. Reporting events is a separate front door (POST /api/ingest) with a separate project api_key.',
    'Single-org scope. Your token resolves to exactly one organization and every response is filtered to it. Ids from another org 404 rather than 403, so they cannot be probed.',
    `Rate limit: ${readRateLimitPerMin} requests per minute per token, with a coarser per-IP ceiling in front of auth. Every response carries RateLimit-* headers (IETF draft-7) - read them and self-throttle. A 429 returns { error: { code: "rate_limited" } }; back off, do not retry tightly.`,
    `Page size is capped at ${MAX_LIMIT}. A larger limit is silently clamped, so do not infer you received everything from the absence of an error - check the pagination fields.`,
    'Unknown query parameters are ignored, not rejected - so probing filters is cheap and never costs you a 400. But an ignored filter returns an unfiltered result that looks filtered, so a response may include a `warnings` array naming any parameters that were dropped. Treat a warning as a signal your filter did not apply, and check vocabulary.filters for the correct name.',
    `Polling: prefer ${SUGGESTED_MIN_POLL_SECONDS}s or slower. Health is computed over 24h windows and rarely changes faster than that.`,
    'Event payloads are supplied by the reporting application and are not guaranteed to be scrubbed of personal or sensitive data. Redaction is the reporter\'s responsibility via the SDK beforeSend hook. Treat payload contents as confidential to the org; do not echo them into external systems.',
    'Errors always use { error: { code, message } }. Codes: unauthorized, invalid_token, invalid_query, not_found, rate_limited, internal.',
  ];
}

/** Ordered, concrete workflow - the cheap path to an answer rather than paging everything. */
export const RECOMMENDED_WORKFLOW: string[] = [
  'Call GET /api/v1/health first. It answers "is anything degraded?" for the whole org in one request; do not enumerate integrations to find out.',
  'For anything unhealthy, call GET /api/v1/integrations/:id. It returns that integration\'s health and its 20 most recent events together, which is usually enough to explain the problem without touching /events.',
  'Only page GET /api/v1/events when you need history beyond those 20 or a cross-integration view. Push filters into the query (integration, status, since) instead of fetching broadly and narrowing client-side.',
  'Failure events carry a server-side AI classification: classification.category, .severity, .cause, and .suggestedFix. Use it rather than re-deriving a root cause from raw payloads - it is already computed and costs you nothing.',
  'Events also carry optional dimensions from the reporter: metrics (numeric, for trends), tags (labels), environment, and source. These vary by integration; read the vocabulary block in GET /api/v1 for what this org actually emits.',
];

// ---- llms.txt rendering -------------------------------------------------

/**
 * The public orientation doc at `/llms.txt`, per the llms.txt convention: H1,
 * a blockquote summary, then sections. Unauthenticated, so it describes the
 * shape of the API and how to get a token - never any org's data.
 */
export function renderLlmsTxt(baseUrl: string, readRateLimitPerMin: number): string {
  const endpointLines = V1_ENDPOINTS.map((e) => {
    const params = e.query
      ? Object.entries(e.query)
          .map(([name, desc]) => `  - \`${name}\` - ${desc}`)
          .join('\n')
      : '';
    return `- \`${e.method} ${e.path}\` - ${e.summary}${params ? `\n${params}` : ''}`;
  }).join('\n');

  return `# Integration Health Dashboard (IHD)

> IHD collects health events from third-party integrations, classifies failures with AI, and exposes both a monitoring UI for non-technical users and a read-only HTTP API for agents. This file describes the API. Base URL: ${baseUrl}

The unit of data is an **event**: one integration (\`weather\`, \`stripe\`, ...) reported one occurrence (\`forecast.sync\`) that succeeded or failed, with an optional payload, error, and reporter-supplied metrics and tags. Integrations are discovered from the events themselves - there is no static registry, so the set of integration ids differs per organization. Health is derived per integration from success rate and error count over a rolling 24h window and reduces to \`healthy\`, \`degraded\`, or \`down\`.

## Authentication

Every \`/api/v1\` request needs an org-scoped read token:

\`\`\`
Authorization: Bearer ihd_read_...
\`\`\`

Tokens are minted by an organization admin (\`POST /api/read-tokens\`, or the \`create-read-token\` CLI) and shown once. They are read-only and distinct from both the browser session and a project's ingest key. If you are an agent without a token, ask the person you are working for to mint one - there is no self-service or anonymous access.

## Start here

\`\`\`
curl ${baseUrl}/api/v1 -H "Authorization: Bearer $IHD_READ_TOKEN"
\`\`\`

\`GET /api/v1\` returns a capability document scoped to your token: your org, the integration ids that org has actually reported, every legal filter value, the current limits, and the boundaries below. Read it before constructing other calls - it saves guessing at filter values that would 400.

## Endpoints

All are GET, all return JSON, all are scoped to your token's organization.

${endpointLines}

## Using it efficiently

${RECOMMENDED_WORKFLOW.map((s, i) => `${i + 1}. ${s}`).join('\n')}

## Boundaries

${boundaries(readRateLimitPerMin)
  .map((b) => `- ${b}`)
  .join('\n')}

## Beyond the API

- Reporting events into IHD is a separate write path: \`POST /api/ingest\` with a project api_key, or the \`@theof/ihd-sdk\` npm package.
- An MCP server over this read API is planned, which will expose these endpoints as tools directly.
`;
}
