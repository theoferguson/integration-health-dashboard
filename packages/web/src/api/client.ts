/**
 * API Client
 * Handles all communication with the backend API
 */

import type {
  Integration,
  IntegrationEvent,
  HealthOverview,
  ResolutionStatus,
  Monitor,
  MonitorSummary,
  MonitorMatchSpec,
  MonitorSeriesPoint,
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

// ============ Auth APIs ============

export interface AuthState {
  loggedIn: boolean;
  login: string | null;
}

export async function fetchAuthState(): Promise<AuthState> {
  return apiCall(buildUrl('/auth/me'));
}

export async function logout(): Promise<void> {
  await apiCall(`${API_BASE}/auth/logout`, { method: 'POST' });
}

/**
 * Email+password signup / login. Both set the session cookie on success, so the
 * caller just needs to reload once the promise resolves.
 */
export async function passwordAuthRequest(
  mode: 'signup' | 'login',
  email: string,
  password: string
): Promise<{ login: string }> {
  return apiCall(`${API_BASE}/auth/${mode}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
}

// ============ Project APIs ============

export interface ProjectSummary {
  id: string;
  name: string;
  createdAt: string;
}

export interface CreatedProject extends ProjectSummary {
  apiKey: string;
}

export async function fetchProjects(): Promise<ProjectSummary[]> {
  const data = await apiCall<{ projects: ProjectSummary[] }>(buildUrl('/projects'));
  return data.projects;
}

export async function createProjectRequest(name: string): Promise<CreatedProject> {
  const data = await apiCall<{ project: CreatedProject }>(`${API_BASE}/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  return data.project;
}

export async function deleteProjectRequest(id: string): Promise<void> {
  await apiCall(`${API_BASE}/projects/${id}`, { method: 'DELETE' });
}

// ============ Org APIs ============

export type OrgRole = 'admin' | 'viewer';

export interface OrgState {
  org: { id: string; name: string; inviteCode?: string } | null;
  role?: OrgRole;
}

export async function fetchOrg(): Promise<OrgState> {
  return apiCall(buildUrl('/orgs/me'));
}

export async function regenerateInvite(): Promise<string> {
  const data = await apiCall<{ inviteCode: string }>(`${API_BASE}/orgs/invite/regenerate`, {
    method: 'POST',
  });
  return data.inviteCode;
}

export async function joinOrgRequest(code: string): Promise<{ id: string; name: string }> {
  const data = await apiCall<{ org: { id: string; name: string } }>(`${API_BASE}/orgs/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  return data.org;
}

// ============ Monitor APIs ============

export async function fetchMonitors(): Promise<MonitorSummary[]> {
  const data = await apiCall<{ monitors: MonitorSummary[] }>(buildUrl('/monitors'));
  return data.monitors;
}

export async function createMonitorRequest(
  name: string,
  matchSpec: MonitorMatchSpec
): Promise<Monitor> {
  const data = await apiCall<{ monitor: Monitor }>(`${API_BASE}/monitors`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, matchSpec }),
  });
  return data.monitor;
}

export async function updateMonitorRequest(
  id: string,
  patch: { name?: string; enabled?: boolean; matchSpec?: MonitorMatchSpec }
): Promise<Monitor> {
  const data = await apiCall<{ monitor: Monitor }>(`${API_BASE}/monitors/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  return data.monitor;
}

export async function deleteMonitorRequest(id: string): Promise<void> {
  await apiCall(`${API_BASE}/monitors/${id}`, { method: 'DELETE' });
}

export interface MonitorSeriesResponse {
  monitor: Monitor;
  series: MonitorSeriesPoint[];
  windowMs: number;
  bucketMs: number;
}

export async function fetchMonitorSeries(
  id: string,
  opts?: { window?: number; bucket?: number }
): Promise<MonitorSeriesResponse> {
  return apiCall(
    buildUrl(`/monitors/${id}/series`, { window: opts?.window, bucket: opts?.bucket })
  );
}
