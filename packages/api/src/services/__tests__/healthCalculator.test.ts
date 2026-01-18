import { describe, it, expect, beforeEach } from 'vitest';
import {
  getIntegrationHealth,
  getAllIntegrationHealth,
  getOverallHealth,
} from '../healthCalculator.js';
import { createEvent, clearEvents } from '../eventStore.js';
import type { IntegrationType } from '../../types/index.js';

describe('healthCalculator', () => {
  beforeEach(() => {
    // Clear events before each test
    clearEvents();
  });

  describe('getIntegrationHealth', () => {
    it('should return healthy status when no events exist', () => {
      const health = getIntegrationHealth('procore');

      expect(health.status).toBe('healthy');
      expect(health.successRate).toBe(100);
      expect(health.eventsLast24h).toBe(0);
      expect(health.errorsLast24h).toBe(0);
    });

    it('should return healthy status with high success rate', () => {
      // Create 98 successful events and 2 failures (98% success)
      for (let i = 0; i < 98; i++) {
        createEvent({
          integration: 'procore',
          eventType: 'test.event',
          status: 'success',
          payload: {},
        });
      }
      for (let i = 0; i < 2; i++) {
        createEvent({
          integration: 'procore',
          eventType: 'test.event',
          status: 'failure',
          payload: {},
          error: { message: 'Test error' },
        });
      }

      const health = getIntegrationHealth('procore');

      expect(health.status).toBe('healthy');
      expect(health.successRate).toBe(98);
      expect(health.eventsLast24h).toBe(100);
      expect(health.errorsLast24h).toBe(2);
    });

    it('should return degraded status with moderate error rate', () => {
      // Create 90 successful events and 10 failures (90% success)
      for (let i = 0; i < 90; i++) {
        createEvent({
          integration: 'gusto',
          eventType: 'test.event',
          status: 'success',
          payload: {},
        });
      }
      for (let i = 0; i < 10; i++) {
        createEvent({
          integration: 'gusto',
          eventType: 'test.event',
          status: 'failure',
          payload: {},
          error: { message: 'Test error' },
        });
      }

      const health = getIntegrationHealth('gusto');

      expect(health.status).toBe('degraded');
      expect(health.successRate).toBe(90);
    });

    it('should return down status with high error rate', () => {
      // Create 80 successful events and 20 failures (80% success)
      for (let i = 0; i < 80; i++) {
        createEvent({
          integration: 'quickbooks',
          eventType: 'test.event',
          status: 'success',
          payload: {},
        });
      }
      for (let i = 0; i < 20; i++) {
        createEvent({
          integration: 'quickbooks',
          eventType: 'test.event',
          status: 'failure',
          payload: {},
          error: { message: 'Test error' },
        });
      }

      const health = getIntegrationHealth('quickbooks');

      expect(health.status).toBe('down');
      expect(health.successRate).toBe(80);
    });

    it('should include integration metadata', () => {
      const health = getIntegrationHealth('procore');

      expect(health.id).toBe('procore');
      expect(health.name).toBe('Procore');
      expect(health.description).toContain('Project management');
    });

    it('should track last sync time', () => {
      createEvent({
        integration: 'stripe_issuing',
        eventType: 'card.created',
        status: 'success',
        payload: {},
      });

      const health = getIntegrationHealth('stripe_issuing');

      expect(health.lastSync).not.toBeNull();
      expect(health.lastSync).toBeInstanceOf(Date);
    });
  });

  describe('getAllIntegrationHealth', () => {
    it('should return health for all 5 integrations', () => {
      const allHealth = getAllIntegrationHealth();

      expect(allHealth).toHaveLength(5);

      const integrationIds = allHealth.map((h) => h.id);
      expect(integrationIds).toContain('procore');
      expect(integrationIds).toContain('gusto');
      expect(integrationIds).toContain('quickbooks');
      expect(integrationIds).toContain('stripe_issuing');
      expect(integrationIds).toContain('certified_payroll');
    });

    it('should calculate health independently per integration', () => {
      // Add failures only to gusto
      for (let i = 0; i < 50; i++) {
        createEvent({
          integration: 'gusto',
          eventType: 'test.event',
          status: 'failure',
          payload: {},
          error: { message: 'Test error' },
        });
      }

      const allHealth = getAllIntegrationHealth();
      const gustoHealth = allHealth.find((h) => h.id === 'gusto');
      const procoreHealth = allHealth.find((h) => h.id === 'procore');

      expect(gustoHealth?.status).toBe('down');
      expect(procoreHealth?.status).toBe('healthy');
    });
  });

  describe('getOverallHealth', () => {
    it('should return correct counts when all healthy', () => {
      const overall = getOverallHealth();

      expect(overall.totalIntegrations).toBe(5);
      expect(overall.healthy).toBe(5);
      expect(overall.degraded).toBe(0);
      expect(overall.down).toBe(0);
    });

    it('should count degraded and down integrations', () => {
      // Make gusto degraded (90% success rate)
      for (let i = 0; i < 90; i++) {
        createEvent({
          integration: 'gusto',
          eventType: 'test.event',
          status: 'success',
          payload: {},
        });
      }
      for (let i = 0; i < 10; i++) {
        createEvent({
          integration: 'gusto',
          eventType: 'test.event',
          status: 'failure',
          payload: {},
          error: { message: 'Test error' },
        });
      }

      // Make quickbooks down (50% success rate)
      for (let i = 0; i < 50; i++) {
        createEvent({
          integration: 'quickbooks',
          eventType: 'test.event',
          status: 'success',
          payload: {},
        });
      }
      for (let i = 0; i < 50; i++) {
        createEvent({
          integration: 'quickbooks',
          eventType: 'test.event',
          status: 'failure',
          payload: {},
          error: { message: 'Test error' },
        });
      }

      const overall = getOverallHealth();

      expect(overall.totalIntegrations).toBe(5);
      expect(overall.healthy).toBe(3);
      expect(overall.degraded).toBe(1);
      expect(overall.down).toBe(1);
    });
  });
});
