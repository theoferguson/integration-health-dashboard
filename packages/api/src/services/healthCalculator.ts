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

export function getIntegrationHealth(integrationId: string): Integration {
  const stats = getEventStats(integrationId);

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
export function getAllIntegrationHealth(): Integration[] {
  return getDistinctIntegrations().map((id) => getIntegrationHealth(id));
}

export function getOverallHealth(): {
  totalIntegrations: number;
  healthy: number;
  degraded: number;
  down: number;
} {
  const all = getAllIntegrationHealth();
  return {
    totalIntegrations: all.length,
    healthy: all.filter((i) => i.status === 'healthy').length,
    degraded: all.filter((i) => i.status === 'degraded').length,
    down: all.filter((i) => i.status === 'down').length,
  };
}
