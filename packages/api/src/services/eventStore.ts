import { v4 as uuidv4 } from 'uuid';
import type {
  IntegrationEvent,
  CreateEventInput,
  IntegrationType,
  ResolutionStatus,
} from '../types/index.js';

// In-memory store for demo purposes
// In production, this would be MongoDB or similar
const events: IntegrationEvent[] = [];

export function createEvent(input: CreateEventInput): IntegrationEvent {
  const event: IntegrationEvent = {
    id: uuidv4(),
    integration: input.integration,
    eventType: input.eventType,
    status: input.status,
    timestamp: new Date(),
    payload: input.payload,
    error: input.error,
  };

  events.unshift(event); // Add to beginning for recent-first ordering

  // Keep only last 1000 events in memory
  if (events.length > 1000) {
    events.pop();
  }

  return event;
}

export type SortField = 'timestamp' | 'integration' | 'eventType' | 'status';
export type SortOrder = 'asc' | 'desc';

export interface GetEventsOptions {
  integration?: IntegrationType;
  status?: 'success' | 'failure';
  resolutionStatus?: ResolutionStatus;
  limit?: number;
  offset?: number;
  since?: Date;
  sortBy?: SortField;
  sortOrder?: SortOrder;
  search?: string;
}

export interface PaginatedEvents {
  events: IntegrationEvent[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

export function getEvents(options?: GetEventsOptions): IntegrationEvent[] {
  const result = getEventsPaginated(options);
  return result.events;
}

export function getEventsPaginated(options?: GetEventsOptions): PaginatedEvents {
  let filtered = [...events];

  if (options?.integration) {
    filtered = filtered.filter((e) => e.integration === options.integration);
  }

  if (options?.status) {
    filtered = filtered.filter((e) => e.status === options.status);
  }

  if (options?.resolutionStatus) {
    filtered = filtered.filter((e) => {
      const status = e.resolution?.status || 'open';
      return status === options.resolutionStatus;
    });
  }

  if (options?.since) {
    const since = options.since;
    filtered = filtered.filter((e) => e.timestamp >= since);
  }

  if (options?.search) {
    const searchLower = options.search.toLowerCase();
    filtered = filtered.filter((e) =>
      e.eventType.toLowerCase().includes(searchLower) ||
      e.integration.toLowerCase().includes(searchLower) ||
      e.error?.message?.toLowerCase().includes(searchLower) ||
      e.error?.code?.toLowerCase().includes(searchLower)
    );
  }

  // Sort
  const sortBy = options?.sortBy || 'timestamp';
  const sortOrder = options?.sortOrder || 'desc';

  filtered.sort((a, b) => {
    let comparison = 0;
    switch (sortBy) {
      case 'timestamp':
        comparison = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
        break;
      case 'integration':
        comparison = a.integration.localeCompare(b.integration);
        break;
      case 'eventType':
        comparison = a.eventType.localeCompare(b.eventType);
        break;
      case 'status':
        comparison = a.status.localeCompare(b.status);
        break;
    }
    return sortOrder === 'asc' ? comparison : -comparison;
  });

  const total = filtered.length;
  const offset = options?.offset || 0;
  const limit = options?.limit || 50;

  const paginated = filtered.slice(offset, offset + limit);

  return {
    events: paginated,
    total,
    offset,
    limit,
    hasMore: offset + limit < total,
  };
}

export function getEventById(id: string): IntegrationEvent | undefined {
  return events.find((e) => e.id === id);
}

export function updateEventClassification(
  id: string,
  classification: IntegrationEvent['classification']
): IntegrationEvent | undefined {
  const event = events.find((e) => e.id === id);
  if (event) {
    event.classification = classification;
  }
  return event;
}

export function getEventStats(integration: IntegrationType) {
  const now = new Date();
  const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const integrationEvents = events.filter(
    (e) => e.integration === integration && e.timestamp >= last24h
  );

  const total = integrationEvents.length;
  const failures = integrationEvents.filter((e) => e.status === 'failure').length;
  const successRate = total > 0 ? Math.round(((total - failures) / total) * 100) : 100;

  const lastSync = integrationEvents.length > 0 ? integrationEvents[0].timestamp : null;

  return {
    eventsLast24h: total,
    errorsLast24h: failures,
    successRate,
    lastSync,
  };
}

export function acknowledgeEvent(
  id: string,
  acknowledgedBy: string = 'anonymous'
): IntegrationEvent | undefined {
  const event = events.find((e) => e.id === id);
  if (event && event.status === 'failure') {
    event.resolution = {
      status: 'acknowledged',
      acknowledgedAt: new Date(),
      acknowledgedBy,
    };
  }
  return event;
}

export function resolveEvent(
  id: string,
  resolvedBy: string = 'anonymous',
  notes?: string
): IntegrationEvent | undefined {
  const event = events.find((e) => e.id === id);
  if (event && event.status === 'failure') {
    event.resolution = {
      ...event.resolution,
      status: 'resolved',
      resolvedAt: new Date(),
      resolvedBy,
      notes,
    };
  }
  return event;
}

export function reopenEvent(id: string): IntegrationEvent | undefined {
  const event = events.find((e) => e.id === id);
  if (event) {
    event.resolution = { status: 'open' };
  }
  return event;
}

export function clearEvents(): void {
  events.length = 0;
}
