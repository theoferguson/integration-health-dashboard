/**
 * Integration Types
 * Shared type definitions for integrations across the platform
 */

export type IntegrationStatus = 'healthy' | 'degraded' | 'down';

/**
 * An integration is identified by whatever string a reporting project
 * sends as `integration` on an event - there is no static registry.
 */
export interface Integration {
  id: string;
  status: IntegrationStatus;
  lastSync: Date | string | null;
  /** Percent successful over the last 24h; null when nothing reported in that window. */
  successRate: number | null;
  eventsLast24h: number;
  errorsLast24h: number;
  /**
   * How long this integration normally goes between events; null when it has
   * too little history to tell. Compare against `lastSync` to see how overdue
   * it is - that ratio, not the success rate, is what catches a reporter that
   * has stopped reporting.
   */
  expectedIntervalMs: number | null;
  /**
   * True when the integration has stopped reporting on its own schedule. This
   * is the difference between "failing" and "gone": a stale integration may
   * have a spotless success rate on everything it ever sent.
   */
  stale: boolean;
}
