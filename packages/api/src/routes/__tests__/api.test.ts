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
    it('should return all integrations', async () => {
      const response = await request(app).get('/api/integrations');

      expect(response.status).toBe(200);
      expect(response.body.integrations).toHaveLength(5);
      expect(response.body.integrations[0]).toHaveProperty('id');
      expect(response.body.integrations[0]).toHaveProperty('name');
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
      expect(response.body.integrations).toHaveLength(5);
    });

    it('should reflect event data in health status', async () => {
      // Create failures for procore
      for (let i = 0; i < 30; i++) {
        createEvent({
          integration: 'procore',
          eventType: 'test',
          status: 'failure',
          payload: {},
          error: { message: 'Test error' },
        });
      }

      const response = await request(app).get('/api/integrations/health');

      const procoreHealth = response.body.integrations.find(
        (i: { id: string }) => i.id === 'procore'
      );
      expect(procoreHealth.status).toBe('down');
      expect(response.body.health.down).toBe(1);
    });
  });

  describe('GET /api/integrations/:id', () => {
    it('should return specific integration with recent events', async () => {
      createEvent({
        integration: 'procore',
        eventType: 'project.sync',
        status: 'success',
        payload: { project_id: 123 },
      });

      const response = await request(app).get('/api/integrations/procore');

      expect(response.status).toBe(200);
      expect(response.body.integration.id).toBe('procore');
      expect(response.body.recentEvents).toHaveLength(1);
      expect(response.body.recentEvents[0].eventType).toBe('project.sync');
    });
  });

  describe('GET /api/events', () => {
    it('should return events', async () => {
      createEvent({
        integration: 'procore',
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

      const response = await request(app).get('/api/events?integration=procore');

      expect(response.body.events).toHaveLength(1);
      expect(response.body.events[0].integration).toBe('procore');
    });

    it('should filter by status', async () => {
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

      const response = await request(app).get('/api/events?status=failure');

      expect(response.body.events).toHaveLength(1);
      expect(response.body.events[0].status).toBe('failure');
    });

    it('should respect limit parameter', async () => {
      for (let i = 0; i < 10; i++) {
        createEvent({
          integration: 'procore',
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
        integration: 'procore',
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
        integration: 'stripe_issuing',
        eventType: 'authorization.declined',
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
        integration: 'gusto',
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
        integration: 'procore',
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

  describe('POST /api/webhooks/*', () => {
    it('should receive procore webhook', async () => {
      const response = await request(app)
        .post('/api/webhooks/procore')
        .send({
          event_type: 'project.updated',
          resource: { type: 'project', id: 123 },
        });

      expect(response.status).toBe(200);
      expect(response.body.received).toBe(true);
      expect(response.body.event_id).toBeDefined();
      expect(response.body.status).toBe('success');
    });

    it('should handle simulated errors', async () => {
      const response = await request(app)
        .post('/api/webhooks/procore')
        .send({
          event_type: 'project.sync',
          error_simulation: 'project_archived',
        });

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('failure');

      // Verify event was stored
      const eventsResponse = await request(app).get('/api/events?status=failure');
      expect(eventsResponse.body.events).toHaveLength(1);
    });

    it('should receive gusto webhook', async () => {
      const response = await request(app)
        .post('/api/webhooks/gusto')
        .send({
          event_type: 'employee.created',
          employee: { id: 'emp_123', name: 'John Doe' },
        });

      expect(response.status).toBe(200);
      expect(response.body.received).toBe(true);
    });

    it('should receive quickbooks webhook', async () => {
      const response = await request(app)
        .post('/api/webhooks/quickbooks')
        .send({
          event_type: 'invoice.created',
          entity: { type: 'invoice', id: 'inv_123' },
        });

      expect(response.status).toBe(200);
      expect(response.body.received).toBe(true);
    });

    it('should receive stripe webhook', async () => {
      const response = await request(app)
        .post('/api/webhooks/stripe')
        .send({
          type: 'issuing_authorization.created',
          data: {
            object: {
              amount: 100,
              card: { id: 'card_123' },
              cardholder: { name: 'Mike Torres' },
            },
          },
        });

      expect(response.status).toBe(200);
      expect(response.body.received).toBe(true);
    });

    it('should receive certified payroll webhook', async () => {
      const response = await request(app)
        .post('/api/webhooks/certified-payroll')
        .send({
          event_type: 'report.generated',
          report: { type: 'WH-347', id: 'rpt_123' },
        });

      expect(response.status).toBe(200);
      expect(response.body.received).toBe(true);
    });
  });

  describe('POST /api/events/:id/acknowledge', () => {
    it('should acknowledge a failure event', async () => {
      const event = createEvent({
        integration: 'procore',
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
        integration: 'procore',
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
        integration: 'procore',
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
        integration: 'procore',
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
        integration: 'procore',
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
        integration: 'procore',
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
        integration: 'procore',
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
        integration: 'procore',
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

  describe('POST /api/simulate', () => {
    it('should seed demo data', async () => {
      const response = await request(app).post('/api/simulate');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.successCount).toBeGreaterThan(0);
      expect(response.body.errorCount).toBeGreaterThan(0);
    });

    it('should reset events when reset=true', async () => {
      // Create some events first
      createEvent({
        integration: 'procore',
        eventType: 'test',
        status: 'success',
        payload: {},
      });

      const response = await request(app).post('/api/simulate?reset=true');

      expect(response.status).toBe(200);

      // Events should be from simulation only
      const eventsResponse = await request(app).get('/api/events');
      expect(eventsResponse.body.events.length).toBe(
        response.body.successCount + response.body.errorCount
      );
    });
  });
});
