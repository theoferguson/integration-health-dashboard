/**
 * Sync Types
 * Shared type definitions for data sync pipelines
 */

import type { IntegrationType } from './integrations.js';

export type SyncInstanceStatus = 'healthy' | 'stale' | 'failing' | 'disabled';
export type SyncExecutionStatus = 'running' | 'success' | 'partial' | 'failed';
export type SyncDirection = 'pull' | 'push';
export type SyncTrigger = 'schedule' | 'manual' | 'webhook';
export type SyncChangeType = 'created' | 'updated' | 'deleted';

export interface SyncSchedule {
  intervalMinutes: number;
  staleThresholdMinutes: number;
}

export interface SyncPipeline {
  id: string;
  name: string;
  integration: IntegrationType;
  dataType: string;
  direction: SyncDirection;
  description: string;
  schedule: SyncSchedule;
}

export interface SyncStats {
  totalSyncs: number;
  successfulSyncs: number;
  failedSyncs: number;
  successRate: number;
  avgDurationMs: number;
  totalRecordsProcessed: number;
}

export interface SyncExecutionSummary {
  id: string;
  instanceId: string;
  pipelineId: string;
  startedAt: Date | string;
  completedAt: Date | string | null;
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
  nextScheduledSync: Date | string;
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
  timestamp: Date | string;
}

export interface SyncWarning {
  id: string;
  recordId?: string;
  recordName?: string;
  message: string;
  code: string;
  timestamp: Date | string;
}

export interface SyncFieldChange {
  field: string;
  oldValue: string | null;
  newValue: string;
}

export interface SyncChange {
  id: string;
  recordId: string;
  recordName: string;
  changeType: SyncChangeType;
  fields?: SyncFieldChange[];
  timestamp: Date | string;
}

export interface SyncRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  params: Record<string, string>;
  timestamp: Date | string;
}

export interface SyncResponse {
  statusCode: number;
  statusText: string;
  headers: Record<string, string>;
  bodyPreview: string;
  bodySize: number;
  durationMs: number;
  timestamp: Date | string;
}

export interface SyncResults {
  recordsFetched: number;
  recordsCreated: number;
  recordsUpdated: number;
  recordsSkipped: number;
  recordsFailed: number;
  errors: SyncError[];
  warnings: SyncWarning[];
  changes: SyncChange[];
}

export interface SyncExecution {
  id: string;
  instanceId: string;
  pipelineId: string;
  clientId: string;
  clientName: string;
  pipeline: SyncPipeline;
  startedAt: Date | string;
  completedAt: Date | string | null;
  status: SyncExecutionStatus;
  triggeredBy: SyncTrigger;
  request: SyncRequest;
  response: SyncResponse | null;
  results: SyncResults;
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
  failingSince: Date | string;
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
