export type IntegrationType =
  | 'procore'
  | 'gusto'
  | 'quickbooks'
  | 'stripe_issuing'
  | 'certified_payroll';

export type IntegrationStatus = 'healthy' | 'degraded' | 'down';

export interface Integration {
  id: IntegrationType;
  name: string;
  description: string;
  status: IntegrationStatus;
  lastSync: string | null;
  successRate: number;
  eventsLast24h: number;
  errorsLast24h: number;
}

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
  timestamp: string;
  payload: Record<string, unknown>;
  error?: {
    message: string;
    code?: string;
    context?: Record<string, unknown>;
  };
  classification?: ErrorClassification;
}

export interface HealthOverview {
  totalIntegrations: number;
  healthy: number;
  degraded: number;
  down: number;
}
