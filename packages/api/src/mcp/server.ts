/**
 * The MCP server factory for the Integration Health Dashboard (ROADMAP #11).
 *
 * `buildMcpServer(ctx)` is a PER-REQUEST factory: every tool handler closes over
 * `ctx.orgId`, so request scoping is achieved by construction rather than by
 * globals or AsyncLocalStorage. With the stateless StreamableHTTP transport
 * (one server per request, see http.ts) there is no shared mutable state between
 * callers, so one org can never observe another's data through this server.
 *
 * Every tool wraps the SAME org-scoped service functions the `/api/v1` HTTP
 * routes call (routes/v1.ts), so query semantics never fork between the two
 * doors. Input vocabularies and bounds come from services/apiContract.ts, the
 * single source of truth - no enum literal is duplicated here.
 */

import { createRequire } from 'module';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import {
  getEvents,
  getEventsPaginated,
  getEventByIdForOrg,
  getDistinctIntegrations,
  type SortField,
  type SortOrder,
} from '../services/eventStore.js';
import {
  summarizeHealth,
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
import {
  EVENT_STATUSES,
  RESOLUTION_STATUSES,
  SORT_FIELDS,
  SORT_ORDERS,
  MAX_LIMIT,
  DEFAULT_LIMIT,
  RECOMMENDED_WORKFLOW,
  clampInt,
  clampSeriesWindow,
} from '../services/apiContract.js';
import type { McpAuthContext } from './auth.js';

// Server version tracks the api package. rootDir is ./src, so package.json can't
// be imported as a module - require it at runtime (resolves the same from dist
// and from tsx dev). Fallback keeps the server buildable if the read ever fails.
function readServerVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    return (require('../../package.json') as { version?: string }).version ?? '0.1.0';
  } catch {
    return '0.1.0';
  }
}
// Resolved once at module load - the version is fixed for the process lifetime,
// so there's no need to re-read it in the per-request buildMcpServer factory.
const SERVER_VERSION = readServerVersion();

/** A zod string-enum built from an apiContract array (no literals duplicated here). */
function enumOf<T extends string>(values: readonly T[]) {
  return z.enum(values as unknown as [T, ...T[]]);
}

/** Serialize a successful result as the single text-content block every tool returns. */
function ok(result: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
}

/**
 * A structured tool error - returned (never thrown) so the client receives a
 * normal tool result with isError:true. `code` mirrors the /api/v1 error codes
 * (not_found, invalid_query) so both doors speak the same vocabulary.
 */
function toolError(code: string, message: string) {
  return {
    isError: true as const,
    content: [{ type: 'text' as const, text: JSON.stringify({ error: { code, message } }) }],
  };
}

const READ_ONLY = { readOnlyHint: true } as const;

// Shared pagination/sort input for the event-listing tools (query_events,
// get_monitor) - same shape and clamping as the /api/v1 events/monitor endpoints.
const PAGINATION_SHAPE = {
  since: z.string().optional().describe('ISO 8601 timestamp; events at or after it.'),
  sort_by: enumOf(SORT_FIELDS).optional().describe('Sort field. Default timestamp.'),
  sort_order: enumOf(SORT_ORDERS).optional().describe('Sort direction. Default desc.'),
  // Coerce (not bare z.number) so an agent that sends a stringified or fractional
  // number gets it clamped by clampInt - matching the /api/v1 door - instead of a
  // hard zod rejection. The JSON schema still advertises `number`.
  limit: z.coerce
    .number()
    .optional()
    .describe(`1-${MAX_LIMIT}, default ${DEFAULT_LIMIT}. Out-of-range values are clamped.`),
  offset: z.coerce.number().optional().describe('Rows to skip. Default 0.'),
};

interface PageOpts {
  limit: number;
  offset: number;
  since?: Date;
  sortBy?: SortField;
  sortOrder?: SortOrder;
}

/** Normalize the shared pagination args, or return a toolError for a bad `since`. */
function parsePagination(args: {
  since?: string;
  sort_by?: string;
  sort_order?: string;
  limit?: number;
  offset?: number;
}): PageOpts | ReturnType<typeof toolError> {
  let since: Date | undefined;
  if (args.since !== undefined) {
    since = new Date(args.since);
    if (Number.isNaN(since.getTime())) {
      return toolError('invalid_query', 'since must be a valid ISO date');
    }
  }
  return {
    limit: clampInt(args.limit, DEFAULT_LIMIT, 1, MAX_LIMIT),
    offset: clampInt(args.offset, 0, 0, Number.MAX_SAFE_INTEGER),
    since,
    sortBy: args.sort_by as SortField | undefined,
    sortOrder: args.sort_order as SortOrder | undefined,
  };
}

/**
 * Build a request-scoped MCP server. All tool handlers close over `ctx.orgId`.
 */
export function buildMcpServer(ctx: McpAuthContext): McpServer {
  const { orgId } = ctx;

  const server = new McpServer(
    { name: 'integration-health-dashboard', version: SERVER_VERSION },
    {
      // Orient the agent with the same recommended workflow the HTTP surface
      // publishes, framed for the tool names exposed here.
      instructions:
        'Read-only access to one organization\'s integration health data. ' +
        'Recommended workflow:\n' +
        RECOMMENDED_WORKFLOW.map((s, i) => `${i + 1}. ${s}`).join('\n') +
        '\n\nTool mapping: get_health = GET /api/v1/health; list_integrations = ' +
        'GET /api/v1/integrations; get_integration = GET /api/v1/integrations/:id; ' +
        'query_events = GET /api/v1/events; get_event = GET /api/v1/events/:id; ' +
        'list_monitors = GET /api/v1/monitors; get_monitor = GET /api/v1/monitors/:id; ' +
        'get_monitor_series = GET /api/v1/monitors/:id/series. All results are scoped ' +
        'to your token\'s organization.',
    }
  );

  // get_health -----------------------------------------------------------
  server.registerTool(
    'get_health',
    {
      description:
        'Whole-org health rollup (counts by healthy/degraded/down) plus every integration with its health. Start here to answer "is anything wrong right now?".',
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => {
      // One health query, reused for both the rollup and the list (getOverallHealth
      // would recompute the same per-integration list a second time).
      const integrations = getAllIntegrationHealth(orgId);
      return ok({ health: summarizeHealth(integrations), integrations });
    }
  );

  // list_integrations ----------------------------------------------------
  server.registerTool(
    'list_integrations',
    {
      description: 'Every integration with its health status, without the org-level rollup.',
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => ok(getAllIntegrationHealth(orgId))
  );

  // get_integration ------------------------------------------------------
  server.registerTool(
    'get_integration',
    {
      description:
        "One integration's health plus its 20 most recent events. Errors not_found on an id this org has never reported (health is derived from events, never fabricated).",
      inputSchema: { id: z.string().describe('Exact integration id, e.g. "stripe".') },
      annotations: READ_ONLY,
    },
    async ({ id }) => {
      if (!getDistinctIntegrations(orgId).includes(id)) {
        return toolError('not_found', `Integration '${id}' not found`);
      }
      return ok({
        integration: getIntegrationHealth(id, orgId),
        recentEvents: getEvents({ integration: id, limit: 20, orgId }),
      });
    }
  );

  // query_events ---------------------------------------------------------
  server.registerTool(
    'query_events',
    {
      description:
        'Paginated, filterable event history. Push filters into the query rather than fetching broadly and narrowing locally.',
      inputSchema: {
        integration: z.string().optional().describe('Exact integration id.'),
        status: enumOf(EVENT_STATUSES).optional().describe('Filter by event status.'),
        resolution_status: enumOf(RESOLUTION_STATUSES)
          .optional()
          .describe('Filter by resolution state.'),
        search: z.string().optional().describe('Free-text match across the event.'),
        ...PAGINATION_SHAPE,
      },
      annotations: READ_ONLY,
    },
    async (args) => {
      const page = parsePagination(args);
      if ('isError' in page) return page;

      return ok(
        getEventsPaginated({
          integration: args.integration,
          status: args.status,
          resolutionStatus: args.resolution_status as ResolutionStatus | undefined,
          search: args.search,
          orgId,
          ...page,
        })
      );
    }
  );

  // get_event ------------------------------------------------------------
  server.registerTool(
    'get_event',
    {
      description: 'A single event by id, scoped to your org.',
      inputSchema: { id: z.string().describe('The event id.') },
      annotations: READ_ONLY,
    },
    async ({ id }) => {
      const event = getEventByIdForOrg(id, orgId);
      if (!event) return toolError('not_found', 'Event not found');
      return ok({ event });
    }
  );

  // list_monitors --------------------------------------------------------
  server.registerTool(
    'list_monitors',
    {
      description:
        'Every saved monitor with its match spec and last-24h activity. See what this org watches, then pull a specific one with get_monitor.',
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => ok({ monitors: listMonitorsForOrg(orgId) })
  );

  // get_monitor ----------------------------------------------------------
  server.registerTool(
    'get_monitor',
    {
      description:
        "A monitor's config plus the events its match spec currently selects (paginated, same event shape as query_events). Errors not_found on an unknown or another org's id.",
      inputSchema: {
        id: z.string().describe('The monitor id.'),
        ...PAGINATION_SHAPE,
      },
      annotations: READ_ONLY,
    },
    async (args) => {
      const monitor = getMonitorForOrg(args.id, orgId);
      if (!monitor) return toolError('not_found', 'Monitor not found');

      const page = parsePagination(args);
      if ('isError' in page) return page;

      const matches = getMonitorMatches(orgId, monitor.matchSpec, page);
      return ok({ monitor, ...matches });
    }
  );

  // get_monitor_series ---------------------------------------------------
  server.registerTool(
    'get_monitor_series',
    {
      description: "A monitor's matching-event time series, bucketed. Errors not_found on an unknown id.",
      inputSchema: {
        id: z.string().describe('The monitor id.'),
        window: z.coerce
          .number()
          .optional()
          .describe('Lookback in ms. Minimum 1 hour, default 7 days.'),
        bucket: z.coerce
          .number()
          .optional()
          .describe('Bucket width in ms. Minimum 1 minute, default 1 hour; widened past 500 buckets.'),
      },
      annotations: READ_ONLY,
    },
    async (args) => {
      const monitor = getMonitorForOrg(args.id, orgId);
      if (!monitor) return toolError('not_found', 'Monitor not found');

      const { windowMs, bucketMs } = clampSeriesWindow(args.window, args.bucket);

      return ok({
        monitor,
        series: getMonitorSeries(orgId, monitor.matchSpec, windowMs, bucketMs),
        windowMs,
        bucketMs,
      });
    }
  );

  return server;
}
