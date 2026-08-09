import { describe, it, expect, beforeEach } from 'vitest';
import {
  getIntegrationHealth,
  getAllIntegrationHealth,
  getOverallHealth,
} from '../healthCalculator.js';
import { createEvent, clearEvents } from '../eventStore.js';
import { db } from '../../db/connection.js';

const MINUTE = 60 * 1000;

/**
 * Report `count` events for `integration` spaced `everyMs` apart, the newest of
 * them `silentForMs` ago. Backdating after the fact because createEvent always
 * stamps "now" - the whole point of these cases is a specific reporting rhythm.
 */
function seedCadence(
  integration: string,
  { everyMs, count, silentForMs }: { everyMs: number; count: number; silentForMs: number }
): void {
  const newest = Date.now() - silentForMs;
  for (let i = 0; i < count; i++) {
    const event = createEvent({ integration, eventType: 'refresh', status: 'success', payload: {} });
    db.prepare('UPDATE events SET timestamp = ? WHERE id = ?').run(newest - i * everyMs, event.id);
  }
}

describe('healthCalculator', () => {
  beforeEach(() => {
    // Clear events before each test
    clearEvents();
  });

  // Silence is judged against the integration's own rhythm, not a fixed window.
  // The bug these cover: opensky-flights polls every 2 minutes, died, and read
  // back as "healthy, 100%" for 8 days because a 24h window hadn't closed yet.
  describe('staleness', () => {
    it('flags a fast poller that has missed several reports', () => {
      seedCadence('opensky-flights', { everyMs: 2 * MINUTE, count: 20, silentForMs: 30 * MINUTE });

      const health = getIntegrationHealth('opensky-flights');

      expect(health.stale).toBe(true);
      expect(health.status).toBe('down'); // 15x its normal gap
      expect(health.expectedIntervalMs).toBe(2 * MINUTE);
    });

    it('degrades before it declares death', () => {
      seedCadence('opensky-flights', { everyMs: 2 * MINUTE, count: 20, silentForMs: 8 * MINUTE });

      const health = getIntegrationHealth('opensky-flights');

      expect(health.stale).toBe(true);
      expect(health.status).toBe('degraded'); // 4x - overdue, not yet gone
    });

    it('leaves a slow reporter alone while it is merely between reports', () => {
      // A weekly report, quiet for a day. The old 24h window called this stale;
      // it is simply not due yet.
      seedCadence('nyt-books', { everyMs: 7 * 24 * 60 * MINUTE, count: 5, silentForMs: 24 * 60 * MINUTE });

      const health = getIntegrationHealth('nyt-books');

      expect(health.stale).toBe(false);
      expect(health.status).toBe('healthy');
    });

    it('holds off on a fast reporter inside the minimum silence floor', () => {
      // 1s cadence, silent 2 minutes: 120x overdue by ratio alone, but far too
      // little silence to mean anything. Without the floor this flaps constantly.
      seedCadence('chess-com', { everyMs: 1000, count: 20, silentForMs: 2 * MINUTE });

      const health = getIntegrationHealth('chess-com');

      expect(health.stale).toBe(false);
      expect(health.status).toBe('healthy');
    });

    it('measures a bursty reporter by its quiet stretch, not its burst', () => {
      // Ten events a second apart every hour. Judged by the median gap this
      // would look dead seconds after each healthy burst.
      const hourAgo = Date.now() - 60 * MINUTE;
      for (const base of [hourAgo, hourAgo - 60 * MINUTE, hourAgo - 120 * MINUTE]) {
        for (let i = 0; i < 10; i++) {
          const event = createEvent({
            integration: 'nyc-civic-finance',
            eventType: 'refresh',
            status: 'success',
            payload: {},
          });
          db.prepare('UPDATE events SET timestamp = ? WHERE id = ?').run(base + i * 1000, event.id);
        }
      }

      const health = getIntegrationHealth('nyc-civic-finance');

      expect(health.expectedIntervalMs).toBeGreaterThan(30 * MINUTE); // the quiet stretch
      expect(health.stale).toBe(false);
      expect(health.status).toBe('healthy');
    });

    it('does not declare a one-off smoke test dead', () => {
      // Three events seconds apart, months ago, never repeated. By ratio it is
      // millions of intervals overdue; it was simply never on a schedule.
      seedCadence('wiring-check', { everyMs: 1000, count: 3, silentForMs: 90 * 24 * 60 * MINUTE });

      const health = getIntegrationHealth('wiring-check');

      expect(health.expectedIntervalMs).toBeNull();
      expect(health.stale).toBe(false);
      expect(health.status).toBe('degraded'); // quiet, but not accused of dying
    });

    it('does not let a spotless success rate hide a dead integration', () => {
      seedCadence('weather', { everyMs: 5 * MINUTE, count: 20, silentForMs: 6 * 60 * MINUTE });

      const health = getIntegrationHealth('weather');

      // Every event it ever sent succeeded. It is still gone.
      expect(health.successRate).toBe(100);
      expect(health.errorsLast24h).toBe(0);
      expect(health.status).toBe('down');
    });
  });

  describe('getIntegrationHealth', () => {
    it('should return healthy status when no events exist', () => {
      const health = getIntegrationHealth('weather');

      // Never reported at all - nothing to be stale about.
      expect(health.status).toBe('healthy');
      expect(health.successRate).toBeNull();
      expect(health.eventsLast24h).toBe(0);
      expect(health.errorsLast24h).toBe(0);
    });

    it('should return degraded when an integration has gone silent', () => {
      const event = createEvent({
        integration: 'weather',
        eventType: 'test.event',
        status: 'success',
        payload: {},
      });
      const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
      db.prepare('UPDATE events SET timestamp = ? WHERE id = ?').run(eightDaysAgo, event.id);

      const health = getIntegrationHealth('weather');

      // Reported before, nothing in 24h: stale, not a perfect score.
      expect(health.status).toBe('degraded');
      expect(health.successRate).toBeNull();
      expect(health.eventsLast24h).toBe(0);
      expect(health.lastSync).toEqual(new Date(eightDaysAgo));
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
