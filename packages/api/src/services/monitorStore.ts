/**
 * Monitor Store
 * Org-scoped CRUD for monitors plus the graph query that derives a matching-
 * event time series straight from the events table (no stored firings in v1).
 */

import { randomUUID } from 'crypto';
import { db } from '../db/connection.js';
import { buildMatchClause } from './monitorMatch.js';
import type { Monitor, MonitorMatchSpec, MonitorSummary, MonitorSeriesPoint } from '../types/index.js';

interface MonitorRow {
  id: string;
  org_id: string;
  name: string;
  enabled: number;
  match_spec: string;
  created_at: number;
  updated_at: number;
}

function rowToMonitor(row: MonitorRow): Monitor {
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled === 1,
    matchSpec: JSON.parse(row.match_spec) as MonitorMatchSpec,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function createMonitor(orgId: string, name: string, matchSpec: MonitorMatchSpec): Monitor {
  const now = Date.now();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO monitors (id, org_id, name, enabled, match_spec, created_at, updated_at)
     VALUES (?, ?, ?, 1, ?, ?, ?)`
  ).run(id, orgId, name, JSON.stringify(matchSpec), now, now);
  return rowToMonitor(
    db.prepare('SELECT * FROM monitors WHERE id = ?').get(id) as MonitorRow
  );
}

export function getMonitorForOrg(id: string, orgId: string): Monitor | undefined {
  const row = db.prepare('SELECT * FROM monitors WHERE id = ? AND org_id = ?').get(id, orgId) as
    | MonitorRow
    | undefined;
  return row ? rowToMonitor(row) : undefined;
}

/** All of an org's monitors with a last-24h activity summary (one query per monitor - orgs have a handful). */
export function listMonitorsForOrg(orgId: string): MonitorSummary[] {
  const rows = db
    .prepare('SELECT * FROM monitors WHERE org_id = ? ORDER BY created_at DESC')
    .all(orgId) as MonitorRow[];
  return rows.map((row) => {
    const monitor = rowToMonitor(row);
    const { matchesLast24h, lastMatchedAt } = matchSummary(orgId, monitor.matchSpec);
    return { ...monitor, matchesLast24h, lastMatchedAt };
  });
}

/**
 * Update name / enabled / matchSpec. Only provided fields change. Returns the
 * updated monitor, or undefined if it doesn't belong to the org.
 */
export function updateMonitorForOrg(
  id: string,
  orgId: string,
  patch: { name?: string; enabled?: boolean; matchSpec?: MonitorMatchSpec }
): Monitor | undefined {
  const existing = getMonitorForOrg(id, orgId);
  if (!existing) return undefined;

  const name = patch.name ?? existing.name;
  const enabled = patch.enabled ?? existing.enabled;
  const matchSpec = patch.matchSpec ?? existing.matchSpec;

  db.prepare(
    'UPDATE monitors SET name = ?, enabled = ?, match_spec = ?, updated_at = ? WHERE id = ? AND org_id = ?'
  ).run(name, enabled ? 1 : 0, JSON.stringify(matchSpec), Date.now(), id, orgId);

  return getMonitorForOrg(id, orgId);
}

/** Returns false if the monitor doesn't exist or isn't the org's - same signal, so ownership isn't probeable. */
export function deleteMonitorForOrg(id: string, orgId: string): boolean {
  return db.prepare('DELETE FROM monitors WHERE id = ? AND org_id = ?').run(id, orgId).changes > 0;
}

/** Count + most-recent timestamp of events matching a spec in the last 24h, org-scoped. */
function matchSummary(
  orgId: string,
  spec: MonitorMatchSpec
): { matchesLast24h: number; lastMatchedAt: number | null } {
  const { clause, params } = buildMatchClause(spec);
  const row = db
    .prepare(
      `SELECT COUNT(*) as c, MAX(timestamp) as last
       FROM events
       WHERE project_id IN (SELECT id FROM projects WHERE org_id = ?)
         AND timestamp >= ? AND (${clause})`
    )
    .get(orgId, Date.now() - DAY_MS, ...params) as { c: number; last: number | null };
  return { matchesLast24h: row.c, lastMatchedAt: row.last };
}

/**
 * The monitor graph: matching-event counts bucketed over [now - windowMs, now].
 * Buckets with zero matches are omitted (the UI fills gaps). Org-scoped.
 */
export function getMonitorSeries(
  orgId: string,
  spec: MonitorMatchSpec,
  windowMs: number,
  bucketMs: number
): MonitorSeriesPoint[] {
  const { clause, params } = buildMatchClause(spec);
  const since = Date.now() - windowMs;
  const rows = db
    .prepare(
      `SELECT (timestamp / ?) * ? AS bucket, COUNT(*) as count
       FROM events
       WHERE project_id IN (SELECT id FROM projects WHERE org_id = ?)
         AND timestamp >= ? AND (${clause})
       GROUP BY bucket
       ORDER BY bucket ASC`
    )
    .all(bucketMs, bucketMs, orgId, since, ...params) as MonitorSeriesPoint[];
  return rows;
}
