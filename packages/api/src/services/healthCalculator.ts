import type { Integration, IntegrationStatus } from '../types/index.js';
import { HEALTH_THRESHOLDS } from '../types/index.js';
import { getEventStats, getDistinctIntegrations } from './eventStore.js';

function calculateStatus(successRate: number, errorsLast24h: number): IntegrationStatus {
  const { HEALTHY, DEGRADED } = HEALTH_THRESHOLDS;

  if (successRate >= HEALTHY.MIN_SUCCESS_RATE && errorsLast24h < HEALTHY.MAX_ERRORS_24H) {
    return 'healthy';
  }
  if (successRate >= DEGRADED.MIN_SUCCESS_RATE || errorsLast24h < DEGRADED.MAX_ERRORS_24H) {
    return 'degraded';
  }
  return 'down';
}

export function getIntegrationHealth(integrationId: string, orgId?: string): Integration {
  const stats = getEventStats(integrationId, orgId);

  return {
    id: integrationId,
    status: calculateStatus(stats.successRate, stats.errorsLast24h),
    lastSync: stats.lastSync,
    successRate: stats.successRate,
    eventsLast24h: stats.eventsLast24h,
    errorsLast24h: stats.errorsLast24h,
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
