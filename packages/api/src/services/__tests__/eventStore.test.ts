import { describe, it, expect, beforeEach } from 'vitest';
import {
  createEvent,
  getEvents,
  getEventById,
  updateEventClassification,
  getEventStats,
  getDistinctIntegrations,
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
        integration: 'weather',
        eventType: 'forecast.sync',
        status: 'success',
        payload: { zone: 'NYZ072' },
      };

      const event = createEvent(input);

      expect(event.id).toBeDefined();
      expect(event.id).toHaveLength(36); // UUID format
      expect(event.timestamp).toBeInstanceOf(Date);
      expect(event.integration).toBe('weather');
      expect(event.eventType).toBe('forecast.sync');
      expect(event.status).toBe('success');
      expect(event.payload).toEqual({ zone: 'NYZ072' });
    });

    it('should include error details for failure events', () => {
      const input: CreateEventInput = {
        integration: 'nyt-news',
        eventType: 'top-stories.sync',
        status: 'failure',
        payload: {},
        error: {
          message: 'Rate limit exceeded',
          code: '429',
          context: { limit: '5/min' },
        },
      };

      const event = createEvent(input);

      expect(event.error).toBeDefined();
      expect(event.error?.message).toBe('Rate limit exceeded');
      expect(event.error?.code).toBe('429');
      expect(event.error?.context).toEqual({ limit: '5/min' });
    });
  });

  describe('getEvents', () => {
    it('should return events in reverse chronological order', () => {
      createEvent({
        integration: 'weather',
        eventType: 'first',
        status: 'success',
        payload: {},
      });
      createEvent({
        integration: 'weather',
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
        integration: 'weather',
        eventType: 'test',
        status: 'success',
        payload: {},
      });
      createEvent({
        integration: 'nyt-news',
        eventType: 'test',
        status: 'success',
        payload: {},
      });

      const weatherEvents = getEvents({ integration: 'weather' });
      const newsEvents = getEvents({ integration: 'nyt-news' });

      expect(weatherEvents).toHaveLength(1);
      expect(weatherEvents[0].integration).toBe('weather');
      expect(newsEvents).toHaveLength(1);
      expect(newsEvents[0].integration).toBe('nyt-news');
    });

    it('should filter by status', () => {
      createEvent({
        integration: 'weather',
        eventType: 'test',
        status: 'success',
        payload: {},
      });
      createEvent({
        integration: 'weather',
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
          integration: 'weather',
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
        integration: 'weather',
        eventType: 'test',
        status: 'success',
        payload: {},
      });
      createEvent({
        integration: 'weather',
        eventType: 'test',
        status: 'failure',
        payload: {},
        error: { message: 'Error' },
      });
      createEvent({
        integration: 'nyt-news',
        eventType: 'test',
        status: 'failure',
        payload: {},
        error: { message: 'Error' },
      });

      const events = getEvents({
        integration: 'weather',
        status: 'failure',
      });

      expect(events).toHaveLength(1);
      expect(events[0].integration).toBe('weather');
      expect(events[0].status).toBe('failure');
    });
  });

  describe('getEventById', () => {
    it('should return event by id', () => {
      const created = createEvent({
        integration: 'weather',
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
        integration: 'weather',
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
          integration: 'weather',
          eventType: 'test',
          status: 'success',
          payload: {},
        });
      }
      for (let i = 0; i < 2; i++) {
        createEvent({
          integration: 'weather',
          eventType: 'test',
          status: 'failure',
          payload: {},
          error: { message: 'Error' },
        });
      }

      const stats = getEventStats('weather');

      expect(stats.eventsLast24h).toBe(10);
      expect(stats.errorsLast24h).toBe(2);
      expect(stats.successRate).toBe(80);
      expect(stats.lastSync).toBeInstanceOf(Date);
    });

    it('should return 100% success rate with no events', () => {
      const stats = getEventStats('weather');

      expect(stats.successRate).toBe(100);
      expect(stats.eventsLast24h).toBe(0);
      expect(stats.errorsLast24h).toBe(0);
      expect(stats.lastSync).toBeNull();
    });

    it('should only count events for specified integration', () => {
      createEvent({
        integration: 'weather',
        eventType: 'test',
        status: 'success',
        payload: {},
      });
      createEvent({
        integration: 'nyt-news',
        eventType: 'test',
        status: 'failure',
        payload: {},
        error: { message: 'Error' },
      });

      const weatherStats = getEventStats('weather');
      const newsStats = getEventStats('nyt-news');

      expect(weatherStats.eventsLast24h).toBe(1);
      expect(weatherStats.successRate).toBe(100);
      expect(newsStats.eventsLast24h).toBe(1);
      expect(newsStats.successRate).toBe(0);
    });
  });

  describe('getDistinctIntegrations', () => {
    it('should return unique integration ids seen in events', () => {
      createEvent({ integration: 'weather', eventType: 'a', status: 'success', payload: {} });
      createEvent({ integration: 'weather', eventType: 'b', status: 'success', payload: {} });
      createEvent({ integration: 'nyt-news', eventType: 'c', status: 'success', payload: {} });

      expect(getDistinctIntegrations().sort()).toEqual(['nyt-news', 'weather']);
    });

    it('should return an empty array with no events', () => {
      expect(getDistinctIntegrations()).toEqual([]);
    });
  });

  describe('clearEvents', () => {
    it('should remove all events', () => {
      createEvent({
        integration: 'weather',
        eventType: 'test',
        status: 'success',
        payload: {},
      });
      createEvent({
        integration: 'nyt-news',
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
