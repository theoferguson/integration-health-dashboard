import { useState, useEffect, useCallback } from 'react';
import type {
  SyncSystemOverview,
  SyncInstance,
  SyncExecution,
  SyncInstanceStatus,
  SyncClient,
  PipelineStat,
} from '../types';
import {
  fetchSyncOverview,
  fetchSyncInstances,
  fetchSyncClients,
  fetchSyncExecution,
  triggerManualSync,
} from '../api/client';

const integrationLabels: Record<string, string> = {
  procore: 'Procore',
  gusto: 'Gusto',
  quickbooks: 'QuickBooks',
  stripe_issuing: 'Stripe Issuing',
  certified_payroll: 'Certified Payroll',
};

const statusColors: Record<SyncInstanceStatus, string> = {
  healthy: 'bg-green-100 text-green-800 border-green-200',
  stale: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  failing: 'bg-red-100 text-red-800 border-red-200',
  disabled: 'bg-gray-100 text-gray-600 border-gray-200',
};

const statusDotColors: Record<SyncInstanceStatus, string> = {
  healthy: 'bg-green-500',
  stale: 'bg-yellow-500',
  failing: 'bg-red-500',
  disabled: 'bg-gray-400',
};

function formatRelativeTime(dateString: string | null): string {
  if (!dateString) return 'Never';
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

interface DataSyncDashboardProps {
  onRefresh: () => void;
}

export function DataSyncDashboard({ onRefresh }: DataSyncDashboardProps) {
  const [overview, setOverview] = useState<SyncSystemOverview | null>(null);
  const [instances, setInstances] = useState<SyncInstance[]>([]);
  const [clients, setClients] = useState<SyncClient[]>([]);
  const [selectedClient, setSelectedClient] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<SyncInstanceStatus | 'all'>('all');
  const [selectedExecution, setSelectedExecution] = useState<SyncExecution | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [overviewData, clientsData, instancesData] = await Promise.all([
        fetchSyncOverview(),
        fetchSyncClients(),
        fetchSyncInstances({
          clientId: selectedClient !== 'all' ? selectedClient : undefined,
          status: statusFilter !== 'all' ? statusFilter : undefined,
        }),
      ]);

      setOverview(overviewData.overview);
      setClients(clientsData.clients);
      setInstances(instancesData.instances);
      setError(null);
    } catch {
      setError('Failed to load sync data');
    } finally {
      setIsLoading(false);
    }
  }, [selectedClient, statusFilter]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleTriggerSync = async (instanceId: string) => {
    setIsSyncing(instanceId);
    try {
      await triggerManualSync(instanceId);
      await loadData();
    } catch {
      setError('Failed to trigger sync');
    } finally {
      setIsSyncing(null);
    }
  };

  const handleViewExecution = async (executionId: string) => {
    try {
      const { execution } = await fetchSyncExecution(executionId);
      setSelectedExecution(execution);
    } catch {
      setError('Failed to load execution details');
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="animate-spin h-8 w-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-gray-600">Loading sync status...</p>
        </div>
      </div>
    );
  }

  if (error && !overview) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
          {error}
        </div>
      )}

      {/* System Overview */}
      {overview && (
        <section>
          <h2 className="text-base sm:text-lg font-semibold text-gray-900 mb-3 sm:mb-4">System Overview</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-4">
            <OverviewCard
              label="Overall Health"
              value={`${Math.round(overview.overallHealth)}%`}
              color={overview.overallHealth >= 90 ? 'green' : overview.overallHealth >= 70 ? 'yellow' : 'red'}
            />
            <OverviewCard label="Active Clients" value={overview.activeClients} />
            <OverviewCard label="Syncs (24h)" value={overview.totalSyncsLast24h} />
            <OverviewCard label="Syncs/Hour" value={overview.syncsPerHour.toFixed(1)} />
            <OverviewCard
              label="Failing"
              value={overview.failingInstances}
              color={overview.failingInstances > 0 ? 'red' : 'green'}
            />
            <OverviewCard
              label="Stale"
              value={overview.staleInstances}
              color={overview.staleInstances > 0 ? 'yellow' : 'green'}
            />
          </div>
        </section>
      )}

      {/* Pipeline Stats */}
      {overview && overview.pipelineStats.length > 0 && (
        <section>
          <h2 className="text-base sm:text-lg font-semibold text-gray-900 mb-3 sm:mb-4">Pipeline Health</h2>
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Pipeline</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Integration</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Instances</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Health</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Success Rate</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Syncs (24h)</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Avg Duration</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {overview.pipelineStats.map((stat) => (
                  <PipelineRow key={stat.pipeline.id} stat={stat} />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Failing Instances Alert */}
      {overview && overview.recentFailures.length > 0 && (
        <section>
          <h2 className="text-base sm:text-lg font-semibold text-gray-900 mb-3 sm:mb-4 flex items-center gap-2">
            <span className="h-2 w-2 bg-red-500 rounded-full animate-pulse" />
            Failing Instances
          </h2>
          <div className="bg-red-50 border border-red-200 rounded-lg divide-y divide-red-200">
            {overview.recentFailures.map((failure) => (
              <div key={failure.instanceId} className="p-3 sm:p-4">
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                  <div>
                    <div className="font-medium text-red-900 text-sm sm:text-base">{failure.clientName}</div>
                    <div className="text-xs sm:text-sm text-red-700">
                      {failure.pipeline.name} ({integrationLabels[failure.pipeline.integration]})
                    </div>
                    <div className="text-xs sm:text-sm text-red-600 mt-1 break-words">{failure.lastError}</div>
                  </div>
                  <div className="text-left sm:text-right text-xs sm:text-sm flex sm:flex-col gap-2 sm:gap-0 flex-wrap">
                    <div className="text-red-700">{failure.consecutiveFailures} failures</div>
                    <div className="text-red-600">Since {formatRelativeTime(failure.failingSince)}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Filters */}
      <section>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
          <h2 className="text-base sm:text-lg font-semibold text-gray-900">Sync Instances</h2>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3">
            <select
              value={selectedClient}
              onChange={(e) => setSelectedClient(e.target.value)}
              className="px-3 py-1.5 text-xs sm:text-sm border border-gray-300 rounded-lg bg-white"
            >
              <option value="all">All Clients</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>{client.name}</option>
              ))}
            </select>
            <div className="flex items-center gap-0.5 sm:gap-1 bg-gray-100 rounded-lg p-1 overflow-x-auto">
              {(['all', 'healthy', 'stale', 'failing', 'disabled'] as const).map((status) => (
                <button
                  key={status}
                  onClick={() => setStatusFilter(status)}
                  className={`px-2 sm:px-3 py-1 text-xs sm:text-sm rounded-md transition-colors whitespace-nowrap ${
                    statusFilter === status
                      ? 'bg-white shadow text-gray-900'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  {status.charAt(0).toUpperCase() + status.slice(1)}
                </button>
              ))}
            </div>
            <button
              onClick={() => { loadData(); onRefresh(); }}
              className="px-3 py-1.5 text-xs sm:text-sm text-gray-600 hover:text-gray-900 border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Refresh
            </button>
          </div>
        </div>

        {/* Instance List */}
        <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-200">
          {instances.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              No sync instances found matching your filters.
            </div>
          ) : (
            instances.map((instance) => (
              <InstanceRow
                key={instance.id}
                instance={instance}
                isSyncing={isSyncing === instance.id}
                onTriggerSync={handleTriggerSync}
                onViewExecution={handleViewExecution}
              />
            ))
          )}
        </div>
      </section>

      {/* Execution Detail Modal */}
      {selectedExecution && (
        <ExecutionModal
          execution={selectedExecution}
          onClose={() => setSelectedExecution(null)}
        />
      )}
    </div>
  );
}

function OverviewCard({
  label,
  value,
  color = 'gray',
}: {
  label: string;
  value: string | number;
  color?: 'green' | 'yellow' | 'red' | 'gray';
}) {
  const colorClasses = {
    green: 'text-green-600',
    yellow: 'text-yellow-600',
    red: 'text-red-600',
    gray: 'text-gray-900',
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-2 sm:p-4">
      <div className="text-xs sm:text-sm text-gray-500 truncate">{label}</div>
      <div className={`text-lg sm:text-2xl font-semibold ${colorClasses[color]}`}>{value}</div>
    </div>
  );
}

function PipelineRow({ stat }: { stat: PipelineStat }) {
  const healthPercent = stat.totalInstances > 0
    ? Math.round((stat.healthyInstances / stat.totalInstances) * 100)
    : 100;

  return (
    <tr>
      <td className="px-4 py-3">
        <div className="font-medium text-gray-900">{stat.pipeline.name}</div>
        <div className="text-xs text-gray-500">{stat.pipeline.description}</div>
      </td>
      <td className="px-4 py-3 text-sm text-gray-600">
        {integrationLabels[stat.pipeline.integration]}
      </td>
      <td className="px-4 py-3 text-center">
        <div className="flex items-center justify-center gap-1 text-sm">
          <span className="text-green-600">{stat.healthyInstances}</span>
          <span className="text-gray-400">/</span>
          {stat.staleInstances > 0 && (
            <>
              <span className="text-yellow-600">{stat.staleInstances}</span>
              <span className="text-gray-400">/</span>
            </>
          )}
          {stat.failingInstances > 0 && (
            <span className="text-red-600">{stat.failingInstances}</span>
          )}
          {stat.staleInstances === 0 && stat.failingInstances === 0 && (
            <span className="text-gray-400">{stat.totalInstances}</span>
          )}
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center justify-center">
          <div className="w-16 bg-gray-200 rounded-full h-2">
            <div
              className={`h-2 rounded-full ${
                healthPercent >= 90 ? 'bg-green-500' : healthPercent >= 70 ? 'bg-yellow-500' : 'bg-red-500'
              }`}
              style={{ width: `${healthPercent}%` }}
            />
          </div>
          <span className="ml-2 text-xs text-gray-600">{healthPercent}%</span>
        </div>
      </td>
      <td className="px-4 py-3 text-center text-sm">
        <span className={stat.successRate >= 95 ? 'text-green-600' : stat.successRate >= 80 ? 'text-yellow-600' : 'text-red-600'}>
          {stat.successRate.toFixed(1)}%
        </span>
      </td>
      <td className="px-4 py-3 text-center text-sm text-gray-600">
        {stat.syncsLast24h}
      </td>
      <td className="px-4 py-3 text-center text-sm text-gray-600">
        {formatDuration(stat.avgDurationMs)}
      </td>
    </tr>
  );
}

function InstanceRow({
  instance,
  isSyncing,
  onTriggerSync,
  onViewExecution,
}: {
  instance: SyncInstance;
  isSyncing: boolean;
  onTriggerSync: (id: string) => void;
  onViewExecution: (executionId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div>
      <div
        className="p-3 sm:p-4 hover:bg-gray-50 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-4">
          <div className="flex items-center gap-2 sm:gap-3">
            <span className={`h-2 w-2 sm:h-2.5 sm:w-2.5 rounded-full flex-shrink-0 ${statusDotColors[instance.status]}`} />
            <div className="min-w-0">
              <div className="font-medium text-gray-900 text-sm sm:text-base truncate">{instance.clientName}</div>
              <div className="text-xs sm:text-sm text-gray-500 truncate">
                {instance.pipeline.name} ({integrationLabels[instance.pipeline.integration]})
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between sm:justify-end gap-2 sm:gap-4 ml-4 sm:ml-0">
            <div className="text-left sm:text-right min-w-0">
              <div className="text-xs sm:text-sm text-gray-900">
                Last: {formatRelativeTime(instance.lastSync?.completedAt ?? null)}
              </div>
              <div className="text-xs text-gray-500 hidden sm:block">
                {instance.stats.last24h.totalSyncs} syncs ({instance.stats.last24h.successRate.toFixed(0)}%)
              </div>
            </div>

            <span className={`px-1.5 sm:px-2 py-0.5 sm:py-1 text-xs font-medium rounded-full border whitespace-nowrap ${statusColors[instance.status]}`}>
              {instance.status}
            </span>

            <button
              onClick={(e) => {
                e.stopPropagation();
                onTriggerSync(instance.id);
              }}
              disabled={isSyncing || !instance.enabled}
              className="px-2 sm:px-3 py-1 text-xs sm:text-sm text-blue-600 hover:text-blue-700 border border-blue-300 rounded-lg hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
            >
              {isSyncing ? 'Syncing...' : 'Sync'}
            </button>

            <svg
              className={`w-4 h-4 sm:w-5 sm:h-5 text-gray-400 transition-transform flex-shrink-0 ${expanded ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>
      </div>

      {expanded && (
        <div className="px-3 sm:px-4 pb-3 sm:pb-4 bg-gray-50 border-t border-gray-100">
          <div className="pt-3 sm:pt-4">
            <h4 className="text-xs sm:text-sm font-medium text-gray-700 mb-2">Recent Executions</h4>
            {instance.recentExecutions.length === 0 ? (
              <p className="text-xs sm:text-sm text-gray-500">No recent executions</p>
            ) : (
              <div className="space-y-2">
                {instance.recentExecutions.slice(0, 5).map((exec) => (
                  <div
                    key={exec.id}
                    className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-2 p-2 bg-white rounded border border-gray-200 hover:border-gray-300 cursor-pointer"
                    onClick={() => onViewExecution(exec.id)}
                  >
                    <div className="flex items-center gap-2 sm:gap-3">
                      <ExecutionStatusBadge status={exec.status} />
                      <span className="text-xs sm:text-sm text-gray-600">
                        {new Date(exec.startedAt).toLocaleString()}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 sm:gap-4 text-xs sm:text-sm text-gray-500 ml-0 sm:ml-0">
                      <span>{exec.recordsProcessed} records</span>
                      <span>{formatDuration(exec.durationMs)}</span>
                      {exec.errors > 0 && (
                        <span className="text-red-600">{exec.errors} errors</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-3 sm:mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
              <div>
                <h5 className="text-xs font-medium text-gray-500 uppercase mb-2">Last 24 Hours</h5>
                <div className="grid grid-cols-3 gap-2 text-xs sm:text-sm">
                  <div>
                    <div className="text-gray-500">Total</div>
                    <div className="font-medium">{instance.stats.last24h.totalSyncs}</div>
                  </div>
                  <div>
                    <div className="text-gray-500">Success</div>
                    <div className="font-medium text-green-600">{instance.stats.last24h.successfulSyncs}</div>
                  </div>
                  <div>
                    <div className="text-gray-500">Failed</div>
                    <div className="font-medium text-red-600">{instance.stats.last24h.failedSyncs}</div>
                  </div>
                </div>
              </div>
              <div>
                <h5 className="text-xs font-medium text-gray-500 uppercase mb-2">Last 7 Days</h5>
                <div className="grid grid-cols-3 gap-2 text-xs sm:text-sm">
                  <div>
                    <div className="text-gray-500">Total</div>
                    <div className="font-medium">{instance.stats.last7d.totalSyncs}</div>
                  </div>
                  <div>
                    <div className="text-gray-500">Rate</div>
                    <div className="font-medium">{instance.stats.last7d.successRate.toFixed(1)}%</div>
                  </div>
                  <div>
                    <div className="text-gray-500">Records</div>
                    <div className="font-medium">{instance.stats.last7d.totalRecordsProcessed.toLocaleString()}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ExecutionStatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    running: 'bg-blue-100 text-blue-700',
    success: 'bg-green-100 text-green-700',
    partial: 'bg-yellow-100 text-yellow-700',
    failed: 'bg-red-100 text-red-700',
  };

  return (
    <span className={`px-2 py-0.5 text-xs font-medium rounded ${colors[status] || 'bg-gray-100 text-gray-700'}`}>
      {status}
    </span>
  );
}

function ExecutionModal({
  execution,
  onClose,
}: {
  execution: SyncExecution;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-2 sm:p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[95vh] sm:max-h-[90vh] overflow-hidden flex flex-col">
        <div className="p-3 sm:p-4 border-b border-gray-200 flex items-center justify-between">
          <div className="min-w-0 flex-1">
            <h3 className="text-base sm:text-lg font-semibold text-gray-900">Execution Details</h3>
            <p className="text-xs sm:text-sm text-gray-500 truncate">
              {execution.clientName} - {execution.pipeline.name}
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg flex-shrink-0 ml-2">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-4 sm:space-y-6">
          {/* Summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
            <div>
              <div className="text-xs sm:text-sm text-gray-500">Status</div>
              <ExecutionStatusBadge status={execution.status} />
            </div>
            <div>
              <div className="text-xs sm:text-sm text-gray-500">Duration</div>
              <div className="font-medium text-sm">{formatDuration(execution.response?.durationMs || 0)}</div>
            </div>
            <div>
              <div className="text-xs sm:text-sm text-gray-500">Started</div>
              <div className="font-medium text-xs sm:text-sm">{new Date(execution.startedAt).toLocaleString()}</div>
            </div>
            <div>
              <div className="text-xs sm:text-sm text-gray-500">Triggered By</div>
              <div className="font-medium text-sm capitalize">{execution.triggeredBy}</div>
            </div>
          </div>

          {/* Request */}
          <div>
            <h4 className="text-sm font-medium text-gray-700 mb-2">Request</h4>
            <div className="bg-gray-900 rounded-lg p-4 text-sm font-mono">
              <div className="text-green-400">
                {execution.request.method} {execution.request.url}
              </div>
              <div className="text-gray-400 mt-2">
                {Object.entries(execution.request.headers).map(([key, value]) => (
                  <div key={key}>{key}: {value}</div>
                ))}
              </div>
              {Object.keys(execution.request.params).length > 0 && (
                <div className="text-gray-400 mt-2 border-t border-gray-700 pt-2">
                  Params: {JSON.stringify(execution.request.params)}
                </div>
              )}
            </div>
          </div>

          {/* Response */}
          {execution.response && (
            <div>
              <h4 className="text-sm font-medium text-gray-700 mb-2">Response</h4>
              <div className="bg-gray-900 rounded-lg p-4 text-sm font-mono">
                <div className={execution.response.statusCode < 400 ? 'text-green-400' : 'text-red-400'}>
                  {execution.response.statusCode} {execution.response.statusText}
                </div>
                <div className="text-gray-400 mt-2 text-xs">
                  {formatDuration(execution.response.durationMs)} - {(execution.response.bodySize / 1024).toFixed(1)} KB
                </div>
                <div className="text-gray-300 mt-2 border-t border-gray-700 pt-2 whitespace-pre-wrap">
                  {execution.response.bodyPreview}
                </div>
              </div>
            </div>
          )}

          {/* Results */}
          <div>
            <h4 className="text-xs sm:text-sm font-medium text-gray-700 mb-2">Results</h4>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 sm:gap-4 text-center">
              <div className="bg-gray-50 rounded-lg p-2 sm:p-3">
                <div className="text-lg sm:text-2xl font-semibold text-gray-900">{execution.results.recordsFetched}</div>
                <div className="text-xs text-gray-500">Fetched</div>
              </div>
              <div className="bg-green-50 rounded-lg p-2 sm:p-3">
                <div className="text-lg sm:text-2xl font-semibold text-green-600">{execution.results.recordsCreated}</div>
                <div className="text-xs text-gray-500">Created</div>
              </div>
              <div className="bg-blue-50 rounded-lg p-2 sm:p-3">
                <div className="text-lg sm:text-2xl font-semibold text-blue-600">{execution.results.recordsUpdated}</div>
                <div className="text-xs text-gray-500">Updated</div>
              </div>
              <div className="bg-gray-50 rounded-lg p-2 sm:p-3">
                <div className="text-lg sm:text-2xl font-semibold text-gray-600">{execution.results.recordsSkipped}</div>
                <div className="text-xs text-gray-500">Skipped</div>
              </div>
              <div className="bg-red-50 rounded-lg p-2 sm:p-3">
                <div className="text-lg sm:text-2xl font-semibold text-red-600">{execution.results.recordsFailed}</div>
                <div className="text-xs text-gray-500">Failed</div>
              </div>
            </div>
          </div>

          {/* Errors */}
          {execution.results.errors.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-red-700 mb-2">Errors ({execution.results.errors.length})</h4>
              <div className="space-y-2">
                {execution.results.errors.map((error) => (
                  <div key={error.id} className="bg-red-50 border border-red-200 rounded-lg p-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="font-medium text-red-900">{error.message}</div>
                        {error.recordName && (
                          <div className="text-sm text-red-700">Record: {error.recordName}</div>
                        )}
                        <div className="text-xs text-red-600 mt-1">Code: {error.code}</div>
                      </div>
                      {error.retryable && (
                        <span className="px-2 py-0.5 text-xs bg-red-100 text-red-700 rounded">Retryable</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Warnings */}
          {execution.results.warnings.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-yellow-700 mb-2">Warnings ({execution.results.warnings.length})</h4>
              <div className="space-y-2">
                {execution.results.warnings.map((warning) => (
                  <div key={warning.id} className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                    <div className="font-medium text-yellow-900">{warning.message}</div>
                    {warning.recordName && (
                      <div className="text-sm text-yellow-700">Record: {warning.recordName}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Changes */}
          {execution.results.changes.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-gray-700 mb-2">Changes ({execution.results.changes.length})</h4>
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {execution.results.changes.map((change) => (
                  <div key={change.id} className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 text-xs rounded ${
                        change.changeType === 'created' ? 'bg-green-100 text-green-700' :
                        change.changeType === 'updated' ? 'bg-blue-100 text-blue-700' :
                        'bg-red-100 text-red-700'
                      }`}>
                        {change.changeType}
                      </span>
                      <span className="font-medium text-gray-900">{change.recordName}</span>
                    </div>
                    {change.fields && change.fields.length > 0 && (
                      <div className="mt-2 text-sm">
                        {change.fields.map((field, i) => (
                          <div key={i} className="text-gray-600">
                            <span className="font-medium">{field.field}:</span>{' '}
                            <span className="text-red-600 line-through">{field.oldValue || 'null'}</span>{' '}
                            <span className="text-green-600">{field.newValue}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
