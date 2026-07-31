import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { createSessionToken } from '../../services/authToken.js';
import { findOrCreateUser, displayName } from '../../services/userStore.js';
import { createOrgForUser, joinOrgByCode, getMembershipForUser } from '../../services/orgStore.js';
import { createProject } from '../../services/projectStore.js';

const app = createApp();

/** Creates a user who is an admin of their own new org, returns the session cookie. */
function adminCookieFor(login: string): string {
  const user = findOrCreateUser(login);
  createOrgForUser(user.id, `${login}'s org`);
  return `ihd_session=${createSessionToken(user.id, displayName(user))}`;
}

/** Creates a user with no org membership at all. */
function orglessCookieFor(login: string): string {
  const user = findOrCreateUser(login);
  return `ihd_session=${createSessionToken(user.id, displayName(user))}`;
}

/** Creates a user who joins an existing org as a viewer via its invite code. */
function viewerCookieFor(login: string, inviteCode: string): string {
  const user = findOrCreateUser(login);
  joinOrgByCode(user.id, inviteCode);
  return `ihd_session=${createSessionToken(user.id, displayName(user))}`;
}

function inviteCodeForAdmin(adminLogin: string): string {
  const user = findOrCreateUser(adminLogin);
  return getMembershipForUser(user.id)!.org.inviteCode;
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

  it('should reject a signed-in user who belongs to no org (403)', async () => {
    const cookie = orglessCookieFor('orgless-user');
    expect((await request(app).get('/api/projects').set('Cookie', cookie)).status).toBe(403);
  });
});

describe('POST /api/projects', () => {
  it("should create a project owned by the admin's org, returning the api key", async () => {
    const cookie = adminCookieFor('creator1');

    const response = await request(app)
      .post('/api/projects')
      .set('Cookie', cookie)
      .send({ name: 'my-app' });

    expect(response.status).toBe(201);
    expect(response.body.project.name).toBe('my-app');
    expect(response.body.project.apiKey).toMatch(/^proj_/);
  });

  it('should reject a missing or empty name', async () => {
    const cookie = adminCookieFor('creator2');

    const empty = await request(app).post('/api/projects').set('Cookie', cookie).send({ name: '' });
    const missing = await request(app).post('/api/projects').set('Cookie', cookie).send({});

    expect(empty.status).toBe(400);
    expect(missing.status).toBe(400);
  });

  it('should forbid a viewer from creating a project (403)', async () => {
    adminCookieFor('viewer-create-admin');
    const viewerCookie = viewerCookieFor(
      'viewer-create-viewer',
      inviteCodeForAdmin('viewer-create-admin')
    );

    const response = await request(app)
      .post('/api/projects')
      .set('Cookie', viewerCookie)
      .send({ name: 'nope' });

    expect(response.status).toBe(403);
  });
});

describe('GET /api/projects', () => {
  it("should only list the caller's org projects, without the api key", async () => {
    const aliceCookie = adminCookieFor('alice-route');
    const bobCookie = adminCookieFor('bob-route');

    await request(app).post('/api/projects').set('Cookie', aliceCookie).send({ name: 'alice-1' });
    await request(app).post('/api/projects').set('Cookie', aliceCookie).send({ name: 'alice-2' });
    await request(app).post('/api/projects').set('Cookie', bobCookie).send({ name: 'bob-1' });

    const aliceList = await request(app).get('/api/projects').set('Cookie', aliceCookie);

    expect(aliceList.body.projects).toHaveLength(2);
    expect(aliceList.body.projects.every((p: { apiKey?: string }) => p.apiKey === undefined)).toBe(
      true
    );
  });

  it('should let a viewer see their org projects (read access)', async () => {
    const adminCookie = adminCookieFor('viewer-list-admin');
    await request(app).post('/api/projects').set('Cookie', adminCookie).send({ name: 'shared-1' });
    const viewerCookie = viewerCookieFor(
      'viewer-list-viewer',
      inviteCodeForAdmin('viewer-list-admin')
    );

    const list = await request(app).get('/api/projects').set('Cookie', viewerCookie);

    expect(list.status).toBe(200);
    expect(list.body.projects).toHaveLength(1);
    expect(list.body.projects[0].name).toBe('shared-1');
  });
});

describe('DELETE /api/projects/:id', () => {
  it("should delete a project owned by the admin's org", async () => {
    const cookie = adminCookieFor('deleter-route');
    const created = await request(app)
      .post('/api/projects')
      .set('Cookie', cookie)
      .send({ name: 'to-delete' });

    const response = await request(app)
      .delete(`/api/projects/${created.body.project.id}`)
      .set('Cookie', cookie);

    expect(response.status).toBe(200);
  });

  it('should forbid a viewer from deleting a project (403)', async () => {
    const adminCookie = adminCookieFor('viewer-del-admin');
    const created = await request(app)
      .post('/api/projects')
      .set('Cookie', adminCookie)
      .send({ name: 'viewer-cant-delete' });
    const viewerCookie = viewerCookieFor(
      'viewer-del-viewer',
      inviteCodeForAdmin('viewer-del-admin')
    );

    const response = await request(app)
      .delete(`/api/projects/${created.body.project.id}`)
      .set('Cookie', viewerCookie);

    expect(response.status).toBe(403);
  });

  it("should not delete another org's project (404, not 403 - no ownership probing)", async () => {
    const owner = findOrCreateUser('real-owner-route');
    const ownerOrg = createOrgForUser(owner.id, "real-owner's org");
    const project = createProject('protected-route', ownerOrg.id);
    const attackerCookie = adminCookieFor('attacker-route');

    const response = await request(app)
      .delete(`/api/projects/${project.id}`)
      .set('Cookie', attackerCookie);

    expect(response.status).toBe(404);
  });

  it('should return 404 for a non-existent project id', async () => {
    const cookie = adminCookieFor('deleter-route-2');

    const response = await request(app).delete('/api/projects/not-a-real-id').set('Cookie', cookie);

    expect(response.status).toBe(404);
  });
});
