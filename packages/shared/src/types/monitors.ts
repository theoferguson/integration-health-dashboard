/**
 * Monitor Types
 * A monitor is an org-scoped saved event query, rendered as a time-series graph
 * of the events matching its configuration (the Datadog sense). The graph is
 * derived from the events table - no stored "firings" in v1.
 */

import type { EventStatus } from './events.js';

/** Comparison operators for a predicate. Numeric ops coerce both sides to number. */
export type PredicateOp = 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'exists';

/**
 * One condition over an event field. `field` is a namespaced path: top-level
 * (`status`, `severity`, `environment`, `integration`, `eventType`) or a single
 * dotted key into a JSON column (`metrics.latencyMs`, `tags.region`,
 * `payload.tempF`, `error.code`). `value` is omitted for `exists`.
 */
export interface MonitorPredicate {
  field: string;
  op: PredicateOp;
  value?: string | number;
}

/** All conditions AND together. Empty spec matches every event in the org. */
export interface MonitorMatchSpec {
  integration?: string;
  eventType?: string;
  status?: EventStatus;
  predicates?: MonitorPredicate[];
}

export interface Monitor {
  id: string;
  name: string;
  enabled: boolean;
  matchSpec: MonitorMatchSpec;
  createdAt: Date | string;
  updatedAt: Date | string;
}

/** One bucket of the monitor graph: matching-event count in [bucket, bucket+bucketMs). */
export interface MonitorSeriesPoint {
  /** ms epoch of the bucket start. */
  bucket: number;
  count: number;
}

/** A monitor plus a lightweight recent-activity summary for the list view. */
export interface MonitorSummary extends Monitor {
  /** Matching events in the last 24h. */
  matchesLast24h: number;
  /** Timestamp (ms epoch) of the most recent matching event, or null. */
  lastMatchedAt: number | null;
}
