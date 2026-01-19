import type { IntegrationType } from './integrations.js';

// A sync pipeline definition - what data we sync from which integration
export interface SyncPipeline {
  id: string;
  name: string; // "Procore Projects", "Gusto Employees"
  integration: IntegrationType;
  dataType: string; // "projects", "employees", "timecards", "invoices"
  direction: 'pull' | 'push';
  description: string;
  schedule: {
    intervalMinutes: number; // How often to sync
    staleThresholdMinutes: number; // When to warn about stale data
  };
}

// Status of a sync instance
export type SyncInstanceStatus = 'healthy' | 'stale' | 'failing' | 'disabled';

// A client's instance of a sync pipeline
export interface SyncInstance {
  id: string;
  clientId: string;
  clientName: string;
  pipelineId: string;
  pipeline: SyncPipeline;
  status: SyncInstanceStatus;
  enabled: boolean;
  lastSync: SyncExecutionSummary | null;
  nextScheduledSync: Date;
  stats: {
    last24h: SyncStats;
    last7d: SyncStats;
  };
  recentExecutions: SyncExecutionSummary[]; // Last 10 for sparkline
}

export interface SyncStats {
  totalSyncs: number;
  successfulSyncs: number;
  failedSyncs: number;
  successRate: number;
  avgDurationMs: number;
  totalRecordsProcessed: number;
}

// Execution status
export type SyncExecutionStatus = 'running' | 'success' | 'partial' | 'failed';

// Summary of a sync execution (for lists)
export interface SyncExecutionSummary {
  id: string;
  instanceId: string;
  pipelineId: string;
  startedAt: Date;
  completedAt: Date | null;
  status: SyncExecutionStatus;
  durationMs: number;
  recordsProcessed: number;
  errors: number;
  warnings: number;
}

// Full sync execution with request/response details
export interface SyncExecution {
  id: string;
  instanceId: string;
  pipelineId: string;
  clientId: string;
  clientName: string;
  pipeline: SyncPipeline;
  startedAt: Date;
  completedAt: Date | null;
  status: SyncExecutionStatus;
  triggeredBy: 'schedule' | 'manual' | 'webhook';

  // Request details
  request: {
    url: string;
    method: string;
    headers: Record<string, string>; // Sanitized (no auth tokens shown)
    params: Record<string, string>;
    timestamp: Date;
  };

  // Response details
  response: {
    statusCode: number;
    statusText: string;
    headers: Record<string, string>;
    bodyPreview: string; // First 1KB or so
    bodySize: number;
    durationMs: number;
    timestamp: Date;
  } | null;

  // Processing results
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

export interface SyncError {
  id: string;
  recordId?: string;
  recordName?: string;
  message: string;
  code: string;
  context: Record<string, unknown>;
  retryable: boolean;
  timestamp: Date;
}

export interface SyncWarning {
  id: string;
  recordId?: string;
  recordName?: string;
  message: string;
  code: string;
  timestamp: Date;
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
  timestamp: Date;
}

// Company-wide sync overview for support/engineering
export interface SyncSystemOverview {
  overallHealth: number; // Percentage
  activeClients: number;
  totalSyncsLast24h: number;
  syncsPerHour: number;
  failingInstances: number;
  staleInstances: number;
  pipelineStats: PipelineStat[];
  recentFailures: FailingInstanceSummary[];
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
  failingSince: Date;
  consecutiveFailures: number;
}
