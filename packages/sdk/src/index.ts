/**
 * @theof/ihd-sdk
 * Client for reporting integration events to Integration Health Dashboard.
 *
 * This package owns its own wire types rather than importing IHD's internal
 * server types - the wire contract (snake_case, schemaVersion) is the only
 * thing that has to stay in sync across the two repos.
 */

import { randomUUID } from 'node:crypto';

const SCHEMA_VERSION = 2;

export type IngestStatus = 'success' | 'failure' | 'pending';
export type IngestSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface IngestError {
  message: string;
  code?: string;
  context?: Record<string, unknown>;
}

export interface ReportInput {
  integration: string;
  eventType: string;
  status: IngestStatus;
  payload?: Record<string, unknown>;
  error?: IngestError;
  /** Dedupes retried sends of the same logical event. Auto-generated if omitted. */
  idempotencyKey?: string;
  /** Numeric measures for trend charts, e.g. { latencyMs: 214, itemCount: 12 }. */
  metrics?: Record<string, number>;
  /** Free-form labels for filtering/grouping, e.g. { region: 'us-east' }. */
  tags?: Record<string, string>;
  /** Deployment environment: 'prod' | 'staging' | ... */
  environment?: string;
  /** Reporter-supplied severity. */
  severity?: IngestSeverity;
  /** Reporter identity, e.g. 'iha@1.4.0'. */
  source?: string;
}

export interface ReportResult {
  ok: boolean;
  /** True if the server recognized this as a retry of an earlier report() */
  duplicate?: boolean;
}

export interface IHDClientOptions {
  apiKey: string;
  /** Base URL of the IHD deployment, e.g. https://integration-health-dashboard.fly.dev */
  endpoint: string;
  /** Override for testing; defaults to the global fetch (Node 18+) */
  fetchImpl?: typeof fetch;
  /** Max retry attempts on transient failures. Default 3. */
  maxRetries?: number;
  /** Per-attempt timeout in ms - a stalled IHD aborts and retries. Default 10000. */
  timeoutMs?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class IHDClient {
  private readonly apiKey: string;
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;

  constructor(options: IHDClientOptions) {
    this.apiKey = options.apiKey;
    this.endpoint = options.endpoint.replace(/\/$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.maxRetries = options.maxRetries ?? 3;
    this.timeoutMs = options.timeoutMs ?? 10000;
  }

  /**
   * Sends an event to IHD. Never throws - resolves to { ok: false } once
   * retries are exhausted, so a flaky or briefly-down IHD never breaks the
   * caller. Callers that just want to fire-and-forget can ignore the
   * returned promise; callers running in a short-lived process (e.g. a
   * scheduled job) should `await` it before exiting so the send completes.
   */
  async report(input: ReportInput): Promise<ReportResult> {
    const idempotencyKey = input.idempotencyKey ?? randomUUID();
    const body = JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      integration: input.integration,
      event_type: input.eventType,
      status: input.status,
      payload: input.payload ?? {},
      error: input.error,
      idempotency_key: idempotencyKey,
      // Optional schemaVersion 2 dimensions - undefined ones are omitted by JSON.
      metrics: input.metrics,
      tags: input.tags,
      environment: input.environment,
      severity: input.severity,
      source: input.source,
    });

    let lastError: unknown;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await this.fetchImpl(`${this.endpoint}/api/ingest`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
          body,
          // Abort a stalled request; the throw drops into the retry path below.
          signal: AbortSignal.timeout(this.timeoutMs),
        });

        if (response.ok) {
          // A 2xx is success even if the body is empty or unparseable - don't
          // let a missing/garbled body turn an accepted event into a failure.
          const data = await safeJson(response);
          return { ok: true, duplicate: data?.duplicate };
        }

        // 4xx (bad request, bad api key) won't succeed on retry - fail fast
        if (response.status >= 400 && response.status < 500) {
          console.error(`[ihd-sdk] ingest rejected (${response.status}):`, await safeText(response));
          return { ok: false };
        }

        lastError = new Error(`IHD ingest returned ${response.status}`);
      } catch (err) {
        lastError = err;
      }

      if (attempt < this.maxRetries) {
        await sleep(2 ** attempt * 250); // 250ms, 500ms, 1000ms, ...
      }
    }

    console.error('[ihd-sdk] failed to report event after retries:', lastError);
    return { ok: false };
  }

  /** Convenience wrapper: reports a caught error as a failure event. */
  captureError(
    error: unknown,
    meta: { integration: string; eventType: string; context?: Record<string, unknown> }
  ): Promise<ReportResult> {
    const message = error instanceof Error ? error.message : String(error);
    const code =
      error instanceof Error && 'code' in error ? String((error as { code: unknown }).code) : undefined;

    return this.report({
      integration: meta.integration,
      eventType: meta.eventType,
      status: 'failure',
      error: { message, code, context: meta.context },
    });
  }

  /**
   * Express error-handling middleware. Captures unhandled route errors as a
   * failure event, then passes the error along to the app's own handler.
   */
  expressMiddleware(integration = 'express') {
    return (err: unknown, _req: unknown, _res: unknown, next: (err?: unknown) => void): void => {
      void this.captureError(err, { integration, eventType: 'unhandled_error' });
      next(err);
    };
  }
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '<unreadable response body>';
  }
}

async function safeJson(response: Response): Promise<{ duplicate?: boolean } | null> {
  try {
    const text = await response.text();
    return text ? (JSON.parse(text) as { duplicate?: boolean }) : null;
  } catch {
    return null;
  }
}
