import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { createSessionToken } from '../../services/authToken.js';
import { findOrCreateUser, displayName } from '../../services/userStore.js';
import { getMembershipForUser } from '../../services/orgStore.js';

const app = createApp();

function setCookieHeaders(response: request.Response): string[] {
  const header = response.headers['set-cookie'];
  return Array.isArray(header) ? header : header ? [header] : [];
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.GITHUB_OAUTH_CLIENT_ID = 'test-client-id';
  process.env.GITHUB_OAUTH_CLIENT_SECRET = 'test-client-secret';
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllGlobals();
});

describe('GET /api/auth/login', () => {
  it('should redirect to GitHub with client_id, redirect_uri, and a state param', async () => {
    const response = await request(app).get('/api/auth/login');

    expect(response.status).toBe(302);
    const location = new URL(response.headers.location);
    expect(location.hostname).toBe('github.com');
    expect(location.searchParams.get('client_id')).toBe('test-client-id');
    expect(location.searchParams.get('state')).toBeTruthy();
  });
});

describe('GET /api/auth/callback', () => {
  it('should redirect home without setting a session when state does not match', async () => {
    const response = await request(app)
      .get('/api/auth/callback?code=abc&state=wrong')
      .set('Cookie', 'ihd_oauth_state=correct-state');

    expect(response.status).toBe(302);
    expect(setCookieHeaders(response).some((c) => c.startsWith('ihd_session='))).toBeFalsy();
  });

  it('should create a new user and set a session on first-ever login', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('access_token')) {
          return new Response(JSON.stringify({ access_token: 'gh-token' }), { status: 200 });
        }
        return new Response(JSON.stringify({ login: 'brand-new-user' }), { status: 200 });
      })
    );

    const response = await request(app)
      .get('/api/auth/callback?code=abc&state=correct-state')
      .set('Cookie', 'ihd_oauth_state=correct-state');

    expect(response.status).toBe(302);
    expect(setCookieHeaders(response).some((c) => c.startsWith('ihd_session='))).toBe(true);

    // First login auto-creates a personal org with the user as admin
    const user = findOrCreateUser('brand-new-user');
    const membership = getMembershipForUser(user.id);
    expect(membership?.role).toBe('admin');
  });

  it('should log in as the existing user on a repeat login, not create a duplicate', async () => {
    const existing = findOrCreateUser('returning-user');

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('access_token')) {
          return new Response(JSON.stringify({ access_token: 'gh-token' }), { status: 200 });
        }
        return new Response(JSON.stringify({ login: 'returning-user' }), { status: 200 });
      })
    );

    await request(app)
      .get('/api/auth/callback?code=abc&state=correct-state')
      .set('Cookie', 'ihd_oauth_state=correct-state');

    // Logging in again shouldn't create a second user record
    const second = findOrCreateUser('returning-user');
    expect(second.id).toBe(existing.id);
  });
});

describe('GET /api/auth/me', () => {
  it('should report loggedIn: false with no session', async () => {
    const response = await request(app).get('/api/auth/me');

    expect(response.body.loggedIn).toBe(false);
  });

  it('should report loggedIn: true with a valid session cookie', async () => {
    const user = findOrCreateUser('sessionuser');
    const token = createSessionToken(user.id, displayName(user));

    const response = await request(app).get('/api/auth/me').set('Cookie', `ihd_session=${token}`);

    expect(response.body.loggedIn).toBe(true);
    expect(response.body.login).toBe('sessionuser');
  });
});

describe('POST /api/auth/logout', () => {
  it('should clear the session cookie', async () => {
    const response = await request(app).post('/api/auth/logout');

    expect(response.status).toBe(200);
    expect(response.headers['set-cookie']?.[0]).toContain('ihd_session=;');
  });
});
