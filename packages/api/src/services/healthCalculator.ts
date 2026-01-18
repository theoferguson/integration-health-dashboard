import type { Integration, IntegrationType, IntegrationStatus } from '../types/index.js';
import { INTEGRATIONS } from '../types/index.js';
import { getEventStats } from './eventStore.js';

function calculateStatus(successRate: number, errorsLast24h: number): IntegrationStatus {
  if (successRate >= 98 && errorsLast24h < 5) {
    return 'healthy';
  }
  if (successRate >= 90 || errorsLast24h < 20) {
    return 'degraded';
  }
  return 'down';
}

export function getIntegrationHealth(integrationId: IntegrationType): Integration {
  const base = INTEGRATIONS[integrationId];
  const stats = getEventStats(integrationId);

  return {
    ...base,
    status: calculateStatus(stats.successRate, stats.errorsLast24h),
    lastSync: stats.lastSync,
    successRate: stats.successRate,
    eventsLast24h: stats.eventsLast24h,
    errorsLast24h: stats.errorsLast24h,
  };
}

export function getAllIntegrationHealth(): Integration[] {
  return Object.keys(INTEGRATIONS).map((id) =>
    getIntegrationHealth(id as IntegrationType)
  );
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
