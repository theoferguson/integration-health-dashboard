import type { Integration, IntegrationEvent, HealthOverview } from '../types';

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
  limit?: number;
}): Promise<IntegrationEvent[]> {
  const params = new URLSearchParams();
  if (options?.integration) params.set('integration', options.integration);
  if (options?.status) params.set('status', options.status);
  if (options?.limit) params.set('limit', options.limit.toString());

  const response = await fetch(`${API_BASE}/events?${params}`);
  const data = await response.json();
  return data.events;
}

export async function classifyEvent(
  eventId: string
): Promise<{ event: IntegrationEvent; cached: boolean }> {
  const response = await fetch(`${API_BASE}/events/${eventId}/classify`, {
    method: 'POST',
  });
  return response.json();
}

export async function runSimulation(mode: 'demo' | 'all' = 'demo'): Promise<void> {
  // This triggers the simulator via the API
  // In production, this would be an admin endpoint
  await fetch(`${API_BASE}/simulate?mode=${mode}`, { method: 'POST' });
}
