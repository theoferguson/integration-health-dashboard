import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { clearEvents, createEvent } from '../../services/eventStore.js';

const app = createApp();

describe('API Integration Tests', () => {
  beforeEach(() => {
    clearEvents();
  });

  describe('GET /api/health', () => {
    it('should return health status', async () => {
      const response = await request(app).get('/api/health');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('ok');
      expect(response.body.timestamp).toBeDefined();
    });
  });

  describe('GET /api/integrations', () => {
    it('should return no integrations when no events have been reported', async () => {
      const response = await request(app).get('/api/integrations');

      expect(response.status).toBe(200);
      expect(response.body.integrations).toHaveLength(0);
    });

    it('should discover integrations dynamically from reported events', async () => {
      createEvent({ integration: 'weather', eventType: 'sync', status: 'success', payload: {} });

      const response = await request(app).get('/api/integrations');

      expect(response.status).toBe(200);
      expect(response.body.integrations).toHaveLength(1);
      expect(response.body.integrations[0]).toHaveProperty('id', 'weather');
      expect(response.body.integrations[0]).toHaveProperty('status');
    });
  });

  describe('GET /api/integrations/health', () => {
    it('should return health overview and integrations', async () => {
      const response = await request(app).get('/api/integrations/health');

      expect(response.status).toBe(200);
      expect(response.body.health).toHaveProperty('totalIntegrations');
      expect(response.body.health).toHaveProperty('healthy');
      expect(response.body.health).toHaveProperty('degraded');
      expect(response.body.health).toHaveProperty('down');
      expect(response.body.integrations).toHaveLength(0);
    });

    it('should reflect event data in health status', async () => {
      // Create failures for weather
      for (let i = 0; i < 30; i++) {
        createEvent({
          integration: 'weather',
          eventType: 'test',
          status: 'failure',
          payload: {},
          error: { message: 'Test error' },
        });
      }

      const response = await request(app).get('/api/integrations/health');

      const weatherHealth = response.body.integrations.find(
        (i: { id: string }) => i.id === 'weather'
      );
      expect(weatherHealth.status).toBe('down');
      expect(response.body.health.down).toBe(1);
    });
  });

  describe('GET /api/integrations/:id', () => {
    it('should return specific integration with recent events', async () => {
      createEvent({
        integration: 'weather',
        eventType: 'forecast.sync',
        status: 'success',
        payload: { zone: 'NYZ072' },
      });

      const response = await request(app).get('/api/integrations/weather');

      expect(response.status).toBe(200);
      expect(response.body.integration.id).toBe('weather');
      expect(response.body.recentEvents).toHaveLength(1);
      expect(response.body.recentEvents[0].eventType).toBe('forecast.sync');
    });
  });

  describe('GET /api/events', () => {
    it('should return events', async () => {
      createEvent({
        integration: 'weather',
        eventType: 'test',
        status: 'success',
        payload: {},
      });

      const response = await request(app).get('/api/events');

      expect(response.status).toBe(200);
      expect(response.body.events).toHaveLength(1);
      expect(response.body.total).toBe(1);
    });

    it('should filter by integration', async () => {
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

      const response = await request(app).get('/api/events?integration=weather');

      expect(response.body.events).toHaveLength(1);
      expect(response.body.events[0].integration).toBe('weather');
    });

    it('should filter by status', async () => {
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

      const response = await request(app).get('/api/events?status=failure');

      expect(response.body.events).toHaveLength(1);
      expect(response.body.events[0].status).toBe('failure');
    });

    it('should respect limit parameter', async () => {
      for (let i = 0; i < 10; i++) {
        createEvent({
          integration: 'weather',
          eventType: `event-${i}`,
          status: 'success',
          payload: {},
        });
      }

      const response = await request(app).get('/api/events?limit=5');

      expect(response.body.events).toHaveLength(5);
    });
  });

  describe('GET /api/events/:id', () => {
    it('should return specific event', async () => {
      const event = createEvent({
        integration: 'weather',
        eventType: 'test',
        status: 'success',
        payload: { data: 'test' },
      });

      const response = await request(app).get(`/api/events/${event.id}`);

      expect(response.status).toBe(200);
      expect(response.body.event.id).toBe(event.id);
      expect(response.body.event.payload).toEqual({ data: 'test' });
    });

    it('should return 404 for non-existent event', async () => {
      const response = await request(app).get('/api/events/non-existent-id');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Event not found');
    });
  });

  describe('POST /api/events/:id/classify', () => {
    it('should classify a failure event', async () => {
      const event = createEvent({
        integration: 'nyc-civic-finance',
        eventType: 'contributions.sync',
        status: 'failure',
        payload: {},
        error: {
          message: 'Authorization declined: spending_limit_exceeded',
          code: 'card_declined',
        },
      });

      const response = await request(app).post(`/api/events/${event.id}/classify`);

      expect(response.status).toBe(200);
      expect(response.body.classification).toBeDefined();
      expect(response.body.classification.category).toBe('spending_control');
      expect(response.body.classification.severity).toBe('high');
      expect(response.body.cached).toBe(false);
    });

    it('should return cached classification on second call', async () => {
      const event = createEvent({
        integration: 'nyt-news',
        eventType: 'sync.failed',
        status: 'failure',
        payload: {},
        error: { message: 'Rate limit exceeded', code: '429' },
      });

      // First call
      await request(app).post(`/api/events/${event.id}/classify`);

      // Second call
      const response = await request(app).post(`/api/events/${event.id}/classify`);

      expect(response.status).toBe(200);
      expect(response.body.cached).toBe(true);
    });

    it('should return 400 for success events', async () => {
      const event = createEvent({
        integration: 'weather',
        eventType: 'test',
        status: 'success',
        payload: {},
      });

      const response = await request(app).post(`/api/events/${event.id}/classify`);

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Only failed events');
    });

    it('should return 404 for non-existent event', async () => {
      const response = await request(app).post(
        '/api/events/non-existent-id/classify'
      );

      expect(response.status).toBe(404);
    });
  });

  describe('POST /api/events/:id/acknowledge', () => {
    it('should acknowledge a failure event', async () => {
      const event = createEvent({
        integration: 'weather',
        eventType: 'test',
        status: 'failure',
        payload: {},
        error: { message: 'Test error' },
      });

      const response = await request(app)
        .post(`/api/events/${event.id}/acknowledge`)
        .send({ acknowledged_by: 'test-user' });

      expect(response.status).toBe(200);
      expect(response.body.event.resolution.status).toBe('acknowledged');
      expect(response.body.event.resolution.acknowledgedBy).toBe('test-user');
      expect(response.body.event.resolution.acknowledgedAt).toBeDefined();
    });

    it('should return 400 for success events', async () => {
      const event = createEvent({
        integration: 'weather',
        eventType: 'test',
        status: 'success',
        payload: {},
      });

      const response = await request(app).post(
        `/api/events/${event.id}/acknowledge`
      );

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Only failed events');
    });

    it('should return 404 for non-existent event', async () => {
      const response = await request(app).post(
        '/api/events/non-existent-id/acknowledge'
      );

      expect(response.status).toBe(404);
    });
  });

  describe('POST /api/events/:id/resolve', () => {
    it('should resolve a failure event', async () => {
      const event = createEvent({
        integration: 'weather',
        eventType: 'test',
        status: 'failure',
        payload: {},
        error: { message: 'Test error' },
      });

      const response = await request(app)
        .post(`/api/events/${event.id}/resolve`)
        .send({ resolved_by: 'test-user', notes: 'Fixed the issue' });

      expect(response.status).toBe(200);
      expect(response.body.event.resolution.status).toBe('resolved');
      expect(response.body.event.resolution.resolvedBy).toBe('test-user');
      expect(response.body.event.resolution.resolvedAt).toBeDefined();
      expect(response.body.event.resolution.notes).toBe('Fixed the issue');
    });

    it('should resolve an acknowledged event', async () => {
      const event = createEvent({
        integration: 'weather',
        eventType: 'test',
        status: 'failure',
        payload: {},
        error: { message: 'Test error' },
      });

      // First acknowledge
      await request(app)
        .post(`/api/events/${event.id}/acknowledge`)
        .send({ acknowledged_by: 'user1' });

      // Then resolve
      const response = await request(app)
        .post(`/api/events/${event.id}/resolve`)
        .send({ resolved_by: 'user2' });

      expect(response.status).toBe(200);
      expect(response.body.event.resolution.status).toBe('resolved');
    });

    it('should return 400 for success events', async () => {
      const event = createEvent({
        integration: 'weather',
        eventType: 'test',
        status: 'success',
        payload: {},
      });

      const response = await request(app).post(
        `/api/events/${event.id}/resolve`
      );

      expect(response.status).toBe(400);
    });

    it('should return 404 for non-existent event', async () => {
      const response = await request(app).post(
        '/api/events/non-existent-id/resolve'
      );

      expect(response.status).toBe(404);
    });
  });

  describe('POST /api/events/:id/reopen', () => {
    it('should reopen a resolved event', async () => {
      const event = createEvent({
        integration: 'weather',
        eventType: 'test',
        status: 'failure',
        payload: {},
        error: { message: 'Test error' },
      });

      // First resolve
      await request(app)
        .post(`/api/events/${event.id}/resolve`)
        .send({ resolved_by: 'user1' });

      // Then reopen
      const response = await request(app).post(
        `/api/events/${event.id}/reopen`
      );

      expect(response.status).toBe(200);
      expect(response.body.event.resolution.status).toBe('open');
    });

    it('should reopen an acknowledged event', async () => {
      const event = createEvent({
        integration: 'weather',
        eventType: 'test',
        status: 'failure',
        payload: {},
        error: { message: 'Test error' },
      });

      // First acknowledge
      await request(app)
        .post(`/api/events/${event.id}/acknowledge`)
        .send({ acknowledged_by: 'user1' });

      // Then reopen
      const response = await request(app).post(
        `/api/events/${event.id}/reopen`
      );

      expect(response.status).toBe(200);
      expect(response.body.event.resolution.status).toBe('open');
    });

    it('should return 400 for success events', async () => {
      const event = createEvent({
        integration: 'weather',
        eventType: 'test',
        status: 'success',
        payload: {},
      });

      const response = await request(app).post(`/api/events/${event.id}/reopen`);

      expect(response.status).toBe(400);
    });

    it('should return 404 for non-existent event', async () => {
      const response = await request(app).post(
        '/api/events/non-existent-id/reopen'
      );

      expect(response.status).toBe(404);
    });
  });
});
