/**
 * Event Store
 * SQLite-backed storage for integration events
 */

import { uuidv7 } from './uuidv7.js';
import { db } from '../db/connection.js';
import {
  EVENT_STORE,
  type IntegrationEvent,
  type CreateEventInput,
  type ResolutionStatus,
  type Resolution,
} from '../types/index.js';

export type SortField = 'timestamp' | 'integration' | 'eventType' | 'status';
export type SortOrder = 'asc' | 'desc';

export interface GetEventsOptions {
  integration?: string;
  status?: 'success' | 'failure';
  resolutionStatus?: ResolutionStatus;
  limit?: number;
  offset?: number;
  since?: Date;
  sortBy?: SortField;
  sortOrder?: SortOrder;
  search?: string;
  /** Scope results to events belonging to this org's projects. */
  orgId?: string;
  /**
   * A pre-built WHERE fragment AND-ed into the query - produced by
   * monitorMatch.buildMatchClause to select the events a monitor's spec matches.
   * Internal/trusted: the only producer binds every value as a bound parameter,
   * so it is injection-safe. Not exposed as a raw query param.
   */
  match?: { clause: string; params: unknown[] };
}

export interface PaginatedEvents {
  events: IntegrationEvent[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

export interface EventStats {
  eventsLast24h: number;
  errorsLast24h: number;
  /**
   * Percent successful over the last 24h, or null when nothing reported in that
   * window. Null rather than 100: an integration that has gone silent has no
   * success rate, and defaulting it to a perfect score made a dead integration
   * indistinguishable from a flawless one.
   */
  successRate: number | null;
  /** Most recent event ever, NOT just within the 24h window. */
  lastSync: Date | string | null;
  /**
   * How long this integration normally goes between events (the longest gap in
   * its recent history), or null when there aren't enough events to tell.
   * Silence is judged against this rather than a fixed window - a 2-minute
   * poller and a weekly report go quiet on very different timescales.
   */
  expectedIntervalMs: number | null;
}

interface EventRow {
  id: string;
  project_id: string | null;
  integration: string;
  event_type: string;
  status: string;
  timestamp: number;
  payload: string;
  error: string | null;
  classification: string | null;
  resolution: string | null;
  metrics: string | null;
  tags: string | null;
  environment: string | null;
  severity: string | null;
  source: string | null;
}

function rowToEvent(row: EventRow): IntegrationEvent {
  return {
    id: row.id,
    integration: row.integration,
    eventType: row.event_type,
    status: row.status as IntegrationEvent['status'],
    timestamp: new Date(row.timestamp),
    payload: JSON.parse(row.payload),
    error: row.error ? JSON.parse(row.error) : undefined,
    classification: row.classification ? JSON.parse(row.classification) : undefined,
    resolution: row.resolution ? JSON.parse(row.resolution) : undefined,
    metrics: row.metrics ? JSON.parse(row.metrics) : undefined,
    tags: row.tags ? JSON.parse(row.tags) : undefined,
    environment: row.environment ?? undefined,
    severity: (row.severity as IntegrationEvent['severity']) ?? undefined,
    source: row.source ?? undefined,
  };
}

// Column to sort by, whitelisted (never interpolate user input into SQL identifiers)
const SORT_COLUMNS: Record<SortField, string> = {
  timestamp: 'timestamp',
  integration: 'integration',
  eventType: 'event_type',
  status: 'status',
};

/**
 * Build a WHERE clause + params shared by the paginated query and its count query
 */
function buildWhere(options?: GetEventsOptions): { clause: string; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options?.orgId) {
    conditions.push('project_id IN (SELECT id FROM projects WHERE org_id = ?)');
    params.push(options.orgId);
  }
  if (options?.integration) {
    conditions.push('integration = ?');
    params.push(options.integration);
  }
  if (options?.status) {
    conditions.push('status = ?');
    params.push(options.status);
  }
  if (options?.resolutionStatus) {
    conditions.push("COALESCE(json_extract(resolution, '$.status'), 'open') = ?");
    params.push(options.resolutionStatus);
  }
  if (options?.since) {
    conditions.push('timestamp >= ?');
    params.push(options.since.getTime());
  }
  if (options?.search) {
    const term = `%${options.search.toLowerCase()}%`;
    conditions.push(
      `(LOWER(event_type) LIKE ? OR LOWER(integration) LIKE ? OR LOWER(json_extract(error, '$.message')) LIKE ? OR LOWER(json_extract(error, '$.code')) LIKE ?)`
    );
    params.push(term, term, term, term);
  }
  if (options?.match) {
    conditions.push(`(${options.match.clause})`);
    params.push(...options.match.params);
  }

  return {
    clause: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
    params,
  };
}

export function createEvent(input: CreateEventInput): IntegrationEvent {
  const timestamp = new Date();
  const event: IntegrationEvent = {
    id: uuidv7(),
    integration: input.integration,
    eventType: input.eventType,
    status: input.status,
    timestamp,
    payload: input.payload,
    error: input.error,
    metrics: input.metrics,
    tags: input.tags,
    environment: input.environment,
    severity: input.severity,
    source: input.source,
  };

  db.prepare(
    `INSERT INTO events (id, project_id, integration, event_type, status, timestamp, payload, error, idempotency_key, metrics, tags, environment, severity, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    event.id,
    input.projectId ?? null,
    event.integration,
    event.eventType,
    event.status,
    timestamp.getTime(),
    JSON.stringify(event.payload),
    event.error ? JSON.stringify(event.error) : null,
    input.idempotencyKey ?? null,
    input.metrics ? JSON.stringify(input.metrics) : null,
    input.tags ? JSON.stringify(input.tags) : null,
    input.environment ?? null,
    input.severity ?? null,
    input.source ?? null
  );

  return event;
}

/** Looks up a previously created event by the same project + idempotency key, if any */
export function findEventByIdempotencyKey(
  projectId: string,
  idempotencyKey: string
): IntegrationEvent | undefined {
  const row = db
    .prepare('SELECT * FROM events WHERE project_id = ? AND idempotency_key = ?')
    .get(projectId, idempotencyKey) as EventRow | undefined;
  return row ? rowToEvent(row) : undefined;
}

export function getEvents(options?: GetEventsOptions): IntegrationEvent[] {
  return getEventsPaginated(options).events;
}

export function getEventsPaginated(options?: GetEventsOptions): PaginatedEvents {
  const { clause, params } = buildWhere(options);
  const sortColumn = SORT_COLUMNS[options?.sortBy || 'timestamp'];
  const sortOrder = options?.sortOrder === 'asc' ? 'ASC' : 'DESC';
  // Clamp: a negative limit is LIMIT -1 in SQLite = the whole table; a huge
  // one is a memory hazard. NaN/0/undefined fall back to the default.
  const rawLimit = options?.limit;
  const limit =
    rawLimit && rawLimit > 0
      ? Math.min(rawLimit, EVENT_STORE.MAX_PAGE_SIZE)
      : EVENT_STORE.DEFAULT_PAGE_SIZE;
  const offset = Math.max(0, options?.offset || 0);

  const total = (
    db.prepare(`SELECT COUNT(*) as count FROM events ${clause}`).get(...params) as {
      count: number;
    }
  ).count;

  // rowid as a tiebreaker preserves insertion order when the sort column ties
  // (e.g. two events created in the same millisecond)
  const rows = db
    .prepare(
      `SELECT * FROM events ${clause} ORDER BY ${sortColumn} ${sortOrder}, rowid ${sortOrder} LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset) as EventRow[];

  return {
    events: rows.map(rowToEvent),
    total,
    offset,
    limit,
    hasMore: offset + limit < total,
  };
}

export function getEventById(id: string): IntegrationEvent | undefined {
  const row = db.prepare('SELECT * FROM events WHERE id = ?').get(id) as EventRow | undefined;
  return row ? rowToEvent(row) : undefined;
}

/** Like getEventById, but only returns the event if it belongs to the given org's projects. */
export function getEventByIdForOrg(id: string, orgId: string): IntegrationEvent | undefined {
  const row = db
    .prepare(
      'SELECT * FROM events WHERE id = ? AND project_id IN (SELECT id FROM projects WHERE org_id = ?)'
    )
    .get(id, orgId) as EventRow | undefined;
  return row ? rowToEvent(row) : undefined;
}

export function updateEventClassification(
  id: string,
  classification: IntegrationEvent['classification']
): IntegrationEvent | undefined {
  const existing = getEventById(id);
  if (!existing) return undefined;

  db.prepare('UPDATE events SET classification = ? WHERE id = ?').run(
    classification ? JSON.stringify(classification) : null,
    id
  );

  return { ...existing, classification };
}

export function getDistinctIntegrations(orgId?: string): string[] {
  const rows = (
    orgId
      ? db
          .prepare(
            'SELECT DISTINCT integration FROM events WHERE project_id IN (SELECT id FROM projects WHERE org_id = ?)'
          )
          .all(orgId)
      : db.prepare('SELECT DISTINCT integration FROM events').all()
  ) as { integration: string }[];
  return rows.map((r) => r.integration);
}

/** How many recent events to derive an integration's reporting rhythm from. */
const CADENCE_SAMPLE = 20;

/**
 * Below this many events there is no rhythm to infer. Two events is a single
 * gap, and a one-off smoke test that fired three events in a row months ago
 * would otherwise "normally report every 2 seconds" and be declared dead
 * forever. Something that only ever ran once was never on a schedule to miss.
 */
const CADENCE_MIN_EVENTS = 5;

/**
 * How long this integration normally goes quiet: the LONGEST gap between its
 * recent events. Silence is judged against this instead of a fixed window,
 * because integrations are discovered from events and never declare a schedule.
 *
 * Longest, not median or mean. A reporter that emits a burst of events and then
 * sleeps has a near-zero median gap, and judging it by that would call it dead
 * moments after every healthy burst. The longest recent gap is the only one of
 * the three that already contains the quiet stretch such a reporter considers
 * normal. It errs toward under-alerting - one past outage inside the sample
 * raises the bar for the next one - which is the right way to be wrong here: a
 * dashboard that cries wolf on healthy integrations gets ignored, and then it
 * catches nothing at all.
 *
 * Null below CADENCE_MIN_EVENTS - too little history to claim a rhythm.
 *
 * ponytail: fooled by a reporter whose bursts exceed CADENCE_SAMPLE events, since
 * the sample then never spans a quiet stretch. Have integrations declare a
 * cadence if that ever shows up.
 */
function normalQuietMs(timestamps: number[]): number | null {
  if (timestamps.length < CADENCE_MIN_EVENTS) return null;

  let longest = 0;
  for (let i = 1; i < timestamps.length; i++) {
    longest = Math.max(longest, timestamps[i - 1] - timestamps[i]); // newest-first
  }
  return longest > 0 ? longest : null;
}

export function getEventStats(integration: string, orgId?: string): EventStats {
  const last24hTime = Date.now() - 24 * 60 * 60 * 1000;

  const orgClause = orgId ? 'AND project_id IN (SELECT id FROM projects WHERE org_id = ?)' : '';
  const orgParams = orgId ? [orgId] : [];

  // Counts are windowed to 24h; lastTimestamp deliberately is not - "last sync"
  // means the last event ever, so a silent integration reports when it went
  // quiet instead of claiming it never reported at all.
  const row = db
    .prepare(
      `SELECT
         COUNT(CASE WHEN timestamp >= ? THEN 1 END) as total,
         SUM(CASE WHEN timestamp >= ? AND status = 'failure' THEN 1 ELSE 0 END) as failures,
         MAX(timestamp) as lastTimestamp
       FROM events
       WHERE integration = ? ${orgClause}`
    )
    .get(last24hTime, last24hTime, integration, ...orgParams) as {
    total: number;
    failures: number | null;
    lastTimestamp: number | null;
  };

  const recent = db
    .prepare(
      `SELECT timestamp FROM events
       WHERE integration = ? ${orgClause}
       ORDER BY timestamp DESC LIMIT ?`
    )
    .all(integration, ...orgParams, CADENCE_SAMPLE) as { timestamp: number }[];

  const total = row.total;
  const failures = row.failures || 0;

  return {
    eventsLast24h: total,
    errorsLast24h: failures,
    successRate: total > 0 ? Math.round(((total - failures) / total) * 100) : null,
    lastSync: row.lastTimestamp ? new Date(row.lastTimestamp) : null,
    expectedIntervalMs: normalQuietMs(recent.map((r) => r.timestamp)),
  };
}

function setResolution(existing: IntegrationEvent, resolution: Resolution): IntegrationEvent {
  db.prepare('UPDATE events SET resolution = ? WHERE id = ?').run(
    JSON.stringify(resolution),
    existing.id
  );
  return { ...existing, resolution };
}

export function acknowledgeEvent(
  id: string,
  acknowledgedBy: string = 'anonymous'
): IntegrationEvent | undefined {
  const existing = getEventById(id);
  if (!existing || existing.status !== 'failure') return undefined;

  return setResolution(existing, {
    status: 'acknowledged',
    acknowledgedAt: new Date(),
    acknowledgedBy,
  });
}

export function resolveEvent(
  id: string,
  resolvedBy: string = 'anonymous',
  notes?: string
): IntegrationEvent | undefined {
  const existing = getEventById(id);
  if (!existing || existing.status !== 'failure') return undefined;

  return setResolution(existing, {
    ...existing.resolution,
    status: 'resolved',
    resolvedAt: new Date(),
    resolvedBy,
    notes,
  });
}

export function reopenEvent(id: string): IntegrationEvent | undefined {
  const existing = getEventById(id);
  if (!existing) return undefined;

  return setResolution(existing, { status: 'open' });
}

export function clearEvents(): void {
  db.prepare('DELETE FROM events').run();
}

/**
 * Deletes events older than `retentionDays` (by timestamp). Returns the number
 * of rows removed. Keeps the events table from growing without bound.
 */
export function purgeOldEvents(retentionDays: number): number {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  return db.prepare('DELETE FROM events WHERE timestamp < ?').run(cutoff).changes;
}
