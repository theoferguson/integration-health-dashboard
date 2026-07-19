/**
 * Event Types
 * Shared type definitions for integration events
 */

export type EventStatus = 'success' | 'failure' | 'pending';
export type ErrorSeverity = 'low' | 'medium' | 'high' | 'critical';
export type ResolutionStatus = 'open' | 'acknowledged' | 'resolved';

export type ErrorCategory =
  | 'auth'
  | 'rate_limit'
  | 'data_validation'
  | 'data_state_mismatch'
  | 'network'
  | 'spending_control'
  | 'unknown';

export interface Resolution {
  status: ResolutionStatus;
  acknowledgedAt?: Date | string;
  acknowledgedBy?: string;
  resolvedAt?: Date | string;
  resolvedBy?: string;
  notes?: string;
}

export interface EventError {
  message: string;
  code?: string;
  context?: Record<string, unknown>;
}

export interface ErrorClassification {
  category: ErrorCategory;
  severity: ErrorSeverity;
  cause: string;
  suggestedFix: string;
  affectedData?: string[];
  businessImpact?: string;
}

/**
 * Structured, queryable fields a reporter can attach to any event (all optional,
 * schemaVersion 2). They power trend charts, filtering, and monitor graphs.
 */
export interface EventDimensions {
  /** Numeric measures for trend charts (e.g. { latencyMs: 214, itemCount: 12 }). */
  metrics?: Record<string, number>;
  /** Free-form labels for filtering/grouping (e.g. { region: 'us-east' }). */
  tags?: Record<string, string>;
  /** Deployment environment: 'prod' | 'staging' | ... */
  environment?: string;
  /** Reporter-supplied severity, distinct from the AI-derived classification.severity. */
  severity?: ErrorSeverity;
  /** Reporter identity, e.g. 'iha@1.4.0'. */
  source?: string;
}

export interface IntegrationEvent extends EventDimensions {
  id: string;
  integration: string;
  eventType: string;
  status: EventStatus;
  timestamp: Date | string;
  payload: Record<string, unknown>;
  error?: EventError;
  classification?: ErrorClassification;
  resolution?: Resolution;
}

export interface CreateEventInput extends EventDimensions {
  integration: string;
  eventType: string;
  status: EventStatus;
  payload: Record<string, unknown>;
  error?: EventError;
  /** Which project reported this event, if it came through /api/ingest */
  projectId?: string;
  /** Dedupes retried sends of the same logical event from a project's client */
  idempotencyKey?: string;
}

export interface HealthOverview {
  totalIntegrations: number;
  healthy: number;
  degraded: number;
  down: number;
}
