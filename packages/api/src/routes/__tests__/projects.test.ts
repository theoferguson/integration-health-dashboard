import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { createSessionToken } from '../../services/authToken.js';
import { findOrCreateUser } from '../../services/userStore.js';
import { createProject } from '../../services/projectStore.js';

const app = createApp();

function cookieFor(login: string): string {
  const user = findOrCreateUser(login);
  return `ihd_session=${createSessionToken(user.id, user.githubLogin)}`;
}

describe('projects routes auth gating', () => {
  it('should reject GET /api/projects with no session', async () => {
    expect((await request(app).get('/api/projects')).status).toBe(401);
  });

  it('should reject POST /api/projects with no session', async () => {
    expect((await request(app).post('/api/projects').send({ name: 'x' })).status).toBe(401);
  });

  it('should reject DELETE /api/projects/:id with no session', async () => {
    expect((await request(app).delete('/api/projects/whatever')).status).toBe(401);
  });
});

describe('POST /api/projects', () => {
  it('should create a project owned by the signed-in user, returning the api key', async () => {
    const cookie = cookieFor('creator1');

    const response = await request(app)
      .post('/api/projects')
      .set('Cookie', cookie)
      .send({ name: 'my-app' });

    expect(response.status).toBe(201);
    expect(response.body.project.name).toBe('my-app');
    expect(response.body.project.apiKey).toMatch(/^proj_/);
  });

  it('should reject a missing or empty name', async () => {
    const cookie = cookieFor('creator2');

    const empty = await request(app).post('/api/projects').set('Cookie', cookie).send({ name: '' });
    const missing = await request(app).post('/api/projects').set('Cookie', cookie).send({});

    expect(empty.status).toBe(400);
    expect(missing.status).toBe(400);
  });
});

describe('GET /api/projects', () => {
  it("should only list the signed-in user's own projects, without the api key", async () => {
    const aliceCookie = cookieFor('alice-route');
    const bobCookie = cookieFor('bob-route');

    await request(app).post('/api/projects').set('Cookie', aliceCookie).send({ name: 'alice-1' });
    await request(app).post('/api/projects').set('Cookie', aliceCookie).send({ name: 'alice-2' });
    await request(app).post('/api/projects').set('Cookie', bobCookie).send({ name: 'bob-1' });

    const aliceList = await request(app).get('/api/projects').set('Cookie', aliceCookie);

    expect(aliceList.body.projects).toHaveLength(2);
    expect(aliceList.body.projects.every((p: { apiKey?: string }) => p.apiKey === undefined)).toBe(
      true
    );
  });
});

describe('DELETE /api/projects/:id', () => {
  it('should delete a project owned by the signed-in user', async () => {
    const cookie = cookieFor('deleter-route');
    const created = await request(app)
      .post('/api/projects')
      .set('Cookie', cookie)
      .send({ name: 'to-delete' });

    const response = await request(app)
      .delete(`/api/projects/${created.body.project.id}`)
      .set('Cookie', cookie);

    expect(response.status).toBe(200);
  });

  it("should not delete another user's project (404, not 403 - no ownership probing)", async () => {
    const owner = findOrCreateUser('real-owner-route');
    const project = createProject('protected-route', owner.id);
    const attackerCookie = cookieFor('attacker-route');

    const response = await request(app)
      .delete(`/api/projects/${project.id}`)
      .set('Cookie', attackerCookie);

    expect(response.status).toBe(404);
  });

  it('should return 404 for a non-existent project id', async () => {
    const cookie = cookieFor('deleter-route-2');

    const response = await request(app).delete('/api/projects/not-a-real-id').set('Cookie', cookie);

    expect(response.status).toBe(404);
  });
});
