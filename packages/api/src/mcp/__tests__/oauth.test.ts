import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createHash, randomBytes } from 'crypto';

/**
 * The Phase 4 OAuth authorization server, driven end to end: dynamic client
 * registration -> authorize -> consent -> code -> token -> an authenticated /mcp
 * call, plus the paths that must FAIL (bad PKCE, replayed code, no session,
 * rotated refresh token).
 *
 * This is the credential-issuing path, so the negative cases matter as much as
 * the happy one.
 */

const BASE = 'http://127.0.0.1:8099';
const REDIRECT = 'http://localhost:9876/callback';
const RESOURCE = `${BASE}/mcp`;

const b64url = (buf: Buffer) =>
  buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

const INIT = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } },
};

describe('MCP OAuth authorization server', () => {
  let app: Express;
  let clientId: string;
  let cookie: string;
  let verifier: string;
  let challenge: string;

  /** Run /authorize and return the parked-authorization id it redirects to. */
  async function startAuthorization(): Promise<string> {
    const res = await request(app).get('/authorize').query({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: REDIRECT,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: 'xyz123',
      scope: 'mcp:read',
      resource: RESOURCE,
    });
    expect(res.status).toBe(302);
    return new URL(res.headers.location, BASE).searchParams.get('p')!;
  }

  /** Consent + approve, returning the issued authorization code. */
  async function approve(pendingId: string): Promise<string> {
    const res = await request(app)
      .post('/oauth/consent')
      .set('Cookie', cookie)
      .type('form')
      .send({ p: pendingId, decision: 'approve' });
    return new URL(res.headers.location).searchParams.get('code')!;
  }

  const mcp = (token: string) =>
    request(app)
      .post('/mcp')
      .set('Authorization', `Bearer ${token}`)
      .set('Accept', 'application/json, text/event-stream')
      .send(INIT);

  /** The whole happy path in one call: authorize -> consent -> code -> tokens. */
  async function grantTokens() {
    const code = await approve(await startAuthorization());
    return request(app).post('/token').type('form').send({
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      code_verifier: verifier,
      redirect_uri: REDIRECT,
      resource: RESOURCE,
    });
  }

  beforeAll(async () => {
    process.env.PUBLIC_BASE_URL = BASE;
    process.env.AUTH_RATE_LIMIT_PER_MIN = '500';
    const { createApp } = await import('../../app.js');
    app = createApp();

    verifier = b64url(randomBytes(32));
    challenge = b64url(createHash('sha256').update(verifier).digest());

    const reg = await request(app)
      .post('/register')
      .send({ client_name: 'Test Client', redirect_uris: [REDIRECT] });
    clientId = reg.body.client_id;

    const signup = await request(app)
      .post('/api/auth/signup')
      .send({ email: `oauth-${Math.random()}@example.com`, password: 'a-good-password' });
    cookie = signup.headers['set-cookie'][0].split(';')[0];
  });

  describe('discovery', () => {
    it('advertises the authorization server with S256 PKCE and DCR', async () => {
      const res = await request(app).get('/.well-known/oauth-authorization-server');
      expect(res.status).toBe(200);
      expect(res.body.code_challenge_methods_supported).toContain('S256');
      expect(res.body.registration_endpoint).toBeTruthy();
      expect(res.body.token_endpoint).toBeTruthy();
    });

    it('names /mcp as the protected resource', async () => {
      const res = await request(app).get('/.well-known/oauth-protected-resource/mcp');
      expect(res.status).toBe(200);
      expect(res.body.resource).toBe(RESOURCE);
    });
  });

  describe('dynamic client registration', () => {
    it('issues a client_id but NO client_secret', async () => {
      const res = await request(app)
        .post('/register')
        .send({ client_name: 'Another', redirect_uris: [REDIRECT] });
      expect(res.status).toBe(201);
      expect(res.body.client_id).toBeTruthy();
      // Public client + PKCE. The SDK compares client secrets in plaintext, so
      // not issuing one means there's no usable credential stored at rest.
      expect(res.body.client_secret).toBeUndefined();
    });
  });

  describe('authorization', () => {
    it('parks the request and redirects to consent rather than issuing a code', async () => {
      const res = await request(app).get('/authorize').query({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: REDIRECT,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        resource: RESOURCE,
      });
      expect(res.status).toBe(302);
      expect(res.headers.location).toMatch(/^\/oauth\/consent\?p=/);
    });

    it('rejects an unregistered redirect_uri', async () => {
      const res = await request(app).get('/authorize').query({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: 'https://evil.example/steal',
        code_challenge: challenge,
        code_challenge_method: 'S256',
      });
      expect(res.status).toBe(400);
    });

    it('shows sign-in when signed out, and the grant when signed in', async () => {
      const pendingId = await startAuthorization();

      const signedOut = await request(app).get(`/oauth/consent?p=${pendingId}`);
      expect(signedOut.text).toContain('Sign in to continue');

      const signedIn = await request(app)
        .get(`/oauth/consent?p=${pendingId}`)
        .set('Cookie', cookie);
      expect(signedIn.text).toContain('Authorize connection');
      expect(signedIn.text).toContain('Read-only');
    });

    it('escapes the client name (it comes from unauthenticated registration)', async () => {
      const evil = await request(app)
        .post('/register')
        .send({ client_name: '<script>alert(1)</script>', redirect_uris: [REDIRECT] });
      const res = await request(app).get('/authorize').query({
        response_type: 'code',
        client_id: evil.body.client_id,
        redirect_uri: REDIRECT,
        code_challenge: challenge,
        code_challenge_method: 'S256',
      });
      const pendingId = new URL(res.headers.location, BASE).searchParams.get('p');
      const page = await request(app).get(`/oauth/consent?p=${pendingId}`);
      expect(page.text).not.toContain('<script>alert(1)</script>');
      expect(page.text).toContain('&lt;script&gt;');
    });

    it('cannot be approved without a session', async () => {
      const pendingId = await startAuthorization();
      const res = await request(app)
        .post('/oauth/consent')
        .type('form')
        .send({ p: pendingId, decision: 'approve' });
      // Bounced back to sign in - no code is issued.
      expect(res.status).toBe(302);
      expect(res.headers.location).toMatch(/^\/oauth\/consent/);
    });

    it('deny returns access_denied and no code', async () => {
      const pendingId = await startAuthorization();
      const res = await request(app)
        .post('/oauth/consent')
        .set('Cookie', cookie)
        .type('form')
        .send({ p: pendingId, decision: 'deny' });
      const url = new URL(res.headers.location);
      expect(url.searchParams.get('error')).toBe('access_denied');
      expect(url.searchParams.get('code')).toBeNull();
    });

    it('preserves state through the round trip', async () => {
      const pendingId = await startAuthorization();
      const res = await request(app)
        .post('/oauth/consent')
        .set('Cookie', cookie)
        .type('form')
        .send({ p: pendingId, decision: 'approve' });
      expect(new URL(res.headers.location).searchParams.get('state')).toBe('xyz123');
    });
  });

  describe('token exchange', () => {
    const exchange = (code: string, overrides: Record<string, string> = {}) =>
      request(app).post('/token').type('form').send({
        grant_type: 'authorization_code',
        client_id: clientId,
        code,
        code_verifier: verifier,
        redirect_uri: REDIRECT,
        resource: RESOURCE,
        ...overrides,
      });

    it('rejects a mismatched code_verifier (PKCE)', async () => {
      const code = await approve(await startAuthorization());
      const res = await exchange(code, { code_verifier: b64url(randomBytes(32)) });
      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it('issues an access + refresh token pair', async () => {
      const code = await approve(await startAuthorization());
      const res = await exchange(code);
      expect(res.status).toBe(200);
      expect(res.body.access_token).toMatch(/^ihd_mcp_/);
      expect(res.body.refresh_token).toBeTruthy();
      expect(res.body.expires_in).toBeGreaterThan(0);
    });

    it('refuses to redeem the same code twice', async () => {
      const code = await approve(await startAuthorization());
      expect((await exchange(code)).status).toBe(200);
      expect((await exchange(code)).status).toBeGreaterThanOrEqual(400);
    });

    it('refuses a redirect_uri that differs from the authorization request', async () => {
      const code = await approve(await startAuthorization());
      const res = await exchange(code, { redirect_uri: 'http://localhost:9876/other' });
      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it('refuses a resource that differs from the one consented to (RFC 8707)', async () => {
      const code = await approve(await startAuthorization());
      const res = await exchange(code, { resource: 'https://someone-elses-server.example/mcp' });
      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe('using and refreshing the token', () => {
    it('authenticates /mcp with the issued access token', async () => {
      const { body } = await grantTokens();
      const res = await mcp(body.access_token);
      expect(res.status).toBe(200);
      expect(res.text).toContain('serverInfo');
    });

    it('rotates the refresh token and kills the old one', async () => {
      const first = await grantTokens();

      const refresh = (token: string) =>
        request(app).post('/token').type('form').send({
          grant_type: 'refresh_token',
          client_id: clientId,
          refresh_token: token,
          resource: RESOURCE,
        });

      const second = await refresh(first.body.refresh_token);
      expect(second.status).toBe(200);
      expect(second.body.refresh_token).not.toBe(first.body.refresh_token);

      // Reusing the rotated-away token must fail - that's what surfaces a theft
      // instead of granting silent parallel access.
      expect((await refresh(first.body.refresh_token)).status).toBeGreaterThanOrEqual(400);
      expect((await mcp(second.body.access_token)).status).toBe(200);
    });

    it('rejects a forged access token', async () => {
      expect((await mcp('ihd_mcp_deadbeef')).status).toBe(401);
    });
  });

  describe('backward compatibility', () => {
    it('still accepts the original ihd_read_* token on /mcp (dual-accept)', async () => {
      // Phase 1 documented `claude mcp add --header "Authorization: Bearer ihd_read_..."`;
      // adding OAuth must not break those setups.
      const minted = await request(app)
        .post('/api/read-tokens')
        .set('Cookie', cookie)
        .send({ name: 'legacy' });
      const res = await mcp(minted.body.secret);
      expect(res.status).toBe(200);
      expect(res.text).toContain('serverInfo');
    });
  });
});
