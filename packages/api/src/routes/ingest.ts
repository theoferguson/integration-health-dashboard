import { Router } from 'express';
import { getProjectByApiKey } from '../services/projectStore.js';
import { createEvent, findEventByIdempotencyKey } from '../services/eventStore.js';
import type { EventError, EventStatus } from '../types/index.js';

const router = Router();

interface IngestBody {
  integration: string;
  eventType: string;
  status: EventStatus;
  payload: Record<string, unknown>;
  error?: EventError;
  idempotencyKey?: string;
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

  if (b.schemaVersion !== 1) {
    return { ok: false, message: 'schemaVersion must be 1' };
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

  return {
    ok: true,
    data: {
      integration: b.integration,
      eventType: b.event_type,
      status: b.status,
      payload: (b.payload as Record<string, unknown>) ?? {},
      error,
      idempotencyKey: b.idempotency_key as string | undefined,
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
  const { integration, eventType, status, payload, error, idempotencyKey } = parsed.data;

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
