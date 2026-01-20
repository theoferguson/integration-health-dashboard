/**
 * API Client
 * Handles all communication with the backend API
 */

import type {
  Integration,
  IntegrationEvent,
  HealthOverview,
  ResolutionStatus,
  SyncSystemOverview,
  SyncPipeline,
  SyncInstance,
  SyncExecution,
  SyncClient,
  SyncInstanceStatus,
} from '../types';
import { API, TIMING } from '../types';

const API_BASE = API.BASE_PATH;

/**
 * Custom error class for API errors
 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly statusText: string,
    message?: string
  ) {
    super(message || `API Error: ${status} ${statusText}`);
    this.name = 'ApiError';
  }
}

/**
 * Generic API call handler with error handling
 */
async function apiCall<T>(
  url: string,
  options?: RequestInit
): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMING.API_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });

    if (!response.ok) {
      let errorMessage: string | undefined;
      try {
        const errorBody = await response.json();
        errorMessage = errorBody.error || errorBody.message;
      } catch {
        // Response body is not JSON or is empty
      }
      throw new ApiError(response.status, response.statusText, errorMessage);
    }

    return response.json();
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ApiError(408, 'Request Timeout', 'The request timed out');
    }
    throw new ApiError(0, 'Network Error', 'Failed to connect to server');
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Helper to build URL with query parameters
 */
function buildUrl(path: string, params?: Record<string, string | number | undefined>): string {
  const url = `${API_BASE}${path}`;
  if (!params) return url;

  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      searchParams.set(key, String(value));
    }
  }

  const queryString = searchParams.toString();
  return queryString ? `${url}?${queryString}` : url;
}

// ============ Integration APIs ============

export async function fetchIntegrations(): Promise<Integration[]> {
  const data = await apiCall<{ integrations: Integration[] }>(
    buildUrl('/integrations')
  );
  return data.integrations;
}

export async function fetchHealth(): Promise<{
  health: HealthOverview;
  integrations: Integration[];
}> {
  return apiCall(buildUrl('/integrations/health'));
}

// ============ Event APIs ============

export type SortField = 'timestamp' | 'integration' | 'eventType' | 'status';
export type SortOrder = 'asc' | 'desc';

export interface FetchEventsOptions {
  integration?: string;
  status?: 'success' | 'failure';
  resolutionStatus?: ResolutionStatus;
  limit?: number;
}

export async function fetchEvents(options?: FetchEventsOptions): Promise<IntegrationEvent[]> {
  const data = await apiCall<{ events: IntegrationEvent[] }>(
    buildUrl('/events', {
      integration: options?.integration,
      status: options?.status,
      resolution_status: options?.resolutionStatus,
      limit: options?.limit,
    })
  );
  return data.events;
}

export interface PaginatedEventsResponse {
  events: IntegrationEvent[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

export interface FetchEventsPaginatedOptions {
  integration?: string;
  status?: 'success' | 'failure';
  resolutionStatus?: ResolutionStatus;
  limit?: number;
  offset?: number;
  sortBy?: SortField;
  sortOrder?: SortOrder;
  search?: string;
}

export async function fetchEventsPaginated(
  options?: FetchEventsPaginatedOptions
): Promise<PaginatedEventsResponse> {
  return apiCall(
    buildUrl('/events/paginated', {
      integration: options?.integration,
      status: options?.status,
      resolution_status: options?.resolutionStatus,
      limit: options?.limit,
      offset: options?.offset,
      sort_by: options?.sortBy,
      sort_order: options?.sortOrder,
      search: options?.search,
    })
  );
}

export async function classifyEvent(
  eventId: string
): Promise<{ event: IntegrationEvent; cached: boolean }> {
  return apiCall(`${API_BASE}/events/${eventId}/classify`, {
    method: 'POST',
  });
}

export async function acknowledgeEvent(
  eventId: string,
  acknowledgedBy?: string
): Promise<{ event: IntegrationEvent }> {
  return apiCall(`${API_BASE}/events/${eventId}/acknowledge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ acknowledged_by: acknowledgedBy }),
  });
}

export async function resolveEvent(
  eventId: string,
  resolvedBy?: string,
  notes?: string
): Promise<{ event: IntegrationEvent }> {
  return apiCall(`${API_BASE}/events/${eventId}/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resolved_by: resolvedBy, notes }),
  });
}

export async function reopenEvent(
  eventId: string
): Promise<{ event: IntegrationEvent }> {
  return apiCall(`${API_BASE}/events/${eventId}/reopen`, {
    method: 'POST',
  });
}

// ============ Simulation APIs ============

export async function runSimulation(mode: 'demo' | 'all' = 'demo'): Promise<void> {
  await apiCall(buildUrl('/simulate', { mode }), { method: 'POST' });
}

// ============ Sync APIs ============

export async function fetchSyncOverview(): Promise<{ overview: SyncSystemOverview }> {
  return apiCall(buildUrl('/sync/overview'));
}

export async function fetchSyncPipelines(): Promise<{ pipelines: SyncPipeline[] }> {
  return apiCall(buildUrl('/sync/pipelines'));
}

export async function fetchSyncClients(): Promise<{ clients: SyncClient[] }> {
  return apiCall(buildUrl('/sync/clients'));
}

export interface FetchSyncInstancesOptions {
  clientId?: string;
  pipelineId?: string;
  status?: SyncInstanceStatus;
}

export async function fetchSyncInstances(
  options?: FetchSyncInstancesOptions
): Promise<{ instances: SyncInstance[] }> {
  return apiCall(
    buildUrl('/sync/instances', {
      client_id: options?.clientId,
      pipeline_id: options?.pipelineId,
      status: options?.status,
    })
  );
}

export async function fetchSyncInstance(
  instanceId: string
): Promise<{ instance: SyncInstance }> {
  return apiCall(`${API_BASE}/sync/instances/${instanceId}`);
}

export async function fetchInstanceExecutions(
  instanceId: string,
  limit = 20
): Promise<{ executions: SyncExecution[] }> {
  return apiCall(
    buildUrl(`/sync/instances/${instanceId}/executions`, { limit })
  );
}

export async function fetchSyncExecution(
  executionId: string
): Promise<{ execution: SyncExecution }> {
  return apiCall(`${API_BASE}/sync/executions/${executionId}`);
}

export async function triggerManualSync(
  instanceId: string
): Promise<{ execution: SyncExecution }> {
  return apiCall(`${API_BASE}/sync/instances/${instanceId}/sync`, {
    method: 'POST',
  });
}

export interface GenerateSyncDataResult {
  success: boolean;
  overview: {
    activeClients: number;
    totalPipelines: number;
    totalInstances: number;
    failingInstances: number;
  };
}

export async function generateSyncData(
  clientCount = 5,
  introduceFailures = true
): Promise<GenerateSyncDataResult> {
  return apiCall(`${API_BASE}/sync/simulate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientCount, introduceFailures }),
  });
}
