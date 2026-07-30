import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../app.js';
import { findOrCreateUser } from '../../services/userStore.js';
import { createOrgForUser } from '../../services/orgStore.js';
import { createProject } from '../../services/projectStore.js';
import { createEvent } from '../../services/eventStore.js';
import { createReadToken, revokeReadTokenForOrg } from '../../services/readTokenStore.js';

// Two isolated orgs, each with one project + one event and its own read token.
// Exercises the /api/v1 read surface: auth, org scoping, and query validation.
describe('/api/v1 read API', () => {
  let app: Express;
  let secretA: string;
  let secretB: string;
  let orgAEventId: string;
  let orgBEventId: string;
  let tokenAId: string;
  let orgAId: string;

  const auth = (secret: string) => ({ Authorization: `Bearer ${secret}` });

  beforeAll(() => {
    app = createApp();

    const userA = findOrCreateUser(`u-a-${Math.random()}`);
    const userB = findOrCreateUser(`u-b-${Math.random()}`);
    const orgA = createOrgForUser(userA.id, 'Org A');
    const orgB = createOrgForUser(userB.id, 'Org B');
    orgAId = orgA.id;

    const projA = createProject(`p-a-${Math.random()}`, orgA.id);
    const projB = createProject(`p-b-${Math.random()}`, orgB.id);

    orgAEventId = createEvent({
      integration: 'weather',
      eventType: 'forecast.sync',
      status: 'success',
      payload: { org: 'A' },
      projectId: projA.id,
    }).id;
    orgBEventId = createEvent({
      integration: 'stripe',
      eventType: 'payout.sync',
      status: 'failure',
      payload: { org: 'B' },
      projectId: projB.id,
    }).id;

    const a = createReadToken(orgA.id, 'agent-a');
    const b = createReadToken(orgB.id, 'agent-b');
    secretA = a.secret;
    secretB = b.secret;
    tokenAId = a.token.id;
  });

  describe('auth', () => {
    it('401s with no token, in the structured error envelope', async () => {
      const res = await request(app).get('/api/v1/health');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('unauthorized');
    });

    it('401s on an invalid token', async () => {
      const res = await request(app).get('/api/v1/health').set(auth('ihd_read_nope'));
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('invalid_token');
    });

    it('200s with a valid token', async () => {
      const res = await request(app).get('/api/v1/health').set(auth(secretA));
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('integrations');
    });
  });

  describe('org scoping', () => {
    it('returns only the calling org events', async () => {
      const res = await request(app).get('/api/v1/events').set(auth(secretA));
      expect(res.status).toBe(200);
      const integrations = res.body.events.map((e: { integration: string }) => e.integration);
      expect(integrations).toContain('weather'); // org A
      expect(integrations).not.toContain('stripe'); // org B - must not leak
    });

    it('404s on an integration the org has never reported (no fabricated health)', async () => {
      const known = await request(app).get('/api/v1/integrations/weather').set(auth(secretA));
      expect(known.status).toBe(200);

      const unknown = await request(app).get('/api/v1/integrations/nope-does-not-exist').set(auth(secretA));
      expect(unknown.status).toBe(404);
      expect(unknown.body.error.code).toBe('not_found');
    });

    it("404s fetching another org's event by id", async () => {
      const own = await request(app).get(`/api/v1/events/${orgAEventId}`).set(auth(secretA));
      expect(own.status).toBe(200);

      const other = await request(app).get(`/api/v1/events/${orgBEventId}`).set(auth(secretA));
      expect(other.status).toBe(404);
      expect(other.body.error.code).toBe('not_found');
    });
  });

  describe('query validation', () => {
    it('400s on a bad status filter', async () => {
      const res = await request(app).get('/api/v1/events?status=bogus').set(auth(secretA));
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('invalid_query');
    });

    it('clamps limit above the max instead of erroring', async () => {
      const res = await request(app).get('/api/v1/events?limit=9999').set(auth(secretA));
      expect(res.status).toBe(200);
      expect(res.body.limit).toBe(100);
    });

    it('400s on a repeated param instead of 500ing at the SQL bind layer', async () => {
      const res = await request(app)
        .get('/api/v1/events?integration=a&integration=b')
        .set(auth(secretA));
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('invalid_query');
    });

    it('400s on an object-valued param (qs bracket syntax), not 500', async () => {
      const res = await request(app)
        .get('/api/v1/events?integration[x]=foo')
        .set(auth(secretA));
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('invalid_query');
    });

    it('ignores an unknown param but warns instead of erroring or filtering', async () => {
      const res = await request(app).get('/api/v1/events?category=auth').set(auth(secretA));
      expect(res.status).toBe(200); // cheap discovery - not rejected
      expect(Array.isArray(res.body.warnings)).toBe(true);
      expect(res.body.warnings[0]).toContain('category');
    });

    it('omits warnings entirely when all params are recognized', async () => {
      const res = await request(app).get('/api/v1/events?status=success&limit=5').set(auth(secretA));
      expect(res.status).toBe(200);
      expect(res.body).not.toHaveProperty('warnings');
    });
  });

  describe('capability document (GET /api/v1)', () => {
    it('401s without a token', async () => {
      const res = await request(app).get('/api/v1');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('unauthorized');
    });

    it("reflects the caller's own org id, token name, and limits", async () => {
      const res = await request(app).get('/api/v1').set(auth(secretA));
      expect(res.status).toBe(200);
      expect(res.body.you.orgId).toBe(orgAId);
      expect(res.body.you.tokenName).toBe('agent-a');
      expect(res.body.you.access).toBe('read-only');
      expect(res.body.limits.maxLimit).toBe(100);
      expect(Array.isArray(res.body.endpoints)).toBe(true);
      expect(res.body.endpoints.length).toBeGreaterThan(0);
    });

    it('keys the filter vocabulary by the real snake_case query-param names', async () => {
      const res = await request(app).get('/api/v1').set(auth(secretA));
      // These keys must be copyable straight into a ?query string.
      expect(res.body.vocabulary.filters).toHaveProperty('resolution_status');
      expect(res.body.vocabulary.filters).toHaveProperty('sort_by');
      expect(res.body.vocabulary.filters).toHaveProperty('sort_order');
      // Response-only enums live apart from filters, so nobody tries ?category=.
      expect(res.body.vocabulary.responseValues).toHaveProperty('healthStatus');
      expect(res.body.vocabulary.responseValues.severity).toContain('critical');
      expect(res.body.vocabulary.filters).not.toHaveProperty('errorCategory');
    });

    it('scopes the live integration vocabulary per org (no cross-org leak)', async () => {
      const a = await request(app).get('/api/v1').set(auth(secretA));
      const b = await request(app).get('/api/v1').set(auth(secretB));

      // Org A reported 'weather', org B reported 'stripe'. Each sees only its own.
      expect(a.body.vocabulary.filters.integration).toContain('weather');
      expect(a.body.vocabulary.filters.integration).not.toContain('stripe');
      expect(b.body.vocabulary.filters.integration).toContain('stripe');
      expect(b.body.vocabulary.filters.integration).not.toContain('weather');
    });
  });

  describe('llms.txt (public discovery doc)', () => {
    it('serves markdown, unauthenticated', async () => {
      const res = await request(app).get('/llms.txt');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/markdown');
      expect(res.text).toContain('# Integration Health Dashboard');
      // Public - it describes the API shape and never leaks a real org's
      // identity or credentials (the prose does use weather/stripe as generic
      // examples, so we check the actual per-org values instead).
      expect(res.text).not.toContain(orgAId);
      expect(res.text).not.toContain('agent-a');
    });
  });

  it('stops honoring a revoked token', async () => {
    expect(revokeReadTokenForOrg(tokenAId, orgAId)).toBe(true);
    const res = await request(app).get('/api/v1/health').set(auth(secretA));
    expect(res.status).toBe(401);
    // orgB's token still works.
    const ok = await request(app).get('/api/v1/health').set(auth(secretB));
    expect(ok.status).toBe(200);
  });
});
