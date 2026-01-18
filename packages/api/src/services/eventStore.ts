import { v4 as uuidv4 } from 'uuid';
import type {
  IntegrationEvent,
  CreateEventInput,
  IntegrationType,
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

export function getEvents(options?: {
  integration?: IntegrationType;
  status?: 'success' | 'failure';
  limit?: number;
  since?: Date;
}): IntegrationEvent[] {
  let filtered = [...events];

  if (options?.integration) {
    filtered = filtered.filter((e) => e.integration === options.integration);
  }

  if (options?.status) {
    filtered = filtered.filter((e) => e.status === options.status);
  }

  if (options?.since) {
    const since = options.since;
    filtered = filtered.filter((e) => e.timestamp >= since);
  }

  if (options?.limit) {
    filtered = filtered.slice(0, options.limit);
  }

  return filtered;
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

export function clearEvents(): void {
  events.length = 0;
}
