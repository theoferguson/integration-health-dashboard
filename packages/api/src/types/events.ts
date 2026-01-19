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
  acknowledgedAt?: Date;
  acknowledgedBy?: string;
  resolvedAt?: Date;
  resolvedBy?: string;
  notes?: string;
}

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
  resolution?: Resolution;
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
