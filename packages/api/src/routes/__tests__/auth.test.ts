import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { createSessionToken } from '../../services/authToken.js';
import { findOrCreateUser, findOrCreateUserByIdentity } from '../../services/userStore.js';
import { getMembershipForUser } from '../../services/orgStore.js';

const app = createApp();

function setCookieHeaders(response: request.Response): string[] {
  const header = response.headers['set-cookie'];
  return Array.isArray(header) ? header : header ? [header] : [];
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.GITHUB_OAUTH_CLIENT_ID = 'gh-client-id';
  process.env.GITHUB_OAUTH_CLIENT_SECRET = 'gh-client-secret';
  process.env.GOOGLE_OAUTH_CLIENT_ID = 'google-client-id';
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'google-client-secret';
  process.env.FACEBOOK_OAUTH_CLIENT_ID = 'fb-client-id';
  process.env.FACEBOOK_OAUTH_CLIENT_SECRET = 'fb-client-secret';
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllGlobals();
});

describe('GET /api/auth/login/:provider', () => {
  it('redirects to GitHub with client_id, redirect_uri, scope, and a state param', async () => {
    const response = await request(app).get('/api/auth/login/github');

    expect(response.status).toBe(302);
    const location = new URL(response.headers.location);
    expect(location.hostname).toBe('github.com');
    expect(location.searchParams.get('client_id')).toBe('gh-client-id');
    expect(location.searchParams.get('redirect_uri')).toContain('/api/auth/callback/github');
    expect(location.searchParams.get('scope')).toBe('read:user user:email');
    expect(location.searchParams.get('state')).toBeTruthy();
    expect(setCookieHeaders(response).some((c) => c.startsWith('ihd_oauth_state='))).toBe(true);
  });

  it('redirects to Google with the right client_id, redirect_uri, state, and google params', async () => {
    const response = await request(app).get('/api/auth/login/google');

    expect(response.status).toBe(302);
    const location = new URL(response.headers.location);
    expect(location.href).toContain('accounts.google.com');
    expect(location.searchParams.get('client_id')).toBe('google-client-id');
    expect(location.searchParams.get('redirect_uri')).toContain('/api/auth/callback/google');
    expect(location.searchParams.get('state')).toBeTruthy();
    expect(location.searchParams.get('response_type')).toBe('code');
    expect(location.searchParams.get('prompt')).toBe('select_account');
    expect(setCookieHeaders(response).some((c) => c.startsWith('ihd_oauth_state='))).toBe(true);
  });

  it('redirects to Facebook with the right client_id and redirect_uri', async () => {
    const response = await request(app).get('/api/auth/login/facebook');

    expect(response.status).toBe(302);
    const location = new URL(response.headers.location);
    expect(location.hostname).toBe('www.facebook.com');
    expect(location.searchParams.get('client_id')).toBe('fb-client-id');
    expect(location.searchParams.get('redirect_uri')).toContain('/api/auth/callback/facebook');
  });

  it('404s for an unknown provider', async () => {
    const response = await request(app).get('/api/auth/login/bogus');
    expect(response.status).toBe(404);
  });

  it('500s when the provider is not configured (no client id/secret)', async () => {
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    const response = await request(app).get('/api/auth/login/google');
    expect(response.status).toBe(500);
  });

  it('keeps the legacy /api/auth/login link working (redirects into the github flow)', async () => {
    const response = await request(app).get('/api/auth/login');
    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/api/auth/login/github');
  });
});

describe('GET /api/auth/callback/:provider', () => {
  it('404s for an unknown provider', async () => {
    const response = await request(app).get('/api/auth/callback/bogus?code=abc&state=s');
    expect(response.status).toBe(404);
  });

  it('redirects home without a session when state does not match', async () => {
    const response = await request(app)
      .get('/api/auth/callback/github?code=abc&state=wrong')
      .set('Cookie', 'ihd_oauth_state=correct-state');

    expect(response.status).toBe(302);
    expect(setCookieHeaders(response).some((c) => c.startsWith('ihd_session='))).toBeFalsy();
  });

  it('creates a new user and sets a session on a first-ever GitHub login', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('access_token')) {
          return new Response(JSON.stringify({ access_token: 'gh-token' }), { status: 200 });
        }
        if (url.includes('/user/emails')) {
          return new Response(JSON.stringify([]), { status: 200 });
        }
        return new Response(JSON.stringify({ login: 'brand-new-user' }), { status: 200 });
      })
    );

    const response = await request(app)
      .get('/api/auth/callback/github?code=abc&state=correct-state')
      .set('Cookie', 'ihd_oauth_state=correct-state');

    expect(response.status).toBe(302);
    expect(setCookieHeaders(response).some((c) => c.startsWith('ihd_session='))).toBe(true);

    // First login auto-creates a personal org with the user as admin
    const user = findOrCreateUser('brand-new-user');
    expect(getMembershipForUser(user.id)?.role).toBe('admin');
  });

  it('signs in via Google, creating one user keyed on the OIDC sub', async () => {
    const sub = `google-sub-${Math.random()}`.slice(0, 24);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (url.includes('oauth2.googleapis.com/token')) {
          return new Response(JSON.stringify({ access_token: 'goog-token' }), { status: 200 });
        }
        return new Response(
          JSON.stringify({
            sub,
            email: `${sub}@gmail.com`,
            email_verified: true,
            name: 'Google Person',
          }),
          { status: 200 }
        );
      })
    );

    const response = await request(app)
      .get('/api/auth/callback/google?code=abc&state=correct-state')
      .set('Cookie', 'ihd_oauth_state=correct-state');

    expect(response.status).toBe(302);
    expect(setCookieHeaders(response).some((c) => c.startsWith('ihd_session='))).toBe(true);

    // The same identity resolves to the already-created user (no duplicate), and
    // it has a NULL github_login - proving the DB accepts non-GitHub users.
    const user = findOrCreateUserByIdentity({
      provider: 'google',
      providerUserId: sub,
      email: `${sub}@gmail.com`,
      emailVerified: true,
    });
    expect(user.githubLogin).toBeNull();
    expect(getMembershipForUser(user.id)?.role).toBe('admin');
  });
});

describe('GET /api/auth/me', () => {
  it('reports loggedIn: false with no session', async () => {
    const response = await request(app).get('/api/auth/me');
    expect(response.body.loggedIn).toBe(false);
  });

  it('reports loggedIn: true with a valid session cookie', async () => {
    const user = findOrCreateUser('sessionuser');
    const token = createSessionToken(user.id);

    const response = await request(app).get('/api/auth/me').set('Cookie', `ihd_session=${token}`);

    expect(response.body.loggedIn).toBe(true);
    expect(response.body.login).toBe('sessionuser');
  });
});

describe('POST /api/auth/logout', () => {
  it('clears the session cookie', async () => {
    const response = await request(app).post('/api/auth/logout');
    expect(response.status).toBe(200);
    expect(response.headers['set-cookie']?.[0]).toContain('ihd_session=;');
  });
});
