/**
 * Shared Constants
 * Configuration values used across the application
 */

/**
 * Event Store Configuration
 */
export const EVENT_STORE = {
  MAX_EVENTS_IN_MEMORY: 1000,
  DEFAULT_PAGE_SIZE: 50,
  MAX_PAGE_SIZE: 100,
  MAX_EXPORT_LIMIT: 10000,
} as const;

/**
 * Health Calculation Thresholds
 */
export const HEALTH_THRESHOLDS = {
  HEALTHY: {
    MIN_SUCCESS_RATE: 98,
    MAX_ERRORS_24H: 5,
  },
  DEGRADED: {
    MIN_SUCCESS_RATE: 90,
    MAX_ERRORS_24H: 20,
  },
} as const;

/**
 * Polling and Timing Configuration
 */
export const TIMING = {
  POLLING_INTERVAL_MS: 5000,
  SEARCH_DEBOUNCE_MS: 300,
  API_TIMEOUT_MS: 30000,
} as const;

/**
 * UI Display Labels
 */
export const INTEGRATION_LABELS: Record<string, string> = {
  procore: 'Procore',
  gusto: 'Gusto',
  quickbooks: 'QuickBooks',
  stripe_issuing: 'Stripe Issuing',
  certified_payroll: 'Certified Payroll',
} as const;

export const CATEGORY_LABELS: Record<string, string> = {
  auth: 'Authentication',
  rate_limit: 'Rate Limit',
  data_validation: 'Data Validation',
  data_state_mismatch: 'Data State Mismatch',
  network: 'Network',
  spending_control: 'Spending Control',
  compliance: 'Compliance',
  unknown: 'Unknown',
} as const;

/**
 * UI Color Mappings (Tailwind CSS classes)
 */
export const STATUS_COLORS: Record<string, string> = {
  success: 'bg-green-100 text-green-700',
  failure: 'bg-red-100 text-red-700',
  pending: 'bg-gray-100 text-gray-700',
} as const;

export const RESOLUTION_COLORS: Record<string, string> = {
  open: 'bg-red-100 text-red-700',
  acknowledged: 'bg-yellow-100 text-yellow-700',
  resolved: 'bg-green-100 text-green-700',
} as const;

export const SEVERITY_COLORS: Record<string, string> = {
  low: 'bg-blue-100 text-blue-700',
  medium: 'bg-yellow-100 text-yellow-700',
  high: 'bg-orange-100 text-orange-700',
  critical: 'bg-red-100 text-red-700',
} as const;

export const SEVERITY_COLORS_WITH_BORDER: Record<string, string> = {
  low: 'bg-blue-100 text-blue-800 border-blue-200',
  medium: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  high: 'bg-orange-100 text-orange-800 border-orange-200',
  critical: 'bg-red-100 text-red-800 border-red-200',
} as const;

export const RESOLUTION_STATUS_COLORS: Record<string, string> = {
  open: 'bg-red-100 text-red-800',
  acknowledged: 'bg-yellow-100 text-yellow-800',
  resolved: 'bg-green-100 text-green-800',
} as const;

export const SYNC_STATUS_COLORS: Record<string, string> = {
  healthy: 'bg-green-100 text-green-700',
  stale: 'bg-yellow-100 text-yellow-700',
  failing: 'bg-red-100 text-red-700',
  disabled: 'bg-gray-100 text-gray-700',
} as const;

/**
 * API Configuration
 */
export const API = {
  BASE_PATH: '/api',
  ENDPOINTS: {
    HEALTH: '/health',
    EVENTS: '/events',
    EVENTS_PAGINATED: '/events/paginated',
    INTEGRATIONS: '/integrations',
    INTEGRATIONS_HEALTH: '/integrations/health',
    SYNC_OVERVIEW: '/sync/overview',
    SYNC_PIPELINES: '/sync/pipelines',
    SYNC_INSTANCES: '/sync/instances',
    SYNC_CLIENTS: '/sync/clients',
    SIMULATE: '/simulate',
  },
} as const;
