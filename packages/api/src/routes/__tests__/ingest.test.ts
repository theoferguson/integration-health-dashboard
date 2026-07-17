import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { clearEvents } from '../../services/eventStore.js';
import { createProject, type Project } from '../../services/projectStore.js';

const app = createApp();

describe('POST /api/ingest', () => {
  let project: Project;

  beforeEach(() => {
    clearEvents();
    project = createProject(`test-project-${Math.random()}`);
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
    const eventsResponse = await request(app).get('/api/events?integration=weather');
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

    const eventsResponse = await request(app).get('/api/events?integration=weather');
    expect(eventsResponse.body.events).toHaveLength(1);
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
