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
    it('resolves a valid token to its org and token name', () => {
      expect(resolveMcpAuth(bearerReq(secretA))).toEqual({ orgId: orgAId, tokenName: 'agent-a' });
    });

    it('returns null for a missing token', () => {
      expect(resolveMcpAuth(bearerReq(undefined))).toBeNull();
    });

    it('returns null for a garbage token', () => {
      expect(resolveMcpAuth(bearerReq('ihd_read_nope'))).toBeNull();
    });

    it('returns null for a revoked token', () => {
      const u = findOrCreateUser(`mcp-rev-${Math.random()}`);
      const org = createOrgForUser(u.id, 'Rev Org');
      const t = createReadToken(org.id, 'to-revoke');
      expect(resolveMcpAuth(bearerReq(t.secret))).not.toBeNull();
      revokeReadTokenForOrg(t.token.id, org.id);
      expect(resolveMcpAuth(bearerReq(t.secret))).toBeNull();
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

    it('403s on a disallowed Origin (DNS-rebinding defense)', async () => {
      const res = await request(app)
        .post('/mcp')
        .set('Origin', 'https://evil.example')
        .set('Authorization', `Bearer ${secretA}`)
        .send({ jsonrpc: '2.0', id: 1, method: 'ping' });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('forbidden');
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

    it('get_integration errors not_found for an unreported id', async () => {
      const client = await connect(secretA);
      const result = (await client.callTool({
        name: 'get_integration',
        arguments: { id: 'does-not-exist' },
      })) as { isError?: boolean; content: { text: string }[] };
      expect(result.isError).toBe(true);
      expect(JSON.parse(result.content[0].text).error.code).toBe('not_found');
      await client.close();
    });
  });
});
