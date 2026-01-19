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

export interface ErrorClassification {
  category: ErrorCategory;
  severity: ErrorSeverity;
  cause: string;
  suggestedFix: string;
  affectedData?: string[];
  businessImpact?: string;
}

export interface Resolution {
  status: ResolutionStatus;
  acknowledgedAt?: string;
  acknowledgedBy?: string;
  resolvedAt?: string;
  resolvedBy?: string;
  notes?: string;
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
  resolution?: Resolution;
}

export interface HealthOverview {
  totalIntegrations: number;
  healthy: number;
  degraded: number;
  down: number;
}

// ===== Sync Types =====

// A sync pipeline definition
export interface SyncPipeline {
  id: string;
  name: string;
  integration: IntegrationType;
  dataType: string;
  direction: 'pull' | 'push';
  description: string;
  schedule: {
    intervalMinutes: number;
    staleThresholdMinutes: number;
  };
}

export type SyncInstanceStatus = 'healthy' | 'stale' | 'failing' | 'disabled';

export interface SyncStats {
  totalSyncs: number;
  successfulSyncs: number;
  failedSyncs: number;
  successRate: number;
  avgDurationMs: number;
  totalRecordsProcessed: number;
}

export type SyncExecutionStatus = 'running' | 'success' | 'partial' | 'failed';

export interface SyncExecutionSummary {
  id: string;
  instanceId: string;
  pipelineId: string;
  startedAt: string;
  completedAt: string | null;
  status: SyncExecutionStatus;
  durationMs: number;
  recordsProcessed: number;
  errors: number;
  warnings: number;
}

export interface SyncInstance {
  id: string;
  clientId: string;
  clientName: string;
  pipelineId: string;
  pipeline: SyncPipeline;
  status: SyncInstanceStatus;
  enabled: boolean;
  lastSync: SyncExecutionSummary | null;
  nextScheduledSync: string;
  stats: {
    last24h: SyncStats;
    last7d: SyncStats;
  };
  recentExecutions: SyncExecutionSummary[];
}

export interface SyncError {
  id: string;
  recordId?: string;
  recordName?: string;
  message: string;
  code: string;
  context: Record<string, unknown>;
  retryable: boolean;
  timestamp: string;
}

export interface SyncWarning {
  id: string;
  recordId?: string;
  recordName?: string;
  message: string;
  code: string;
  timestamp: string;
}

export interface SyncChange {
  id: string;
  recordId: string;
  recordName: string;
  changeType: 'created' | 'updated' | 'deleted';
  fields?: {
    field: string;
    oldValue: string | null;
    newValue: string;
  }[];
  timestamp: string;
}

export interface SyncExecution {
  id: string;
  instanceId: string;
  pipelineId: string;
  clientId: string;
  clientName: string;
  pipeline: SyncPipeline;
  startedAt: string;
  completedAt: string | null;
  status: SyncExecutionStatus;
  triggeredBy: 'schedule' | 'manual' | 'webhook';
  request: {
    url: string;
    method: string;
    headers: Record<string, string>;
    params: Record<string, string>;
    timestamp: string;
  };
  response: {
    statusCode: number;
    statusText: string;
    headers: Record<string, string>;
    bodyPreview: string;
    bodySize: number;
    durationMs: number;
    timestamp: string;
  } | null;
  results: {
    recordsFetched: number;
    recordsCreated: number;
    recordsUpdated: number;
    recordsSkipped: number;
    recordsFailed: number;
    errors: SyncError[];
    warnings: SyncWarning[];
    changes: SyncChange[];
  };
}

export interface PipelineStat {
  pipeline: SyncPipeline;
  totalInstances: number;
  healthyInstances: number;
  staleInstances: number;
  failingInstances: number;
  successRate: number;
  syncsLast24h: number;
  avgDurationMs: number;
}

export interface FailingInstanceSummary {
  instanceId: string;
  clientId: string;
  clientName: string;
  pipeline: SyncPipeline;
  lastError: string;
  failingSince: string;
  consecutiveFailures: number;
}

export interface SyncSystemOverview {
  overallHealth: number;
  activeClients: number;
  totalSyncsLast24h: number;
  syncsPerHour: number;
  failingInstances: number;
  staleInstances: number;
  pipelineStats: PipelineStat[];
  recentFailures: FailingInstanceSummary[];
}

export interface SyncClient {
  id: string;
  name: string;
}
