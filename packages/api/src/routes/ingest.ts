import { Router } from 'express';
import { getProjectByApiKey } from '../services/projectStore.js';
import { createEvent, findEventByIdempotencyKey } from '../services/eventStore.js';
import type { EventError, EventStatus, ErrorSeverity } from '../types/index.js';

const router = Router();

const SEVERITIES: ErrorSeverity[] = ['low', 'medium', 'high', 'critical'];

// Cap the arbitrary payload blob at the trust boundary - bounds storage and
// blunts abuse (open signup + unbounded store). The whole request is also
// limited by express.json()'s default 100kb; this is the per-field guard.
const MAX_PAYLOAD_BYTES = 32 * 1024;

interface IngestBody {
  integration: string;
  eventType: string;
  status: EventStatus;
  payload: Record<string, unknown>;
  error?: EventError;
  idempotencyKey?: string;
  metrics?: Record<string, number>;
  tags?: Record<string, string>;
  environment?: string;
  severity?: ErrorSeverity;
  source?: string;
}

type ParseResult = { ok: true; data: IngestBody } | { ok: false; message: string };

/**
 * Validates the wire payload at this trust boundary - this endpoint is public-facing.
 * Wire format uses snake_case (event_type, idempotency_key) to match the SDK/README spec;
 * internal types use camelCase.
 */
function parseIngestBody(body: unknown): ParseResult {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, message: 'Request body must be a JSON object' };
  }
  const b = body as Record<string, unknown>;

  if (b.schemaVersion !== 1 && b.schemaVersion !== 2) {
    return { ok: false, message: 'schemaVersion must be 1 or 2' };
  }
  if (typeof b.integration !== 'string' || !b.integration) {
    return { ok: false, message: 'integration is required' };
  }
  if (typeof b.event_type !== 'string' || !b.event_type) {
    return { ok: false, message: 'event_type is required' };
  }
  if (b.status !== 'success' && b.status !== 'failure' && b.status !== 'pending') {
    return { ok: false, message: 'status must be one of success, failure, pending' };
  }
  if (
    b.payload !== undefined &&
    (typeof b.payload !== 'object' || b.payload === null || Array.isArray(b.payload))
  ) {
    return { ok: false, message: 'payload must be an object' };
  }
  if (b.payload !== undefined && Buffer.byteLength(JSON.stringify(b.payload), 'utf8') > MAX_PAYLOAD_BYTES) {
    return { ok: false, message: `payload exceeds the ${MAX_PAYLOAD_BYTES}-byte limit` };
  }

  let error: EventError | undefined;
  if (b.error !== undefined) {
    if (typeof b.error !== 'object' || b.error === null) {
      return { ok: false, message: 'error must be an object' };
    }
    const e = b.error as Record<string, unknown>;
    if (typeof e.message !== 'string' || !e.message) {
      return { ok: false, message: 'error.message is required when error is present' };
    }
    error = {
      message: e.message,
      code: typeof e.code === 'string' ? e.code : undefined,
      context:
        typeof e.context === 'object' && e.context !== null
          ? (e.context as Record<string, unknown>)
          : undefined,
    };
  }

  if (b.idempotency_key !== undefined && typeof b.idempotency_key !== 'string') {
    return { ok: false, message: 'idempotency_key must be a string' };
  }

  // schemaVersion 2 optional dimensions (all validated at this trust boundary).
  let metrics: Record<string, number> | undefined;
  if (b.metrics !== undefined) {
    if (typeof b.metrics !== 'object' || b.metrics === null || Array.isArray(b.metrics)) {
      return { ok: false, message: 'metrics must be an object of numbers' };
    }
    for (const [k, v] of Object.entries(b.metrics as Record<string, unknown>)) {
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        return { ok: false, message: `metrics.${k} must be a finite number` };
      }
    }
    metrics = b.metrics as Record<string, number>;
  }

  let tags: Record<string, string> | undefined;
  if (b.tags !== undefined) {
    if (typeof b.tags !== 'object' || b.tags === null || Array.isArray(b.tags)) {
      return { ok: false, message: 'tags must be an object of strings' };
    }
    for (const [k, v] of Object.entries(b.tags as Record<string, unknown>)) {
      if (typeof v !== 'string') {
        return { ok: false, message: `tags.${k} must be a string` };
      }
    }
    tags = b.tags as Record<string, string>;
  }

  if (b.environment !== undefined && typeof b.environment !== 'string') {
    return { ok: false, message: 'environment must be a string' };
  }
  if (
    b.severity !== undefined &&
    (typeof b.severity !== 'string' || !SEVERITIES.includes(b.severity as ErrorSeverity))
  ) {
    return { ok: false, message: 'severity must be one of low, medium, high, critical' };
  }
  if (b.source !== undefined && typeof b.source !== 'string') {
    return { ok: false, message: 'source must be a string' };
  }

  return {
    ok: true,
    data: {
      integration: b.integration,
      eventType: b.event_type,
      status: b.status,
      payload: (b.payload as Record<string, unknown>) ?? {},
      error,
      idempotencyKey: b.idempotency_key as string | undefined,
      metrics,
      tags,
      environment: b.environment as string | undefined,
      severity: b.severity as ErrorSeverity | undefined,
      source: b.source as string | undefined,
    },
  };
}

router.post('/', (req, res) => {
  const authHeader = req.header('authorization') || '';
  const apiKey = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null;

  if (!apiKey) {
    return res.status(401).json({ error: 'Missing Authorization: Bearer <api_key> header' });
  }

  const project = getProjectByApiKey(apiKey);
  if (!project) {
    return res.status(401).json({ error: 'Invalid API key' });
  }

  const parsed = parseIngestBody(req.body);
  if (!parsed.ok) {
    return res.status(400).json({ error: parsed.message });
  }
  const { integration, eventType, status, payload, error, idempotencyKey, metrics, tags, environment, severity, source } =
    parsed.data;

  if (idempotencyKey) {
    const existing = findEventByIdempotencyKey(project.id, idempotencyKey);
    if (existing) {
      return res.status(200).json({ event: existing, duplicate: true });
    }
  }

  try {
    const event = createEvent({
      projectId: project.id,
      integration,
      eventType,
      status,
      payload,
      error,
      idempotencyKey,
      metrics,
      tags,
      environment,
      severity,
      source,
    });
    return res.status(201).json({ event, duplicate: false });
  } catch (err) {
    // Race: two requests with the same idempotency key inserted concurrently.
    // The unique index rejected the second insert - return the winning row instead of erroring.
    if (idempotencyKey && (err as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE') {
      const existing = findEventByIdempotencyKey(project.id, idempotencyKey);
      if (existing) {
        return res.status(200).json({ event: existing, duplicate: true });
      }
    }
    console.error('Ingest error:', err);
    return res.status(500).json({ error: 'Failed to record event' });
  }
});

export default router;
