/**
 * API Types
 * Re-exports shared types and adds API-specific types
 */

// Re-export all shared types
export * from '@ihd/shared';

// Re-export constants that API uses
export {
  EVENT_STORE,
  HEALTH_THRESHOLDS,
  INTEGRATIONS,
  INTEGRATION_IDS,
} from '@ihd/shared';
