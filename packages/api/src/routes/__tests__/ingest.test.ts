import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { clearEvents } from '../../services/eventStore.js';
import { createProject, type Project } from '../../services/projectStore.js';
import { findOrCreateUser, displayName } from '../../services/userStore.js';
import { createOrgForUser } from '../../services/orgStore.js';
import { createSessionToken } from '../../services/authToken.js';

const app = createApp();

describe('POST /api/ingest', () => {
  let project: Project;
  let cookie: string;
  let seq = 0;

  beforeEach(() => {
    clearEvents();
    const user = findOrCreateUser(`ingest-test-user-${seq++}`);
    const org = createOrgForUser(user.id, `${user.githubLogin}'s org`);
    project = createProject(`test-project-${Math.random()}`, org.id);
    cookie = `ihd_session=${createSessionToken(user.id, displayName(user))}`;
  });

  const validBody = {
    schemaVersion: 1,
    integration: 'weather',
    event_type: 'forecast.sync',
    status: 'success',
    payload: { zone: 'NYZ072' },
  };

  it('should reject requests with no Authorization header', async () => {
    const response = await request(app).post('/api/ingest').send(validBody);

    expect(response.status).toBe(401);
  });

  it('should reject requests with an invalid api key', async () => {
    const response = await request(app)
      .post('/api/ingest')
      .set('Authorization', 'Bearer not-a-real-key')
      .send(validBody);

    expect(response.status).toBe(401);
  });

  it('should reject a body missing schemaVersion', async () => {
    const { schemaVersion, ...rest } = validBody;
    const response = await request(app)
      .post('/api/ingest')
      .set('Authorization', `Bearer ${project.apiKey}`)
      .send(rest);

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('schemaVersion');
  });

  it('should reject a payload over the size limit', async () => {
    const response = await request(app)
      .post('/api/ingest')
      .set('Authorization', `Bearer ${project.apiKey}`)
      .send({ ...validBody, payload: { blob: 'x'.repeat(33 * 1024) } });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('payload exceeds');
  });

  it('should reject an invalid status value', async () => {
    const response = await request(app)
      .post('/api/ingest')
      .set('Authorization', `Bearer ${project.apiKey}`)
      .send({ ...validBody, status: 'not-a-status' });

    expect(response.status).toBe(400);
  });

  it('should reject an error object missing a message', async () => {
    const response = await request(app)
      .post('/api/ingest')
      .set('Authorization', `Bearer ${project.apiKey}`)
      .send({ ...validBody, status: 'failure', error: { code: 'ETIMEDOUT' } });

    expect(response.status).toBe(400);
  });

  it('should create an event for a valid request', async () => {
    const response = await request(app)
      .post('/api/ingest')
      .set('Authorization', `Bearer ${project.apiKey}`)
      .send(validBody);

    expect(response.status).toBe(201);
    expect(response.body.duplicate).toBe(false);
    expect(response.body.event.integration).toBe('weather');
    expect(response.body.event.eventType).toBe('forecast.sync');
    expect(response.body.event.status).toBe('success');
    expect(response.body.event.payload).toEqual({ zone: 'NYZ072' });

    // Confirm it's actually queryable through the regular events API
    const eventsResponse = await request(app)
      .get('/api/events?integration=weather')
      .set('Cookie', cookie);
    expect(eventsResponse.body.events).toHaveLength(1);
  });

  it('should record failure events with error details', async () => {
    const response = await request(app)
      .post('/api/ingest')
      .set('Authorization', `Bearer ${project.apiKey}`)
      .send({
        ...validBody,
        status: 'failure',
        error: { message: 'Rate limit exceeded', code: '429' },
      });

    expect(response.status).toBe(201);
    expect(response.body.event.error.message).toBe('Rate limit exceeded');
    expect(response.body.event.error.code).toBe('429');
  });

  it('should dedupe a repeated idempotency_key instead of creating a second event', async () => {
    const body = { ...validBody, idempotency_key: 'retry-key-1' };

    const first = await request(app)
      .post('/api/ingest')
      .set('Authorization', `Bearer ${project.apiKey}`)
      .send(body);
    const second = await request(app)
      .post('/api/ingest')
      .set('Authorization', `Bearer ${project.apiKey}`)
      .send(body);

    expect(first.status).toBe(201);
    expect(first.body.duplicate).toBe(false);
    expect(second.status).toBe(200);
    expect(second.body.duplicate).toBe(true);
    expect(second.body.event.id).toBe(first.body.event.id);

    const eventsResponse = await request(app)
      .get('/api/events?integration=weather')
      .set('Cookie', cookie);
    expect(eventsResponse.body.events).toHaveLength(1);
  });

  describe('schemaVersion 2 dimensions', () => {
    it('accepts and persists metrics/tags/environment/severity/source', async () => {
      const response = await request(app)
        .post('/api/ingest')
        .set('Authorization', `Bearer ${project.apiKey}`)
        .send({
          schemaVersion: 2,
          integration: 'weather',
          event_type: 'forecast.sync',
          status: 'success',
          payload: {},
          metrics: { latencyMs: 214, itemCount: 12 },
          tags: { region: 'us-east' },
          environment: 'prod',
          severity: 'high',
          source: 'iha@1.4.0',
        });

      expect(response.status).toBe(201);
      const ev = response.body.event;
      expect(ev.metrics).toEqual({ latencyMs: 214, itemCount: 12 });
      expect(ev.tags).toEqual({ region: 'us-east' });
      expect(ev.environment).toBe('prod');
      expect(ev.severity).toBe('high');
      expect(ev.source).toBe('iha@1.4.0');
      // id is a UUIDv7 (version nibble 7)
      expect(ev.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

      // survives a round-trip through the events API
      const read = await request(app).get('/api/events?integration=weather').set('Cookie', cookie);
      expect(read.body.events[0].metrics).toEqual({ latencyMs: 214, itemCount: 12 });
      expect(read.body.events[0].severity).toBe('high');
    });

    it('rejects a non-numeric metric value', async () => {
      const response = await request(app)
        .post('/api/ingest')
        .set('Authorization', `Bearer ${project.apiKey}`)
        .send({ ...validBody, schemaVersion: 2, metrics: { latencyMs: 'fast' } });
      expect(response.status).toBe(400);
      expect(response.body.error).toContain('metrics');
    });

    it('rejects an out-of-range severity', async () => {
      const response = await request(app)
        .post('/api/ingest')
        .set('Authorization', `Bearer ${project.apiKey}`)
        .send({ ...validBody, schemaVersion: 2, severity: 'catastrophic' });
      expect(response.status).toBe(400);
      expect(response.body.error).toContain('severity');
    });
  });

  it('should not dedupe the same idempotency_key across different projects', async () => {
    const otherProject = createProject('other-project');
    const body = { ...validBody, idempotency_key: 'shared-key' };

    const first = await request(app)
      .post('/api/ingest')
      .set('Authorization', `Bearer ${project.apiKey}`)
      .send(body);
    const second = await request(app)
      .post('/api/ingest')
      .set('Authorization', `Bearer ${otherProject.apiKey}`)
      .send(body);

    expect(first.body.duplicate).toBe(false);
    expect(second.body.duplicate).toBe(false);
    expect(second.body.event.id).not.toBe(first.body.event.id);
  });
});
