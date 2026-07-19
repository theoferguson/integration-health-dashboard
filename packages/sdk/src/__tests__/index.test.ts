import { describe, it, expect, vi } from 'vitest';
import { IHDClient } from '../index.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('IHDClient', () => {
  describe('report', () => {
    it('should POST to /api/ingest with the correct wire shape and auth header', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(201, { duplicate: false }));
      const client = new IHDClient({ apiKey: 'proj_test', endpoint: 'https://ihd.example.com', fetchImpl });

      const result = await client.report({
        integration: 'weather',
        eventType: 'forecast.sync',
        status: 'success',
        payload: { zone: 'NYZ072' },
      });

      expect(result).toEqual({ ok: true, duplicate: false });
      expect(fetchImpl).toHaveBeenCalledTimes(1);

      const [url, init] = fetchImpl.mock.calls[0];
      expect(url).toBe('https://ihd.example.com/api/ingest');
      expect(init.method).toBe('POST');
      expect(init.headers.Authorization).toBe('Bearer proj_test');

      const body = JSON.parse(init.body);
      expect(body.schemaVersion).toBe(2);
      expect(body.integration).toBe('weather');
      expect(body.event_type).toBe('forecast.sync');
      expect(body.status).toBe('success');
      expect(body.payload).toEqual({ zone: 'NYZ072' });
      expect(body.idempotency_key).toBeDefined();
    });

    it('sends schemaVersion 2 dimensions when provided, omits them otherwise', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(201, {}));
      const client = new IHDClient({ apiKey: 'k', endpoint: 'https://ihd.example.com', fetchImpl });

      await client.report({
        integration: 'weather',
        eventType: 'refresh',
        status: 'success',
        metrics: { latencyMs: 214 },
        tags: { region: 'us-east' },
        environment: 'prod',
        severity: 'high',
        source: 'iha@1.4.0',
      });

      const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
      expect(body.metrics).toEqual({ latencyMs: 214 });
      expect(body.tags).toEqual({ region: 'us-east' });
      expect(body.environment).toBe('prod');
      expect(body.severity).toBe('high');
      expect(body.source).toBe('iha@1.4.0');

      // A report without dimensions omits the keys entirely (still valid v2).
      await client.report({ integration: 'a', eventType: 'b', status: 'success' });
      const plain = JSON.parse(fetchImpl.mock.calls[1][1].body);
      expect('metrics' in plain).toBe(false);
      expect('severity' in plain).toBe(false);
    });

    it('should strip a trailing slash from the endpoint', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(201, {}));
      const client = new IHDClient({ apiKey: 'k', endpoint: 'https://ihd.example.com/', fetchImpl });

      await client.report({ integration: 'a', eventType: 'b', status: 'success' });

      expect(fetchImpl.mock.calls[0][0]).toBe('https://ihd.example.com/api/ingest');
    });

    it('should generate a fresh idempotency key per report() call when none is given', async () => {
      // fresh Response per call - a Response body can only be read once
      const fetchImpl = vi.fn().mockImplementation(async () => jsonResponse(201, {}));
      const client = new IHDClient({ apiKey: 'k', endpoint: 'https://ihd.example.com', fetchImpl });

      await client.report({ integration: 'a', eventType: 'b', status: 'success' });
      await client.report({ integration: 'a', eventType: 'b', status: 'success' });

      const key1 = JSON.parse(fetchImpl.mock.calls[0][1].body).idempotency_key;
      const key2 = JSON.parse(fetchImpl.mock.calls[1][1].body).idempotency_key;
      expect(key1).not.toBe(key2);
    });

    it('should use a caller-provided idempotency key as-is', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(201, {}));
      const client = new IHDClient({ apiKey: 'k', endpoint: 'https://ihd.example.com', fetchImpl });

      await client.report({
        integration: 'a',
        eventType: 'b',
        status: 'success',
        idempotencyKey: 'my-key',
      });

      expect(JSON.parse(fetchImpl.mock.calls[0][1].body).idempotency_key).toBe('my-key');
    });

    it('should fail fast on a 4xx response without retrying', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(401, { error: 'Invalid API key' }));
      const client = new IHDClient({ apiKey: 'bad', endpoint: 'https://ihd.example.com', fetchImpl });

      const result = await client.report({ integration: 'a', eventType: 'b', status: 'success' });

      expect(result).toEqual({ ok: false });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('should retry on 5xx and eventually succeed', async () => {
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(503, {}))
        .mockResolvedValueOnce(jsonResponse(201, { duplicate: false }));
      const client = new IHDClient({
        apiKey: 'k',
        endpoint: 'https://ihd.example.com',
        fetchImpl,
        maxRetries: 3,
      });

      const result = await client.report({ integration: 'a', eventType: 'b', status: 'success' });

      expect(result.ok).toBe(true);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it('should retry on a thrown network error and eventually succeed', async () => {
      const fetchImpl = vi
        .fn()
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockResolvedValueOnce(jsonResponse(201, {}));
      const client = new IHDClient({ apiKey: 'k', endpoint: 'https://ihd.example.com', fetchImpl });

      const result = await client.report({ integration: 'a', eventType: 'b', status: 'success' });

      expect(result.ok).toBe(true);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it('should never throw, resolving ok:false after exhausting retries', async () => {
      const fetchImpl = vi.fn().mockRejectedValue(new TypeError('network down'));
      const client = new IHDClient({
        apiKey: 'k',
        endpoint: 'https://ihd.example.com',
        fetchImpl,
        maxRetries: 1,
      });

      await expect(
        client.report({ integration: 'a', eventType: 'b', status: 'success' })
      ).resolves.toEqual({ ok: false });
      expect(fetchImpl).toHaveBeenCalledTimes(2); // initial + 1 retry
    });
  });

  describe('captureError', () => {
    it('should report a caught Error as a failure event with message and code', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(201, {}));
      const client = new IHDClient({ apiKey: 'k', endpoint: 'https://ihd.example.com', fetchImpl });

      const err = Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' });
      await client.captureError(err, { integration: 'nyt-news', eventType: 'sync', context: { attempt: 1 } });

      const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
      expect(body.status).toBe('failure');
      expect(body.integration).toBe('nyt-news');
      expect(body.error.message).toBe('timed out');
      expect(body.error.code).toBe('ETIMEDOUT');
      expect(body.error.context).toEqual({ attempt: 1 });
    });

    it('should stringify non-Error values thrown', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(201, {}));
      const client = new IHDClient({ apiKey: 'k', endpoint: 'https://ihd.example.com', fetchImpl });

      await client.captureError('plain string failure', { integration: 'a', eventType: 'b' });

      const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
      expect(body.error.message).toBe('plain string failure');
    });
  });

  describe('expressMiddleware', () => {
    it('should capture the error and call next(err)', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(201, {}));
      const client = new IHDClient({ apiKey: 'k', endpoint: 'https://ihd.example.com', fetchImpl });
      const middleware = client.expressMiddleware('my-app');

      const err = new Error('route crashed');
      const next = vi.fn();
      middleware(err, {}, {}, next);

      expect(next).toHaveBeenCalledWith(err);
      // capture is fire-and-forget from the middleware's perspective; give it a tick
      await new Promise((r) => setTimeout(r, 0));
      const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
      expect(body.integration).toBe('my-app');
      expect(body.error.message).toBe('route crashed');
    });
  });
});
