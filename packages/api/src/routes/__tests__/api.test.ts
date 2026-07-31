import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { clearEvents, createEvent } from '../../services/eventStore.js';
import { findOrCreateUser, displayName } from '../../services/userStore.js';
import { createOrgForUser, getMembershipForUser, joinOrgByCode } from '../../services/orgStore.js';
import { createProject } from '../../services/projectStore.js';
import { createSessionToken } from '../../services/authToken.js';
import type { CreateEventInput } from '../../types/index.js';

const app = createApp();

// Events/integrations routes are org-scoped, so every test runs as an admin of
// a fresh org and reports events into that org's project.
let cookie: string;
let projectId: string;
let orgSeq = 0;

beforeEach(() => {
  clearEvents();
  const user = findOrCreateUser(`api-test-user-${orgSeq++}`);
  const org = createOrgForUser(user.id, `${user.githubLogin}'s org`);
  projectId = createProject('api-test-project', org.id).id;
  cookie = `ihd_session=${createSessionToken(user.id, displayName(user))}`;
});

/** createEvent scoped to this test's org project. */
function ev(input: Omit<CreateEventInput, 'projectId'>) {
  return createEvent({ ...input, projectId });
}

const authGet = (path: string) => request(app).get(path).set('Cookie', cookie);
const authPost = (path: string) => request(app).post(path).set('Cookie', cookie);

describe('API Integration Tests', () => {
  describe('GET /api/health', () => {
    it('should return health status', async () => {
      // health is not org-gated
      const response = await request(app).get('/api/health');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('ok');
      expect(response.body.timestamp).toBeDefined();
    });
  });

  describe('GET /api/integrations', () => {
    it('should return no integrations when no events have been reported', async () => {
      const response = await authGet('/api/integrations');

      expect(response.status).toBe(200);
      expect(response.body.integrations).toHaveLength(0);
    });

    it('should discover integrations dynamically from reported events', async () => {
      ev({ integration: 'weather', eventType: 'sync', status: 'success', payload: {} });

      const response = await authGet('/api/integrations');

      expect(response.status).toBe(200);
      expect(response.body.integrations).toHaveLength(1);
      expect(response.body.integrations[0]).toHaveProperty('id', 'weather');
      expect(response.body.integrations[0]).toHaveProperty('status');
    });

    it('should reject a request with no session (401)', async () => {
      expect((await request(app).get('/api/integrations')).status).toBe(401);
    });
  });

  describe('GET /api/integrations/health', () => {
    it('should return health overview and integrations', async () => {
      const response = await authGet('/api/integrations/health');

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
        ev({
          integration: 'weather',
          eventType: 'test',
          status: 'failure',
          payload: {},
          error: { message: 'Test error' },
        });
      }

      const response = await authGet('/api/integrations/health');

      const weatherHealth = response.body.integrations.find(
        (i: { id: string }) => i.id === 'weather'
      );
      expect(weatherHealth.status).toBe('down');
      expect(response.body.health.down).toBe(1);
    });
  });

  describe('GET /api/integrations/:id', () => {
    it('should return specific integration with recent events', async () => {
      ev({
        integration: 'weather',
        eventType: 'forecast.sync',
        status: 'success',
        payload: { zone: 'NYZ072' },
      });

      const response = await authGet('/api/integrations/weather');

      expect(response.status).toBe(200);
      expect(response.body.integration.id).toBe('weather');
      expect(response.body.recentEvents).toHaveLength(1);
      expect(response.body.recentEvents[0].eventType).toBe('forecast.sync');
    });
  });

  describe('GET /api/events', () => {
    it('should return events', async () => {
      ev({
        integration: 'weather',
        eventType: 'test',
        status: 'success',
        payload: {},
      });

      const response = await authGet('/api/events');

      expect(response.status).toBe(200);
      expect(response.body.events).toHaveLength(1);
      expect(response.body.total).toBe(1);
    });

    it('should not return events from another org', async () => {
      // An event with no project (or another org's project) must not leak in.
      const otherUser = findOrCreateUser('other-org-user');
      const otherOrg = createOrgForUser(otherUser.id, 'other org');
      const otherProject = createProject('other-project', otherOrg.id);
      createEvent({
        integration: 'weather',
        eventType: 'test',
        status: 'success',
        payload: {},
        projectId: otherProject.id,
      });

      const response = await authGet('/api/events');

      expect(response.body.events).toHaveLength(0);
    });

    it('should filter by integration', async () => {
      ev({
        integration: 'weather',
        eventType: 'test',
        status: 'success',
        payload: {},
      });
      ev({
        integration: 'nyt-news',
        eventType: 'test',
        status: 'success',
        payload: {},
      });

      const response = await authGet('/api/events?integration=weather');

      expect(response.body.events).toHaveLength(1);
      expect(response.body.events[0].integration).toBe('weather');
    });

    it('should filter by status', async () => {
      ev({
        integration: 'weather',
        eventType: 'test',
        status: 'success',
        payload: {},
      });
      ev({
        integration: 'weather',
        eventType: 'test',
        status: 'failure',
        payload: {},
        error: { message: 'Error' },
      });

      const response = await authGet('/api/events?status=failure');

      expect(response.body.events).toHaveLength(1);
      expect(response.body.events[0].status).toBe('failure');
    });

    it('should respect limit parameter', async () => {
      for (let i = 0; i < 10; i++) {
        ev({
          integration: 'weather',
          eventType: `event-${i}`,
          status: 'success',
          payload: {},
        });
      }

      const response = await authGet('/api/events?limit=5');

      expect(response.body.events).toHaveLength(5);
    });
  });

  describe('GET /api/events/:id', () => {
    it('should return specific event', async () => {
      const event = ev({
        integration: 'weather',
        eventType: 'test',
        status: 'success',
        payload: { data: 'test' },
      });

      const response = await authGet(`/api/events/${event.id}`);

      expect(response.status).toBe(200);
      expect(response.body.event.id).toBe(event.id);
      expect(response.body.event.payload).toEqual({ data: 'test' });
    });

    it('should return 404 for non-existent event', async () => {
      const response = await authGet('/api/events/non-existent-id');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Event not found');
    });
  });

  describe('POST /api/events/:id/classify', () => {
    it('should classify a failure event', async () => {
      const event = ev({
        integration: 'nyc-civic-finance',
        eventType: 'contributions.sync',
        status: 'failure',
        payload: {},
        error: {
          message: 'Authorization declined: spending_limit_exceeded',
          code: 'card_declined',
        },
      });

      const response = await authPost(`/api/events/${event.id}/classify`);

      expect(response.status).toBe(200);
      expect(response.body.classification).toBeDefined();
      expect(response.body.classification.category).toBe('spending_control');
      expect(response.body.classification.severity).toBe('high');
      expect(response.body.cached).toBe(false);
    });

    it('should return cached classification on second call', async () => {
      const event = ev({
        integration: 'nyt-news',
        eventType: 'sync.failed',
        status: 'failure',
        payload: {},
        error: { message: 'Rate limit exceeded', code: '429' },
      });

      // First call
      await authPost(`/api/events/${event.id}/classify`);

      // Second call
      const response = await authPost(`/api/events/${event.id}/classify`);

      expect(response.status).toBe(200);
      expect(response.body.cached).toBe(true);
    });

    it('should return 400 for success events', async () => {
      const event = ev({
        integration: 'weather',
        eventType: 'test',
        status: 'success',
        payload: {},
      });

      const response = await authPost(`/api/events/${event.id}/classify`);

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Only failed events');
    });

    it('should return 404 for non-existent event', async () => {
      const response = await authPost('/api/events/non-existent-id/classify');

      expect(response.status).toBe(404);
    });
  });

  describe('POST /api/events/:id/acknowledge', () => {
    it('should acknowledge a failure event', async () => {
      const event = ev({
        integration: 'weather',
        eventType: 'test',
        status: 'failure',
        payload: {},
        error: { message: 'Test error' },
      });

      const response = await authPost(`/api/events/${event.id}/acknowledge`).send({
        acknowledged_by: 'test-user',
      });

      expect(response.status).toBe(200);
      expect(response.body.event.resolution.status).toBe('acknowledged');
      expect(response.body.event.resolution.acknowledgedBy).toBe('test-user');
      expect(response.body.event.resolution.acknowledgedAt).toBeDefined();
    });

    it('should return 400 for success events', async () => {
      const event = ev({
        integration: 'weather',
        eventType: 'test',
        status: 'success',
        payload: {},
      });

      const response = await authPost(`/api/events/${event.id}/acknowledge`);

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Only failed events');
    });

    it('should return 404 for non-existent event', async () => {
      const response = await authPost('/api/events/non-existent-id/acknowledge');

      expect(response.status).toBe(404);
    });
  });

  describe('POST /api/events/:id/resolve', () => {
    it('should resolve a failure event', async () => {
      const event = ev({
        integration: 'weather',
        eventType: 'test',
        status: 'failure',
        payload: {},
        error: { message: 'Test error' },
      });

      const response = await authPost(`/api/events/${event.id}/resolve`).send({
        resolved_by: 'test-user',
        notes: 'Fixed the issue',
      });

      expect(response.status).toBe(200);
      expect(response.body.event.resolution.status).toBe('resolved');
      expect(response.body.event.resolution.resolvedBy).toBe('test-user');
      expect(response.body.event.resolution.resolvedAt).toBeDefined();
      expect(response.body.event.resolution.notes).toBe('Fixed the issue');
    });

    it('should resolve an acknowledged event', async () => {
      const event = ev({
        integration: 'weather',
        eventType: 'test',
        status: 'failure',
        payload: {},
        error: { message: 'Test error' },
      });

      // First acknowledge
      await authPost(`/api/events/${event.id}/acknowledge`).send({ acknowledged_by: 'user1' });

      // Then resolve
      const response = await authPost(`/api/events/${event.id}/resolve`).send({
        resolved_by: 'user2',
      });

      expect(response.status).toBe(200);
      expect(response.body.event.resolution.status).toBe('resolved');
    });

    it('should return 400 for success events', async () => {
      const event = ev({
        integration: 'weather',
        eventType: 'test',
        status: 'success',
        payload: {},
      });

      const response = await authPost(`/api/events/${event.id}/resolve`);

      expect(response.status).toBe(400);
    });

    it('should return 404 for non-existent event', async () => {
      const response = await authPost('/api/events/non-existent-id/resolve');

      expect(response.status).toBe(404);
    });
  });

  describe('POST /api/events/:id/reopen', () => {
    it('should reopen a resolved event', async () => {
      const event = ev({
        integration: 'weather',
        eventType: 'test',
        status: 'failure',
        payload: {},
        error: { message: 'Test error' },
      });

      // First resolve
      await authPost(`/api/events/${event.id}/resolve`).send({ resolved_by: 'user1' });

      // Then reopen
      const response = await authPost(`/api/events/${event.id}/reopen`);

      expect(response.status).toBe(200);
      expect(response.body.event.resolution.status).toBe('open');
    });

    it('should reopen an acknowledged event', async () => {
      const event = ev({
        integration: 'weather',
        eventType: 'test',
        status: 'failure',
        payload: {},
        error: { message: 'Test error' },
      });

      // First acknowledge
      await authPost(`/api/events/${event.id}/acknowledge`).send({ acknowledged_by: 'user1' });

      // Then reopen
      const response = await authPost(`/api/events/${event.id}/reopen`);

      expect(response.status).toBe(200);
      expect(response.body.event.resolution.status).toBe('open');
    });

    it('should return 400 for success events', async () => {
      const event = ev({
        integration: 'weather',
        eventType: 'test',
        status: 'success',
        payload: {},
      });

      const response = await authPost(`/api/events/${event.id}/reopen`);

      expect(response.status).toBe(400);
    });

    it('should return 404 for non-existent event', async () => {
      const response = await authPost('/api/events/non-existent-id/reopen');

      expect(response.status).toBe(404);
    });
  });

  describe('viewers cannot mutate events', () => {
    it('rejects acknowledge/resolve/reopen/classify from a viewer with 403', async () => {
      // A viewer in the same org as the beforeEach admin.
      const org = getMembershipForUser(
        findOrCreateUser(`api-test-user-${orgSeq - 1}`).id
      )!.org;
      const viewer = findOrCreateUser(`viewer-${orgSeq}`);
      joinOrgByCode(viewer.id, org.inviteCode);
      const viewerCookie = `ihd_session=${createSessionToken(viewer.id, displayName(viewer))}`;

      const event = ev({ integration: 'weather', eventType: 'test', status: 'failure', payload: {} });

      for (const action of ['acknowledge', 'resolve', 'reopen', 'classify']) {
        const res = await request(app)
          .post(`/api/events/${event.id}/${action}`)
          .set('Cookie', viewerCookie);
        expect(res.status).toBe(403);
      }

      // ...but the viewer can still read.
      const read = await request(app).get(`/api/events/${event.id}`).set('Cookie', viewerCookie);
      expect(read.status).toBe(200);
    });
  });
});
