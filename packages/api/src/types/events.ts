import type { IntegrationType } from './integrations.js';

export type EventStatus = 'success' | 'failure' | 'pending';
export type ErrorSeverity = 'low' | 'medium' | 'high' | 'critical';
export type ErrorCategory =
  | 'auth'
  | 'rate_limit'
  | 'data_validation'
  | 'data_state_mismatch'
  | 'network'
  | 'spending_control'
  | 'compliance'
  | 'unknown';

export interface IntegrationEvent {
  id: string;
  integration: IntegrationType;
  eventType: string;
  status: EventStatus;
  timestamp: Date;
  payload: Record<string, unknown>;
  error?: {
    message: string;
    code?: string;
    context?: Record<string, unknown>;
  };
  classification?: ErrorClassification;
}

export interface ErrorClassification {
  category: ErrorCategory;
  severity: ErrorSeverity;
  cause: string;
  suggestedFix: string;
  affectedData?: string[];
  businessImpact?: string;
}

export interface CreateEventInput {
  integration: IntegrationType;
  eventType: string;
  status: EventStatus;
  payload: Record<string, unknown>;
  error?: {
    message: string;
    code?: string;
    context?: Record<string, unknown>;
  };
}
