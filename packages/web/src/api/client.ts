import type { Integration, IntegrationEvent, HealthOverview, ResolutionStatus } from '../types';

const API_BASE = '/api';

export async function fetchIntegrations(): Promise<Integration[]> {
  const response = await fetch(`${API_BASE}/integrations`);
  const data = await response.json();
  return data.integrations;
}

export async function fetchHealth(): Promise<{
  health: HealthOverview;
  integrations: Integration[];
}> {
  const response = await fetch(`${API_BASE}/integrations/health`);
  return response.json();
}

export async function fetchEvents(options?: {
  integration?: string;
  status?: 'success' | 'failure';
  resolutionStatus?: ResolutionStatus;
  limit?: number;
}): Promise<IntegrationEvent[]> {
  const params = new URLSearchParams();
  if (options?.integration) params.set('integration', options.integration);
  if (options?.status) params.set('status', options.status);
  if (options?.resolutionStatus) params.set('resolution_status', options.resolutionStatus);
  if (options?.limit) params.set('limit', options.limit.toString());

  const response = await fetch(`${API_BASE}/events?${params}`);
  const data = await response.json();
  return data.events;
}

export type SortField = 'timestamp' | 'integration' | 'eventType' | 'status';
export type SortOrder = 'asc' | 'desc';

export interface PaginatedEventsResponse {
  events: IntegrationEvent[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

export async function fetchEventsPaginated(options?: {
  integration?: string;
  status?: 'success' | 'failure';
  resolutionStatus?: ResolutionStatus;
  limit?: number;
  offset?: number;
  sortBy?: SortField;
  sortOrder?: SortOrder;
  search?: string;
}): Promise<PaginatedEventsResponse> {
  const params = new URLSearchParams();
  if (options?.integration) params.set('integration', options.integration);
  if (options?.status) params.set('status', options.status);
  if (options?.resolutionStatus) params.set('resolution_status', options.resolutionStatus);
  if (options?.limit) params.set('limit', options.limit.toString());
  if (options?.offset) params.set('offset', options.offset.toString());
  if (options?.sortBy) params.set('sort_by', options.sortBy);
  if (options?.sortOrder) params.set('sort_order', options.sortOrder);
  if (options?.search) params.set('search', options.search);

  const response = await fetch(`${API_BASE}/events/paginated?${params}`);
  return response.json();
}

export async function classifyEvent(
  eventId: string
): Promise<{ event: IntegrationEvent; cached: boolean }> {
  const response = await fetch(`${API_BASE}/events/${eventId}/classify`, {
    method: 'POST',
  });
  return response.json();
}

export async function acknowledgeEvent(
  eventId: string,
  acknowledgedBy?: string
): Promise<{ event: IntegrationEvent }> {
  const response = await fetch(`${API_BASE}/events/${eventId}/acknowledge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ acknowledged_by: acknowledgedBy }),
  });
  return response.json();
}

export async function resolveEvent(
  eventId: string,
  resolvedBy?: string,
  notes?: string
): Promise<{ event: IntegrationEvent }> {
  const response = await fetch(`${API_BASE}/events/${eventId}/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resolved_by: resolvedBy, notes }),
  });
  return response.json();
}

export async function reopenEvent(
  eventId: string
): Promise<{ event: IntegrationEvent }> {
  const response = await fetch(`${API_BASE}/events/${eventId}/reopen`, {
    method: 'POST',
  });
  return response.json();
}

export async function runSimulation(mode: 'demo' | 'all' = 'demo'): Promise<void> {
  // This triggers the simulator via the API
  // In production, this would be an admin endpoint
  await fetch(`${API_BASE}/simulate?mode=${mode}`, { method: 'POST' });
}

// Sync API
import type {
  SyncSystemOverview,
  SyncPipeline,
  SyncInstance,
  SyncExecution,
  SyncClient,
  SyncInstanceStatus,
} from '../types';

export async function fetchSyncOverview(): Promise<{ overview: SyncSystemOverview }> {
  const response = await fetch(`${API_BASE}/sync/overview`);
  return response.json();
}

export async function fetchSyncPipelines(): Promise<{ pipelines: SyncPipeline[] }> {
  const response = await fetch(`${API_BASE}/sync/pipelines`);
  return response.json();
}

export async function fetchSyncClients(): Promise<{ clients: SyncClient[] }> {
  const response = await fetch(`${API_BASE}/sync/clients`);
  return response.json();
}

export async function fetchSyncInstances(options?: {
  clientId?: string;
  pipelineId?: string;
  status?: SyncInstanceStatus;
}): Promise<{ instances: SyncInstance[] }> {
  const params = new URLSearchParams();
  if (options?.clientId) params.set('client_id', options.clientId);
  if (options?.pipelineId) params.set('pipeline_id', options.pipelineId);
  if (options?.status) params.set('status', options.status);

  const response = await fetch(`${API_BASE}/sync/instances?${params}`);
  return response.json();
}

export async function fetchSyncInstance(instanceId: string): Promise<{ instance: SyncInstance }> {
  const response = await fetch(`${API_BASE}/sync/instances/${instanceId}`);
  return response.json();
}

export async function fetchInstanceExecutions(
  instanceId: string,
  limit = 20
): Promise<{ executions: SyncExecution[] }> {
  const response = await fetch(`${API_BASE}/sync/instances/${instanceId}/executions?limit=${limit}`);
  return response.json();
}

export async function fetchSyncExecution(executionId: string): Promise<{ execution: SyncExecution }> {
  const response = await fetch(`${API_BASE}/sync/executions/${executionId}`);
  return response.json();
}

export async function triggerManualSync(instanceId: string): Promise<{ execution: SyncExecution }> {
  const response = await fetch(`${API_BASE}/sync/instances/${instanceId}/sync`, {
    method: 'POST',
  });
  return response.json();
}

export async function generateSyncData(
  clientCount = 5,
  introduceFailures = true
): Promise<{ success: boolean; overview: { activeClients: number; totalPipelines: number; totalInstances: number; failingInstances: number } }> {
  const response = await fetch(`${API_BASE}/sync/simulate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientCount, introduceFailures }),
  });
  return response.json();
}
