import { describe, it, expect, beforeEach } from 'vitest';
import {
  getIntegrationHealth,
  getAllIntegrationHealth,
  getOverallHealth,
} from '../healthCalculator.js';
import { createEvent, clearEvents } from '../eventStore.js';

describe('healthCalculator', () => {
  beforeEach(() => {
    // Clear events before each test
    clearEvents();
  });

  describe('getIntegrationHealth', () => {
    it('should return healthy status when no events exist', () => {
      const health = getIntegrationHealth('weather');

      expect(health.status).toBe('healthy');
      expect(health.successRate).toBe(100);
      expect(health.eventsLast24h).toBe(0);
      expect(health.errorsLast24h).toBe(0);
    });

    it('should return healthy status with high success rate', () => {
      // Create 98 successful events and 2 failures (98% success)
      for (let i = 0; i < 98; i++) {
        createEvent({
          integration: 'weather',
          eventType: 'test.event',
          status: 'success',
          payload: {},
        });
      }
      for (let i = 0; i < 2; i++) {
        createEvent({
          integration: 'weather',
          eventType: 'test.event',
          status: 'failure',
          payload: {},
          error: { message: 'Test error' },
        });
      }

      const health = getIntegrationHealth('weather');

      expect(health.status).toBe('healthy');
      expect(health.successRate).toBe(98);
      expect(health.eventsLast24h).toBe(100);
      expect(health.errorsLast24h).toBe(2);
    });

    it('should return degraded status with moderate error rate', () => {
      // Create 90 successful events and 10 failures (90% success)
      for (let i = 0; i < 90; i++) {
        createEvent({
          integration: 'nyt-news',
          eventType: 'test.event',
          status: 'success',
          payload: {},
        });
      }
      for (let i = 0; i < 10; i++) {
        createEvent({
          integration: 'nyt-news',
          eventType: 'test.event',
          status: 'failure',
          payload: {},
          error: { message: 'Test error' },
        });
      }

      const health = getIntegrationHealth('nyt-news');

      expect(health.status).toBe('degraded');
      expect(health.successRate).toBe(90);
    });

    it('should return down status with high error rate', () => {
      // Create 80 successful events and 20 failures (80% success)
      for (let i = 0; i < 80; i++) {
        createEvent({
          integration: 'nyc-civic-finance',
          eventType: 'test.event',
          status: 'success',
          payload: {},
        });
      }
      for (let i = 0; i < 20; i++) {
        createEvent({
          integration: 'nyc-civic-finance',
          eventType: 'test.event',
          status: 'failure',
          payload: {},
          error: { message: 'Test error' },
        });
      }

      const health = getIntegrationHealth('nyc-civic-finance');

      expect(health.status).toBe('down');
      expect(health.successRate).toBe(80);
    });

    it('should use the requested id even if no events exist for it', () => {
      const health = getIntegrationHealth('some-new-integration');

      expect(health.id).toBe('some-new-integration');
    });

    it('should track last sync time', () => {
      createEvent({
        integration: 'weather',
        eventType: 'forecast.sync',
        status: 'success',
        payload: {},
      });

      const health = getIntegrationHealth('weather');

      expect(health.lastSync).not.toBeNull();
      expect(health.lastSync).toBeInstanceOf(Date);
    });
  });

  describe('getAllIntegrationHealth', () => {
    it('should return an empty array when no integrations have reported events', () => {
      expect(getAllIntegrationHealth()).toEqual([]);
    });

    it('should discover integrations dynamically from reported events', () => {
      createEvent({ integration: 'weather', eventType: 'a', status: 'success', payload: {} });
      createEvent({ integration: 'nyt-news', eventType: 'b', status: 'success', payload: {} });

      const allHealth = getAllIntegrationHealth();
      const integrationIds = allHealth.map((h) => h.id);

      expect(integrationIds.sort()).toEqual(['nyt-news', 'weather']);
    });

    it('should calculate health independently per integration', () => {
      createEvent({ integration: 'weather', eventType: 'a', status: 'success', payload: {} });

      // Add failures only to nyt-news
      for (let i = 0; i < 50; i++) {
        createEvent({
          integration: 'nyt-news',
          eventType: 'test.event',
          status: 'failure',
          payload: {},
          error: { message: 'Test error' },
        });
      }

      const allHealth = getAllIntegrationHealth();
      const newsHealth = allHealth.find((h) => h.id === 'nyt-news');
      const weatherHealth = allHealth.find((h) => h.id === 'weather');

      expect(newsHealth?.status).toBe('down');
      expect(weatherHealth?.status).toBe('healthy');
    });
  });

  describe('getOverallHealth', () => {
    it('should return zero counts when no integrations have reported events', () => {
      const overall = getOverallHealth();

      expect(overall.totalIntegrations).toBe(0);
      expect(overall.healthy).toBe(0);
      expect(overall.degraded).toBe(0);
      expect(overall.down).toBe(0);
    });

    it('should count degraded and down integrations', () => {
      createEvent({ integration: 'weather', eventType: 'a', status: 'success', payload: {} });

      // Make nyt-news degraded (90% success rate)
      for (let i = 0; i < 90; i++) {
        createEvent({
          integration: 'nyt-news',
          eventType: 'test.event',
          status: 'success',
          payload: {},
        });
      }
      for (let i = 0; i < 10; i++) {
        createEvent({
          integration: 'nyt-news',
          eventType: 'test.event',
          status: 'failure',
          payload: {},
          error: { message: 'Test error' },
        });
      }

      // Make nyc-civic-finance down (50% success rate)
      for (let i = 0; i < 50; i++) {
        createEvent({
          integration: 'nyc-civic-finance',
          eventType: 'test.event',
          status: 'success',
          payload: {},
        });
      }
      for (let i = 0; i < 50; i++) {
        createEvent({
          integration: 'nyc-civic-finance',
          eventType: 'test.event',
          status: 'failure',
          payload: {},
          error: { message: 'Test error' },
        });
      }

      const overall = getOverallHealth();

      expect(overall.totalIntegrations).toBe(3);
      expect(overall.healthy).toBe(1);
      expect(overall.degraded).toBe(1);
      expect(overall.down).toBe(1);
    });
  });
});
