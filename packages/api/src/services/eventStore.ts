/**
 * Event Store
 * SQLite-backed storage for integration events
 */

import { v4 as uuidv4 } from 'uuid';
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
  successRate: number;
  lastSync: Date | string | null;
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

  return {
    clause: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
    params,
  };
}

export function createEvent(input: CreateEventInput): IntegrationEvent {
  const timestamp = new Date();
  const event: IntegrationEvent = {
    id: uuidv4(),
    integration: input.integration,
    eventType: input.eventType,
    status: input.status,
    timestamp,
    payload: input.payload,
    error: input.error,
  };

  db.prepare(
    `INSERT INTO events (id, project_id, integration, event_type, status, timestamp, payload, error, idempotency_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    event.id,
    input.projectId ?? null,
    event.integration,
    event.eventType,
    event.status,
    timestamp.getTime(),
    JSON.stringify(event.payload),
    event.error ? JSON.stringify(event.error) : null,
    input.idempotencyKey ?? null
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

export function getEventStats(integration: string, orgId?: string): EventStats {
  const last24hTime = Date.now() - 24 * 60 * 60 * 1000;

  const orgClause = orgId ? 'AND project_id IN (SELECT id FROM projects WHERE org_id = ?)' : '';
  const orgParams = orgId ? [orgId] : [];

  const row = db
    .prepare(
      `SELECT
         COUNT(*) as total,
         SUM(CASE WHEN status = 'failure' THEN 1 ELSE 0 END) as failures,
         MAX(timestamp) as lastTimestamp
       FROM events
       WHERE integration = ? AND timestamp >= ? ${orgClause}`
    )
    .get(integration, last24hTime, ...orgParams) as {
    total: number;
    failures: number;
    lastTimestamp: number | null;
  };

  const total = row.total;
  const failures = row.failures || 0;
  const successRate = total > 0 ? Math.round(((total - failures) / total) * 100) : 100;

  return {
    eventsLast24h: total,
    errorsLast24h: failures,
    successRate,
    lastSync: row.lastTimestamp ? new Date(row.lastTimestamp) : null,
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
