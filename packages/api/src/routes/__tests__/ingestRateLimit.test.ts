import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { Project } from '../../services/projectStore.js';

// The limiter reads its cap from env at module load, so set a tiny limit and
// import the app dynamically (vitest isolates modules per file, so this env
// only affects this suite).
describe('POST /api/ingest rate limiting', () => {
  let app: Express;
  let projectA: Project;
  let projectB: Project;

  beforeAll(async () => {
    process.env.INGEST_RATE_LIMIT_PER_MIN = '3';
    const { createApp } = await import('../../app.js');
    const { createProject } = await import('../../services/projectStore.js');
    app = createApp();
    projectA = createProject(`rl-a-${Math.random()}`);
    projectB = createProject(`rl-b-${Math.random()}`);
  });

  const body = {
    schemaVersion: 1,
    integration: 'weather',
    event_type: 'forecast.sync',
    status: 'success',
    payload: {},
  };

  const post = (project: Project) =>
    request(app).post('/api/ingest').set('Authorization', `Bearer ${project.apiKey}`).send(body);

  it('429s once a project exceeds its per-window budget', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await post(projectA)).status);

    expect(codes.slice(0, 3)).toEqual([201, 201, 201]);
    expect(codes.slice(3)).toEqual([429, 429]);
  });

  it('meters each project separately (a flood from one does not throttle another)', async () => {
    // projectA is already exhausted from the test above; projectB is untouched.
    const response = await post(projectB);
    expect(response.status).toBe(201);
  });
});
