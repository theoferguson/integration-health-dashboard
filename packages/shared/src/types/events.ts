/**
 * Event Types
 * Shared type definitions for integration events
 */

import type { IntegrationType } from './integrations.js';

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
  | 'compliance'
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

export interface IntegrationEvent {
  id: string;
  integration: IntegrationType;
  eventType: string;
  status: EventStatus;
  timestamp: Date | string;
  payload: Record<string, unknown>;
  error?: EventError;
  classification?: ErrorClassification;
  resolution?: Resolution;
}

export interface CreateEventInput {
  integration: IntegrationType;
  eventType: string;
  status: EventStatus;
  payload: Record<string, unknown>;
  error?: EventError;
}

export interface HealthOverview {
  totalIntegrations: number;
  healthy: number;
  degraded: number;
  down: number;
}
