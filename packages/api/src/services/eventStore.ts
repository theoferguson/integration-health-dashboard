/**
 * Event Store
 * Manages in-memory storage for integration events
 * Refactored to class pattern for better testability
 */

import { v4 as uuidv4 } from 'uuid';
import {
  EVENT_STORE,
  type IntegrationEvent,
  type CreateEventInput,
  type IntegrationType,
  type ResolutionStatus,
} from '../types/index.js';

/**
 * Helper to safely get timestamp from Date | string
 */
function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
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

export interface EventStats {
  eventsLast24h: number;
  errorsLast24h: number;
  successRate: number;
  lastSync: Date | string | null;
}

/**
 * EventStore class for managing integration events
 * In production, this would be backed by a database
 */
export class EventStore {
  private events: IntegrationEvent[] = [];
  private maxEvents: number;

  constructor(maxEvents: number = EVENT_STORE.MAX_EVENTS_IN_MEMORY) {
    this.maxEvents = maxEvents;
  }

  /**
   * Create a new event
   */
  create(input: CreateEventInput): IntegrationEvent {
    const event: IntegrationEvent = {
      id: uuidv4(),
      integration: input.integration,
      eventType: input.eventType,
      status: input.status,
      timestamp: new Date(),
      payload: input.payload,
      error: input.error,
    };

    this.events.unshift(event); // Add to beginning for recent-first ordering

    // Keep only last N events in memory
    if (this.events.length > this.maxEvents) {
      this.events.pop();
    }

    return event;
  }

  /**
   * Get events with optional filtering
   */
  getAll(options?: GetEventsOptions): IntegrationEvent[] {
    const result = this.getPaginated(options);
    return result.events;
  }

  /**
   * Get events with pagination
   */
  getPaginated(options?: GetEventsOptions): PaginatedEvents {
    let filtered = [...this.events];

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
      const sinceTime = options.since.getTime();
      filtered = filtered.filter((e) => toDate(e.timestamp).getTime() >= sinceTime);
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
          comparison = toDate(a.timestamp).getTime() - toDate(b.timestamp).getTime();
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
    const limit = options?.limit || EVENT_STORE.DEFAULT_PAGE_SIZE;

    const paginated = filtered.slice(offset, offset + limit);

    return {
      events: paginated,
      total,
      offset,
      limit,
      hasMore: offset + limit < total,
    };
  }

  /**
   * Get a single event by ID
   */
  getById(id: string): IntegrationEvent | undefined {
    return this.events.find((e) => e.id === id);
  }

  /**
   * Update event classification
   */
  updateClassification(
    id: string,
    classification: IntegrationEvent['classification']
  ): IntegrationEvent | undefined {
    const event = this.events.find((e) => e.id === id);
    if (event) {
      event.classification = classification;
    }
    return event;
  }

  /**
   * Get statistics for an integration
   */
  getStats(integration: IntegrationType): EventStats {
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const last24hTime = last24h.getTime();

    const integrationEvents = this.events.filter(
      (e) => e.integration === integration && toDate(e.timestamp).getTime() >= last24hTime
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

  /**
   * Acknowledge a failure event
   */
  acknowledge(id: string, acknowledgedBy: string = 'anonymous'): IntegrationEvent | undefined {
    const event = this.events.find((e) => e.id === id);
    if (event && event.status === 'failure') {
      event.resolution = {
        status: 'acknowledged',
        acknowledgedAt: new Date(),
        acknowledgedBy,
      };
    }
    return event;
  }

  /**
   * Resolve a failure event
   */
  resolve(id: string, resolvedBy: string = 'anonymous', notes?: string): IntegrationEvent | undefined {
    const event = this.events.find((e) => e.id === id);
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

  /**
   * Reopen a resolved event
   */
  reopen(id: string): IntegrationEvent | undefined {
    const event = this.events.find((e) => e.id === id);
    if (event) {
      event.resolution = { status: 'open' };
    }
    return event;
  }

  /**
   * Clear all events
   */
  clear(): void {
    this.events.length = 0;
  }

  /**
   * Get total event count
   */
  get count(): number {
    return this.events.length;
  }
}

// ============ Default instance and backwards-compatible exports ============

/**
 * Default singleton instance for production use
 */
const defaultStore = new EventStore();

// Backwards-compatible function exports that delegate to the default instance
export function createEvent(input: CreateEventInput): IntegrationEvent {
  return defaultStore.create(input);
}

export function getEvents(options?: GetEventsOptions): IntegrationEvent[] {
  return defaultStore.getAll(options);
}

export function getEventsPaginated(options?: GetEventsOptions): PaginatedEvents {
  return defaultStore.getPaginated(options);
}

export function getEventById(id: string): IntegrationEvent | undefined {
  return defaultStore.getById(id);
}

export function updateEventClassification(
  id: string,
  classification: IntegrationEvent['classification']
): IntegrationEvent | undefined {
  return defaultStore.updateClassification(id, classification);
}

export function getEventStats(integration: IntegrationType): EventStats {
  return defaultStore.getStats(integration);
}

export function acknowledgeEvent(
  id: string,
  acknowledgedBy: string = 'anonymous'
): IntegrationEvent | undefined {
  return defaultStore.acknowledge(id, acknowledgedBy);
}

export function resolveEvent(
  id: string,
  resolvedBy: string = 'anonymous',
  notes?: string
): IntegrationEvent | undefined {
  return defaultStore.resolve(id, resolvedBy, notes);
}

export function reopenEvent(id: string): IntegrationEvent | undefined {
  return defaultStore.reopen(id);
}

export function clearEvents(): void {
  defaultStore.clear();
}
