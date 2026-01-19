import { randomUUID } from 'crypto';
import type {
  SyncPipeline,
  SyncInstance,
  SyncInstanceStatus,
  SyncExecution,
  SyncExecutionSummary,
  SyncExecutionStatus,
  SyncStats,
  SyncSystemOverview,
  PipelineStat,
  FailingInstanceSummary,
  SyncError,
  SyncWarning,
  SyncChange,
  IntegrationType,
} from '../types/index.js';

// In-memory storage
let pipelines: SyncPipeline[] = [];
let instances: SyncInstance[] = [];
let executions: SyncExecution[] = [];

// Default pipelines
const DEFAULT_PIPELINES: Omit<SyncPipeline, 'id'>[] = [
  {
    name: 'Procore Projects',
    integration: 'procore',
    dataType: 'projects',
    direction: 'pull',
    description: 'Sync project data including budgets, status, and team assignments',
    schedule: { intervalMinutes: 15, staleThresholdMinutes: 30 },
  },
  {
    name: 'Procore Cost Codes',
    integration: 'procore',
    dataType: 'cost_codes',
    direction: 'pull',
    description: 'Sync cost code structure for job costing',
    schedule: { intervalMinutes: 60, staleThresholdMinutes: 120 },
  },
  {
    name: 'Gusto Employees',
    integration: 'gusto',
    dataType: 'employees',
    direction: 'pull',
    description: 'Sync employee records, roles, and compensation data',
    schedule: { intervalMinutes: 30, staleThresholdMinutes: 60 },
  },
  {
    name: 'Gusto Timecards',
    integration: 'gusto',
    dataType: 'timecards',
    direction: 'pull',
    description: 'Sync timecard entries for payroll processing',
    schedule: { intervalMinutes: 15, staleThresholdMinutes: 30 },
  },
  {
    name: 'QuickBooks Invoices',
    integration: 'quickbooks',
    dataType: 'invoices',
    direction: 'pull',
    description: 'Sync invoice and payment data from accounting system',
    schedule: { intervalMinutes: 30, staleThresholdMinutes: 60 },
  },
  {
    name: 'QuickBooks GL Entries',
    integration: 'quickbooks',
    dataType: 'gl_entries',
    direction: 'pull',
    description: 'Sync general ledger entries for financial reporting',
    schedule: { intervalMinutes: 60, staleThresholdMinutes: 120 },
  },
  {
    name: 'Stripe Transactions',
    integration: 'stripe_issuing',
    dataType: 'transactions',
    direction: 'pull',
    description: 'Sync card transactions and authorizations',
    schedule: { intervalMinutes: 5, staleThresholdMinutes: 15 },
  },
];

// Sample client names for demo
const CLIENT_NAMES = [
  'Acme Construction',
  'BuildRight Inc',
  'Metro Builders',
  'Summit Contractors',
  'Pacific Construction Co',
  'Valley Infrastructure',
  'Coastal Development',
  'Mountain View Builders',
];

// Initialize with default pipelines
function initializePipelines(): void {
  if (pipelines.length === 0) {
    pipelines = DEFAULT_PIPELINES.map((p) => ({
      ...p,
      id: `pipeline_${p.integration}_${p.dataType}`,
    }));
  }
}

// Generate mock data
export function generateMockData(options: { clientCount?: number; introduceFailures?: boolean } = {}): void {
  const { clientCount = 5, introduceFailures = true } = options;

  initializePipelines();

  // Clear existing data
  instances = [];
  executions = [];

  const now = new Date();

  // Create instances for each client
  for (let i = 0; i < clientCount; i++) {
    const clientId = `client_${i + 1}`;
    const clientName = CLIENT_NAMES[i % CLIENT_NAMES.length];

    for (const pipeline of pipelines) {
      const instanceId = `${clientId}_${pipeline.id}`;

      // Determine instance status - most healthy, some stale, few failing
      let status: SyncInstanceStatus = 'healthy';
      let shouldFail = false;
      let shouldBeStale = false;

      if (introduceFailures) {
        const rand = Math.random();
        if (rand > 0.95) {
          status = 'failing';
          shouldFail = true;
        } else if (rand > 0.88) {
          status = 'stale';
          shouldBeStale = true;
        }
      }

      // Generate execution history (last 24 hours)
      const executionHistory: SyncExecution[] = [];
      const executionsPerDay = Math.floor((24 * 60) / pipeline.schedule.intervalMinutes);

      for (let j = 0; j < Math.min(executionsPerDay, 20); j++) {
        const hoursAgo = (j * pipeline.schedule.intervalMinutes) / 60;
        const startTime = new Date(now.getTime() - hoursAgo * 60 * 60 * 1000);

        // Most recent execution might be failing or stale
        const isMostRecent = j === 0;
        let execStatus: SyncExecutionStatus = 'success';

        if (isMostRecent && shouldFail) {
          execStatus = 'failed';
        } else if (Math.random() > 0.97) {
          execStatus = 'failed';
        } else if (Math.random() > 0.95) {
          execStatus = 'partial';
        }

        const execution = generateExecution({
          instanceId,
          pipelineId: pipeline.id,
          clientId,
          clientName,
          pipeline,
          startedAt: startTime,
          status: execStatus,
        });

        executionHistory.push(execution);
        executions.push(execution);
      }

      // Calculate stats from executions
      const last24hExecutions = executionHistory.filter(
        (e) => e.startedAt.getTime() > now.getTime() - 24 * 60 * 60 * 1000
      );

      const stats24h = calculateStats(last24hExecutions);

      // Calculate when last sync was and next sync
      const lastExec = executionHistory[0];
      const lastSyncTime = lastExec?.completedAt || lastExec?.startedAt || now;

      let nextSync = new Date(lastSyncTime.getTime() + pipeline.schedule.intervalMinutes * 60 * 1000);

      // If stale, make last sync older
      if (shouldBeStale) {
        const staleMinutes = pipeline.schedule.staleThresholdMinutes + Math.floor(Math.random() * 30);
        nextSync = new Date(now.getTime() - staleMinutes * 60 * 1000);
      }

      const instance: SyncInstance = {
        id: instanceId,
        clientId,
        clientName,
        pipelineId: pipeline.id,
        pipeline,
        status,
        enabled: true,
        lastSync: lastExec ? executionToSummary(lastExec) : null,
        nextScheduledSync: nextSync,
        stats: {
          last24h: stats24h,
          last7d: { ...stats24h, totalSyncs: stats24h.totalSyncs * 7 }, // Simplified
        },
        recentExecutions: executionHistory.slice(0, 10).map(executionToSummary),
      };

      instances.push(instance);
    }
  }
}

function generateExecution(params: {
  instanceId: string;
  pipelineId: string;
  clientId: string;
  clientName: string;
  pipeline: SyncPipeline;
  startedAt: Date;
  status: SyncExecutionStatus;
}): SyncExecution {
  const { instanceId, pipelineId, clientId, clientName, pipeline, startedAt, status } = params;

  const durationMs = 500 + Math.floor(Math.random() * 2500);
  const completedAt = new Date(startedAt.getTime() + durationMs);

  const recordsFetched = 10 + Math.floor(Math.random() * 90);
  const recordsCreated = Math.floor(Math.random() * 3);
  const recordsUpdated = Math.floor(Math.random() * 10);
  const recordsFailed = status === 'failed' ? Math.floor(Math.random() * 5) + 1 : 0;
  const recordsSkipped = recordsFetched - recordsCreated - recordsUpdated - recordsFailed;

  // Generate errors for failed executions
  const errors: SyncError[] = [];
  const warnings: SyncWarning[] = [];
  const changes: SyncChange[] = [];

  if (status === 'failed') {
    const errorTypes = [
      { code: 'AUTH_EXPIRED', message: 'OAuth token expired. Re-authentication required.' },
      { code: 'RATE_LIMITED', message: 'API rate limit exceeded. Retry after 60 seconds.' },
      { code: 'TIMEOUT', message: 'Request timeout after 30000ms.' },
      { code: 'INVALID_RESPONSE', message: 'Unexpected response format from API.' },
      { code: 'CONNECTION_ERROR', message: 'Failed to establish connection to remote server.' },
    ];
    const error = errorTypes[Math.floor(Math.random() * errorTypes.length)];
    errors.push({
      id: randomUUID(),
      message: error.message,
      code: error.code,
      context: { pipeline: pipeline.name, attempt: 1 },
      retryable: error.code !== 'AUTH_EXPIRED',
      timestamp: completedAt,
    });
  }

  if (status === 'partial' || Math.random() > 0.9) {
    warnings.push({
      id: randomUUID(),
      message: 'Some records have missing optional fields',
      code: 'INCOMPLETE_DATA',
      timestamp: completedAt,
    });
  }

  // Generate sample changes
  if (recordsCreated > 0) {
    changes.push({
      id: randomUUID(),
      recordId: `rec_${Math.floor(Math.random() * 10000)}`,
      recordName: `New ${pipeline.dataType.replace('_', ' ')} record`,
      changeType: 'created',
      timestamp: completedAt,
    });
  }

  if (recordsUpdated > 0) {
    changes.push({
      id: randomUUID(),
      recordId: `rec_${Math.floor(Math.random() * 10000)}`,
      recordName: `Updated ${pipeline.dataType.replace('_', ' ')} record`,
      changeType: 'updated',
      fields: [
        { field: 'status', oldValue: 'pending', newValue: 'active' },
      ],
      timestamp: completedAt,
    });
  }

  // Build API URL based on integration
  const apiUrls: Record<IntegrationType, string> = {
    procore: 'https://api.procore.com/rest/v1.0',
    gusto: 'https://api.gusto.com/v1',
    quickbooks: 'https://quickbooks.api.intuit.com/v3',
    stripe_issuing: 'https://api.stripe.com/v1/issuing',
    certified_payroll: 'https://api.lcptracker.com/v2',
  };

  const baseUrl = apiUrls[pipeline.integration];
  const endpoint = `${baseUrl}/${pipeline.dataType}`;

  return {
    id: randomUUID(),
    instanceId,
    pipelineId,
    clientId,
    clientName,
    pipeline,
    startedAt,
    completedAt: status === 'running' ? null : completedAt,
    status,
    triggeredBy: 'schedule',
    request: {
      url: endpoint,
      method: 'GET',
      headers: {
        'Authorization': 'Bearer ****redacted****',
        'Accept': 'application/json',
        'X-Request-Id': randomUUID(),
      },
      params: {
        per_page: '100',
        updated_since: new Date(startedAt.getTime() - 24 * 60 * 60 * 1000).toISOString(),
      },
      timestamp: startedAt,
    },
    response: status === 'running' ? null : {
      statusCode: status === 'failed' ? (errors[0]?.code === 'RATE_LIMITED' ? 429 : 401) : 200,
      statusText: status === 'failed' ? 'Error' : 'OK',
      headers: {
        'X-RateLimit-Remaining': String(Math.floor(Math.random() * 1000)),
        'X-Total-Count': String(recordsFetched),
        'Content-Type': 'application/json',
      },
      bodyPreview: status === 'failed'
        ? JSON.stringify({ error: errors[0]?.message || 'Unknown error' })
        : `[{"id":${Math.floor(Math.random() * 10000)},"name":"Sample Record","updated_at":"${completedAt.toISOString()}"},...]`,
      bodySize: 1024 + Math.floor(Math.random() * 50000),
      durationMs,
      timestamp: completedAt,
    },
    results: {
      recordsFetched,
      recordsCreated,
      recordsUpdated,
      recordsSkipped,
      recordsFailed,
      errors,
      warnings,
      changes,
    },
  };
}

function executionToSummary(execution: SyncExecution): SyncExecutionSummary {
  return {
    id: execution.id,
    instanceId: execution.instanceId,
    pipelineId: execution.pipelineId,
    startedAt: execution.startedAt,
    completedAt: execution.completedAt,
    status: execution.status,
    durationMs: execution.response?.durationMs || 0,
    recordsProcessed: execution.results.recordsFetched,
    errors: execution.results.errors.length,
    warnings: execution.results.warnings.length,
  };
}

function calculateStats(executions: SyncExecution[]): SyncStats {
  if (executions.length === 0) {
    return {
      totalSyncs: 0,
      successfulSyncs: 0,
      failedSyncs: 0,
      successRate: 100,
      avgDurationMs: 0,
      totalRecordsProcessed: 0,
    };
  }

  const successful = executions.filter((e) => e.status === 'success' || e.status === 'partial').length;
  const failed = executions.filter((e) => e.status === 'failed').length;
  const totalDuration = executions.reduce((sum, e) => sum + (e.response?.durationMs || 0), 0);
  const totalRecords = executions.reduce((sum, e) => sum + e.results.recordsFetched, 0);

  return {
    totalSyncs: executions.length,
    successfulSyncs: successful,
    failedSyncs: failed,
    successRate: (successful / executions.length) * 100,
    avgDurationMs: totalDuration / executions.length,
    totalRecordsProcessed: totalRecords,
  };
}

// Getters
export function getPipelines(): SyncPipeline[] {
  initializePipelines();
  return pipelines;
}

export function getPipeline(id: string): SyncPipeline | undefined {
  initializePipelines();
  return pipelines.find((p) => p.id === id);
}

export function getInstances(filters?: { clientId?: string; pipelineId?: string; status?: SyncInstanceStatus }): SyncInstance[] {
  let result = [...instances];

  if (filters?.clientId) {
    result = result.filter((i) => i.clientId === filters.clientId);
  }
  if (filters?.pipelineId) {
    result = result.filter((i) => i.pipelineId === filters.pipelineId);
  }
  if (filters?.status) {
    result = result.filter((i) => i.status === filters.status);
  }

  return result;
}

export function getInstance(id: string): SyncInstance | undefined {
  return instances.find((i) => i.id === id);
}

export function getExecutions(filters?: { instanceId?: string; pipelineId?: string; status?: SyncExecutionStatus; limit?: number }): SyncExecution[] {
  let result = [...executions];

  if (filters?.instanceId) {
    result = result.filter((e) => e.instanceId === filters.instanceId);
  }
  if (filters?.pipelineId) {
    result = result.filter((e) => e.pipelineId === filters.pipelineId);
  }
  if (filters?.status) {
    result = result.filter((e) => e.status === filters.status);
  }

  // Sort by most recent first
  result.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());

  if (filters?.limit) {
    result = result.slice(0, filters.limit);
  }

  return result;
}

export function getExecution(id: string): SyncExecution | undefined {
  return executions.find((e) => e.id === id);
}

export function getSystemOverview(): SyncSystemOverview {
  initializePipelines();

  const now = new Date();
  const last24h = now.getTime() - 24 * 60 * 60 * 1000;

  const allInstances = instances;
  const healthyInstances = allInstances.filter((i) => i.status === 'healthy').length;
  const staleInstances = allInstances.filter((i) => i.status === 'stale').length;
  const failingInstances = allInstances.filter((i) => i.status === 'failing').length;

  const recentExecutions = executions.filter((e) => e.startedAt.getTime() > last24h);
  const successfulRecent = recentExecutions.filter((e) => e.status === 'success' || e.status === 'partial').length;

  // Calculate per-pipeline stats
  const pipelineStats: PipelineStat[] = pipelines.map((pipeline) => {
    const pipelineInstances = allInstances.filter((i) => i.pipelineId === pipeline.id);
    const pipelineExecutions = recentExecutions.filter((e) => e.pipelineId === pipeline.id);
    const successfulPipelineExecs = pipelineExecutions.filter((e) => e.status === 'success' || e.status === 'partial').length;

    return {
      pipeline,
      totalInstances: pipelineInstances.length,
      healthyInstances: pipelineInstances.filter((i) => i.status === 'healthy').length,
      staleInstances: pipelineInstances.filter((i) => i.status === 'stale').length,
      failingInstances: pipelineInstances.filter((i) => i.status === 'failing').length,
      successRate: pipelineExecutions.length > 0 ? (successfulPipelineExecs / pipelineExecutions.length) * 100 : 100,
      syncsLast24h: pipelineExecutions.length,
      avgDurationMs: pipelineExecutions.length > 0
        ? pipelineExecutions.reduce((sum, e) => sum + (e.response?.durationMs || 0), 0) / pipelineExecutions.length
        : 0,
    };
  });

  // Get recent failures
  const recentFailures: FailingInstanceSummary[] = allInstances
    .filter((i) => i.status === 'failing')
    .map((i) => {
      const lastError = i.lastSync?.status === 'failed'
        ? executions.find((e) => e.id === i.lastSync?.id)?.results.errors[0]?.message || 'Unknown error'
        : 'Unknown error';

      return {
        instanceId: i.id,
        clientId: i.clientId,
        clientName: i.clientName,
        pipeline: i.pipeline,
        lastError,
        failingSince: i.lastSync?.startedAt || now,
        consecutiveFailures: 1 + Math.floor(Math.random() * 5),
      };
    })
    .slice(0, 10);

  // Get unique client IDs
  const uniqueClients = new Set(allInstances.map((i) => i.clientId));

  return {
    overallHealth: recentExecutions.length > 0 ? (successfulRecent / recentExecutions.length) * 100 : 100,
    activeClients: uniqueClients.size,
    totalSyncsLast24h: recentExecutions.length,
    syncsPerHour: recentExecutions.length / 24,
    failingInstances,
    staleInstances,
    pipelineStats,
    recentFailures,
  };
}

// Trigger a manual sync (simulated)
export function triggerSync(instanceId: string): SyncExecution | null {
  const instance = getInstance(instanceId);
  if (!instance) return null;

  const execution = generateExecution({
    instanceId: instance.id,
    pipelineId: instance.pipelineId,
    clientId: instance.clientId,
    clientName: instance.clientName,
    pipeline: instance.pipeline,
    startedAt: new Date(),
    status: Math.random() > 0.1 ? 'success' : 'failed', // 90% success for manual
  });

  // Update as manual trigger
  execution.triggeredBy = 'manual';

  executions.unshift(execution);

  // Update instance
  instance.lastSync = executionToSummary(execution);
  instance.status = execution.status === 'failed' ? 'failing' : 'healthy';
  instance.nextScheduledSync = new Date(Date.now() + instance.pipeline.schedule.intervalMinutes * 60 * 1000);
  instance.recentExecutions = [executionToSummary(execution), ...instance.recentExecutions.slice(0, 9)];

  return execution;
}

// Get unique clients
export function getClients(): { id: string; name: string }[] {
  const clientMap = new Map<string, string>();
  for (const instance of instances) {
    clientMap.set(instance.clientId, instance.clientName);
  }
  return Array.from(clientMap.entries()).map(([id, name]) => ({ id, name }));
}
