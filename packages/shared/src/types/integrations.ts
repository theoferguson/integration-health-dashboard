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
}
