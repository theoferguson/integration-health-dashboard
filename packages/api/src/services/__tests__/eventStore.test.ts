import { describe, it, expect, beforeEach } from 'vitest';
import {
  createEvent,
  getEvents,
  getEventById,
  updateEventClassification,
  getEventStats,
  clearEvents,
} from '../eventStore.js';
import type { CreateEventInput } from '../../types/index.js';

describe('eventStore', () => {
  beforeEach(() => {
    clearEvents();
  });

  describe('createEvent', () => {
    it('should create an event with generated id and timestamp', () => {
      const input: CreateEventInput = {
        integration: 'procore',
        eventType: 'project.sync',
        status: 'success',
        payload: { project_id: 123 },
      };

      const event = createEvent(input);

      expect(event.id).toBeDefined();
      expect(event.id).toHaveLength(36); // UUID format
      expect(event.timestamp).toBeInstanceOf(Date);
      expect(event.integration).toBe('procore');
      expect(event.eventType).toBe('project.sync');
      expect(event.status).toBe('success');
      expect(event.payload).toEqual({ project_id: 123 });
    });

    it('should include error details for failure events', () => {
      const input: CreateEventInput = {
        integration: 'gusto',
        eventType: 'employee.sync',
        status: 'failure',
        payload: {},
        error: {
          message: 'Validation failed',
          code: '400',
          context: { field: 'email' },
        },
      };

      const event = createEvent(input);

      expect(event.error).toBeDefined();
      expect(event.error?.message).toBe('Validation failed');
      expect(event.error?.code).toBe('400');
      expect(event.error?.context).toEqual({ field: 'email' });
    });
  });

  describe('getEvents', () => {
    it('should return events in reverse chronological order', () => {
      createEvent({
        integration: 'procore',
        eventType: 'first',
        status: 'success',
        payload: {},
      });
      createEvent({
        integration: 'procore',
        eventType: 'second',
        status: 'success',
        payload: {},
      });

      const events = getEvents();

      expect(events[0].eventType).toBe('second');
      expect(events[1].eventType).toBe('first');
    });

    it('should filter by integration', () => {
      createEvent({
        integration: 'procore',
        eventType: 'test',
        status: 'success',
        payload: {},
      });
      createEvent({
        integration: 'gusto',
        eventType: 'test',
        status: 'success',
        payload: {},
      });

      const procoreEvents = getEvents({ integration: 'procore' });
      const gustoEvents = getEvents({ integration: 'gusto' });

      expect(procoreEvents).toHaveLength(1);
      expect(procoreEvents[0].integration).toBe('procore');
      expect(gustoEvents).toHaveLength(1);
      expect(gustoEvents[0].integration).toBe('gusto');
    });

    it('should filter by status', () => {
      createEvent({
        integration: 'procore',
        eventType: 'test',
        status: 'success',
        payload: {},
      });
      createEvent({
        integration: 'procore',
        eventType: 'test',
        status: 'failure',
        payload: {},
        error: { message: 'Error' },
      });

      const successEvents = getEvents({ status: 'success' });
      const failureEvents = getEvents({ status: 'failure' });

      expect(successEvents).toHaveLength(1);
      expect(failureEvents).toHaveLength(1);
    });

    it('should respect limit parameter', () => {
      for (let i = 0; i < 10; i++) {
        createEvent({
          integration: 'procore',
          eventType: `event-${i}`,
          status: 'success',
          payload: {},
        });
      }

      const events = getEvents({ limit: 5 });

      expect(events).toHaveLength(5);
    });

    it('should combine multiple filters', () => {
      createEvent({
        integration: 'procore',
        eventType: 'test',
        status: 'success',
        payload: {},
      });
      createEvent({
        integration: 'procore',
        eventType: 'test',
        status: 'failure',
        payload: {},
        error: { message: 'Error' },
      });
      createEvent({
        integration: 'gusto',
        eventType: 'test',
        status: 'failure',
        payload: {},
        error: { message: 'Error' },
      });

      const events = getEvents({
        integration: 'procore',
        status: 'failure',
      });

      expect(events).toHaveLength(1);
      expect(events[0].integration).toBe('procore');
      expect(events[0].status).toBe('failure');
    });
  });

  describe('getEventById', () => {
    it('should return event by id', () => {
      const created = createEvent({
        integration: 'procore',
        eventType: 'test',
        status: 'success',
        payload: {},
      });

      const found = getEventById(created.id);

      expect(found).toBeDefined();
      expect(found?.id).toBe(created.id);
    });

    it('should return undefined for non-existent id', () => {
      const found = getEventById('non-existent-id');

      expect(found).toBeUndefined();
    });
  });

  describe('updateEventClassification', () => {
    it('should add classification to event', () => {
      const event = createEvent({
        integration: 'procore',
        eventType: 'test',
        status: 'failure',
        payload: {},
        error: { message: 'Error' },
      });

      const classification = {
        category: 'auth' as const,
        severity: 'high' as const,
        cause: 'Token expired',
        suggestedFix: 'Re-authenticate',
        affectedData: ['all'],
        businessImpact: 'Sync blocked',
      };

      const updated = updateEventClassification(event.id, classification);

      expect(updated?.classification).toEqual(classification);

      // Verify it persists
      const fetched = getEventById(event.id);
      expect(fetched?.classification).toEqual(classification);
    });

    it('should return undefined for non-existent event', () => {
      const result = updateEventClassification('non-existent', {
        category: 'auth',
        severity: 'high',
        cause: 'Test',
        suggestedFix: 'Test',
      });

      expect(result).toBeUndefined();
    });
  });

  describe('getEventStats', () => {
    it('should calculate correct stats for integration', () => {
      // Create 8 success, 2 failure events
      for (let i = 0; i < 8; i++) {
        createEvent({
          integration: 'procore',
          eventType: 'test',
          status: 'success',
          payload: {},
        });
      }
      for (let i = 0; i < 2; i++) {
        createEvent({
          integration: 'procore',
          eventType: 'test',
          status: 'failure',
          payload: {},
          error: { message: 'Error' },
        });
      }

      const stats = getEventStats('procore');

      expect(stats.eventsLast24h).toBe(10);
      expect(stats.errorsLast24h).toBe(2);
      expect(stats.successRate).toBe(80);
      expect(stats.lastSync).toBeInstanceOf(Date);
    });

    it('should return 100% success rate with no events', () => {
      const stats = getEventStats('procore');

      expect(stats.successRate).toBe(100);
      expect(stats.eventsLast24h).toBe(0);
      expect(stats.errorsLast24h).toBe(0);
      expect(stats.lastSync).toBeNull();
    });

    it('should only count events for specified integration', () => {
      createEvent({
        integration: 'procore',
        eventType: 'test',
        status: 'success',
        payload: {},
      });
      createEvent({
        integration: 'gusto',
        eventType: 'test',
        status: 'failure',
        payload: {},
        error: { message: 'Error' },
      });

      const procoreStats = getEventStats('procore');
      const gustoStats = getEventStats('gusto');

      expect(procoreStats.eventsLast24h).toBe(1);
      expect(procoreStats.successRate).toBe(100);
      expect(gustoStats.eventsLast24h).toBe(1);
      expect(gustoStats.successRate).toBe(0);
    });
  });

  describe('clearEvents', () => {
    it('should remove all events', () => {
      createEvent({
        integration: 'procore',
        eventType: 'test',
        status: 'success',
        payload: {},
      });
      createEvent({
        integration: 'gusto',
        eventType: 'test',
        status: 'success',
        payload: {},
      });

      clearEvents();

      const events = getEvents();
      expect(events).toHaveLength(0);
    });
  });
});
