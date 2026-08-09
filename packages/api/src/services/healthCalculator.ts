import type { Integration, IntegrationStatus } from '../types/index.js';
import { HEALTH_THRESHOLDS, STALENESS } from '../types/index.js';
import { getEventStats, getDistinctIntegrations, type EventStats } from './eventStore.js';

/**
 * How overdue an integration is: silence since its last event, as a multiple of
 * its own cadence. 1 means "due now", 5 means it has missed roughly five
 * reports. Null when there's no cadence to measure against.
 *
 * This is the signal a fixed 24h window could not carry. A 2-minute poller that
 * dies is 720 reports overdue before a daily window even notices, while a
 * weekly report is not late at all after a day of quiet.
 */
export function overdueFactor(stats: EventStats, now = Date.now()): number | null {
  if (!stats.lastSync || !stats.expectedIntervalMs) return null;

  const silentMs = now - new Date(stats.lastSync).getTime();
  // A fast reporter must not be called stale seconds after its last event just
  // because its normal gap is tiny.
  if (silentMs < STALENESS.MIN_SILENCE_MS) return 0;

  return silentMs / stats.expectedIntervalMs;
}

function calculateStatus(stats: EventStats, overdue: number | null): IntegrationStatus {
  const { HEALTHY, DEGRADED } = HEALTH_THRESHOLDS;
  const { STALE, DEAD } = STALENESS;

  // Silence first, and on its own terms: an integration can be 100% successful
  // on every event it ever sent and still be dead right now. Rate and error
  // count say nothing about a reporter that stopped reporting.
  if (overdue !== null) {
    if (overdue >= DEAD) return 'down';
    if (overdue >= STALE) return 'degraded';
  }

  // Nothing in the 24h window. Where a rhythm is known the check above already
  // had the final say, so reaching here means it is simply not due yet - a
  // weekly reporter is not sick for the six days between reports. Only fall
  // back to the fixed window when there is no rhythm to judge by, and then only
  // against a reporting history; an id that never reported at all has nothing
  // to be stale about.
  if (stats.successRate === null) {
    if (overdue !== null) return 'healthy';
    return stats.lastSync ? 'degraded' : 'healthy';
  }

  if (stats.successRate >= HEALTHY.MIN_SUCCESS_RATE && stats.errorsLast24h < HEALTHY.MAX_ERRORS_24H) {
    return 'healthy';
  }
  if (stats.successRate >= DEGRADED.MIN_SUCCESS_RATE || stats.errorsLast24h < DEGRADED.MAX_ERRORS_24H) {
    return 'degraded';
  }
  return 'down';
}

export function getIntegrationHealth(integrationId: string, orgId?: string): Integration {
  const stats = getEventStats(integrationId, orgId);
  const overdue = overdueFactor(stats);

  return {
    id: integrationId,
    status: calculateStatus(stats, overdue),
    lastSync: stats.lastSync,
    successRate: stats.successRate,
    eventsLast24h: stats.eventsLast24h,
    errorsLast24h: stats.errorsLast24h,
    expectedIntervalMs: stats.expectedIntervalMs,
    // Stated rather than left to be inferred: 'degraded' alone doesn't say
    // whether an integration is failing or has simply stopped reporting, and
    // every consumer re-deriving that from timestamps would drift from this
    // rule the moment it changed.
    stale: overdue !== null && overdue >= STALENESS.STALE,
  };
}

/**
 * Integrations are discovered dynamically from reported events -
 * there is no static registry of "known" integrations.
 */
export function getAllIntegrationHealth(orgId?: string): Integration[] {
  return getDistinctIntegrations(orgId).map((id) => getIntegrationHealth(id, orgId));
}

export interface HealthRollup {
  totalIntegrations: number;
  healthy: number;
  degraded: number;
  down: number;
}

/**
 * Roll up a list of integration healths into status counts. Split out so callers
 * that already have the list (the /health route, the MCP get_health tool) can
 * summarize it without re-querying every integration a second time.
 */
export function summarizeHealth(integrations: Integration[]): HealthRollup {
  return {
    totalIntegrations: integrations.length,
    healthy: integrations.filter((i) => i.status === 'healthy').length,
    degraded: integrations.filter((i) => i.status === 'degraded').length,
    down: integrations.filter((i) => i.status === 'down').length,
  };
}

export function getOverallHealth(orgId?: string): HealthRollup {
  return summarizeHealth(getAllIntegrationHealth(orgId));
}
