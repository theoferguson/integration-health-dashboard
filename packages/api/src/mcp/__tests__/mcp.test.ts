import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import http from 'http';
import type { AddressInfo } from 'net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { createApp } from '../../app.js';
import { resolveMcpAuth } from '../auth.js';
import { findOrCreateUser } from '../../services/userStore.js';
import { createOrgForUser } from '../../services/orgStore.js';
import { createProject } from '../../services/projectStore.js';
import { createEvent } from '../../services/eventStore.js';
import { createReadToken, revokeReadTokenForOrg } from '../../services/readTokenStore.js';

// Two isolated orgs, each with a project + event and its own read token - same
// fixture shape as routes/__tests__/v1.test.ts, so the MCP door and the HTTP
// door are proven org-scoped against identical data.
describe('MCP server (read-token)', () => {
  let app: ReturnType<typeof createApp>;
  let server: http.Server;
  let baseUrl: string;

  let secretA: string;
  let secretB: string;
  let orgAId: string;
  let tokenAId: string;

  const bearerReq = (secret?: string) =>
    ({
      header: (name: string) =>
        name.toLowerCase() === 'authorization' && secret ? `Bearer ${secret}` : undefined,
    }) as unknown as Parameters<typeof resolveMcpAuth>[0];

  // A connected MCP client hitting the real HTTP transport with a bearer header.
  async function connect(secret: string): Promise<Client> {
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${secret}` } },
    });
    await client.connect(transport);
    return client;
  }

  const parse = (result: unknown) => {
    const r = result as { content: { type: string; text: string }[]; isError?: boolean };
    return { isError: !!r.isError, data: JSON.parse(r.content[0].text) };
  };

  beforeAll(async () => {
    app = createApp();
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;

    const userA = findOrCreateUser(`mcp-a-${Math.random()}`);
    const userB = findOrCreateUser(`mcp-b-${Math.random()}`);
    const orgA = createOrgForUser(userA.id, 'MCP Org A');
    const orgB = createOrgForUser(userB.id, 'MCP Org B');
    orgAId = orgA.id;

    const projA = createProject(`mcp-p-a-${Math.random()}`, orgA.id);
    const projB = createProject(`mcp-p-b-${Math.random()}`, orgB.id);

    createEvent({
      integration: 'weather',
      eventType: 'forecast.sync',
      status: 'success',
      payload: { org: 'A' },
      projectId: projA.id,
    });
    createEvent({
      integration: 'stripe',
      eventType: 'payout.sync',
      status: 'failure',
      payload: { org: 'B' },
      projectId: projB.id,
    });

    const a = createReadToken(orgA.id, 'agent-a');
    const b = createReadToken(orgB.id, 'agent-b');
    secretA = a.secret;
    secretB = b.secret;
    tokenAId = a.token.id;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  // ---- The swappable auth boundary (mcp/auth.ts) ------------------------
  describe('resolveMcpAuth', () => {
    it('resolves a valid token to its org, token id, and name', () => {
      expect(resolveMcpAuth(bearerReq(secretA))).toEqual({
        ok: true,
        orgId: orgAId,
        tokenId: tokenAId,
        tokenName: 'agent-a',
      });
    });

    it('reports unauthorized for a missing token (distinct from invalid)', () => {
      const r = resolveMcpAuth(bearerReq(undefined));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('unauthorized');
    });

    it('reports invalid_token for a garbage token', () => {
      const r = resolveMcpAuth(bearerReq('ihd_read_nope'));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('invalid_token');
    });

    it('reports invalid_token for a revoked token', () => {
      const u = findOrCreateUser(`mcp-rev-${Math.random()}`);
      const org = createOrgForUser(u.id, 'Rev Org');
      const t = createReadToken(org.id, 'to-revoke');
      expect(resolveMcpAuth(bearerReq(t.secret)).ok).toBe(true);
      revokeReadTokenForOrg(t.token.id, org.id);
      const r = resolveMcpAuth(bearerReq(t.secret));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('invalid_token');
    });
  });

  // ---- HTTP gate (mcp/http.ts) - short-circuits before the transport ----
  describe('POST /mcp gate', () => {
    it('401s (with WWW-Authenticate) when no token is provided', async () => {
      const res = await request(app).post('/mcp').send({ jsonrpc: '2.0', id: 1, method: 'ping' });
      expect(res.status).toBe(401);
      expect(res.headers['www-authenticate']).toBe('Bearer');
      expect(res.body.error.code).toBe('unauthorized');
    });

    it('401s (invalid_token) on a revoked/garbage token, matching the HTTP door vocabulary', async () => {
      const res = await request(app)
        .post('/mcp')
        .set('Authorization', 'Bearer ihd_read_nope')
        .send({ jsonrpc: '2.0', id: 1, method: 'ping' });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('invalid_token');
    });

    it('403s on a disallowed Origin (DNS-rebinding defense)', async () => {
      const res = await request(app)
        .post('/mcp')
        .set('Origin', 'https://evil.example')
        .set('Authorization', `Bearer ${secretA}`)
        .send({ jsonrpc: '2.0', id: 1, method: 'ping' });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('forbidden');
    });

    it('allows a loopback Origin on any port (not 403) — Inspector/dev UI', async () => {
      // Ported localhost must pass the Origin guard; with no token it then 401s,
      // proving the guard accepted the origin (a 403 would mean it was rejected).
      const res = await request(app)
        .post('/mcp')
        .set('Origin', 'http://localhost:6274')
        .send({ jsonrpc: '2.0', id: 1, method: 'ping' });
      expect(res.status).toBe(401);
    });

    it('applies the per-IP read limiter (RateLimit-* headers present on the gate)', async () => {
      // The IP limiter runs before auth, so even a 401 carries its headers -
      // proof the MCP door is under the same ceiling as /api/v1.
      const res = await request(app).post('/mcp').send({ jsonrpc: '2.0', id: 1, method: 'ping' });
      expect(res.status).toBe(401);
      expect(res.headers['ratelimit-policy'] ?? res.headers['ratelimit']).toBeDefined();
    });

    it('405s (Allow: POST) on a non-POST method instead of the SPA shell', async () => {
      const res = await request(app).get('/mcp');
      expect(res.status).toBe(405);
      expect(res.headers['allow']).toBe('POST');
      expect(res.body.error.code).toBe('method_not_allowed');
    });
  });

  // ---- End-to-end over the real Streamable HTTP transport ---------------
  describe('tools over Streamable HTTP', () => {
    it('lists all 8 read-only tools after the initialize handshake', async () => {
      const client = await connect(secretA);
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name).sort();
      expect(names).toEqual(
        [
          'get_event',
          'get_health',
          'get_integration',
          'get_monitor',
          'get_monitor_series',
          'list_integrations',
          'list_monitors',
          'query_events',
        ].sort()
      );
      // Every tool advertises readOnlyHint.
      expect(tools.every((t) => t.annotations?.readOnlyHint === true)).toBe(true);
      await client.close();
    });

    it('get_health returns org-scoped content', async () => {
      const client = await connect(secretA);
      const { data } = parse(await client.callTool({ name: 'get_health', arguments: {} }));
      expect(data).toHaveProperty('health');
      const ints = (data.integrations as { id?: string; name?: string }[]).map(
        (i) => i.id ?? i.name
      );
      expect(ints).toContain('weather');
      expect(ints).not.toContain('stripe');
      await client.close();
    });

    it('query_events with a bad status returns isError (invalid input)', async () => {
      const client = await connect(secretA);
      // A bad enum is rejected by zod at the SDK layer, so the error content is a
      // plain MCP validation string (not our JSON envelope) - assert isError only.
      const result = (await client.callTool({
        name: 'query_events',
        arguments: { status: 'bogus' },
      })) as { isError?: boolean };
      expect(result.isError).toBe(true);
      await client.close();
    });

    it('scopes results to the calling org (A cannot see B)', async () => {
      const clientA = await connect(secretA);
      const a = parse(await clientA.callTool({ name: 'query_events', arguments: {} }));
      const aInts = (a.data.events as { integration: string }[]).map((e) => e.integration);
      expect(aInts).toContain('weather');
      expect(aInts).not.toContain('stripe');
      await clientA.close();

      const clientB = await connect(secretB);
      const b = parse(await clientB.callTool({ name: 'query_events', arguments: {} }));
      const bInts = (b.data.events as { integration: string }[]).map((e) => e.integration);
      expect(bInts).toContain('stripe');
      expect(bInts).not.toContain('weather');
      await clientB.close();
    });

    it('coerces a stringified/fractional limit and clamps it (parity with /api/v1)', async () => {
      const client = await connect(secretA);
      // LLM agents often emit numbers as JSON strings; a bad enum hard-errors but
      // a numeric field must coerce+clamp, not reject.
      const strLimit = parse(await client.callTool({ name: 'query_events', arguments: { limit: '9999' } }));
      expect(strLimit.isError).toBe(false);
      expect(strLimit.data.limit).toBe(100); // clamped to MAX_LIMIT

      const frac = parse(await client.callTool({ name: 'query_events', arguments: { limit: 5.9 } }));
      expect(frac.isError).toBe(false);
      expect(frac.data.limit).toBe(5); // floored by clampInt
      await client.close();
    });

    it('get_integration errors not_found for an unreported id', async () => {
      const client = await connect(secretA);
      const { isError, data } = parse(
        await client.callTool({ name: 'get_integration', arguments: { id: 'does-not-exist' } })
      );
      expect(isError).toBe(true);
      expect(data.error.code).toBe('not_found');
      await client.close();
    });
  });
});
