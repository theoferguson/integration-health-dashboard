import { Router } from 'express';
import {
  getEvents,
  getEventsPaginated,
  getEventById,
  updateEventClassification,
  acknowledgeEvent,
  resolveEvent,
  reopenEvent,
} from '../services/eventStore.js';
import type { SortField, SortOrder } from '../services/eventStore.js';
import { classifyError } from '../services/classifier.js';
import type { IntegrationType, ResolutionStatus } from '../types/index.js';

const router = Router();

// Get all events with optional filters (simple endpoint)
router.get('/', (req, res) => {
  const { integration, status, resolution_status, limit, since } = req.query;

  const events = getEvents({
    integration: integration as IntegrationType | undefined,
    status: status as 'success' | 'failure' | undefined,
    resolutionStatus: resolution_status as ResolutionStatus | undefined,
    limit: limit ? parseInt(limit as string, 10) : 50,
    since: since ? new Date(since as string) : undefined,
  });

  res.json({ events, total: events.length });
});

// Get paginated events with full filtering and sorting
router.get('/paginated', (req, res) => {
  const {
    integration,
    status,
    resolution_status,
    limit,
    offset,
    since,
    sort_by,
    sort_order,
    search,
  } = req.query;

  const result = getEventsPaginated({
    integration: integration as IntegrationType | undefined,
    status: status as 'success' | 'failure' | undefined,
    resolutionStatus: resolution_status as ResolutionStatus | undefined,
    limit: limit ? parseInt(limit as string, 10) : 25,
    offset: offset ? parseInt(offset as string, 10) : 0,
    since: since ? new Date(since as string) : undefined,
    sortBy: sort_by as SortField | undefined,
    sortOrder: sort_order as SortOrder | undefined,
    search: search as string | undefined,
  });

  res.json(result);
});

// Get a single event by ID
router.get('/:id', (req, res) => {
  const event = getEventById(req.params.id);

  if (!event) {
    return res.status(404).json({ error: 'Event not found' });
  }

  res.json({ event });
});

// Classify an error event using AI
router.post('/:id/classify', async (req, res) => {
  const event = getEventById(req.params.id);

  if (!event) {
    return res.status(404).json({ error: 'Event not found' });
  }

  if (event.status !== 'failure') {
    return res.status(400).json({ error: 'Only failed events can be classified' });
  }

  // Return cached classification if already classified
  if (event.classification) {
    return res.json({ event, classification: event.classification, cached: true });
  }

  try {
    const classification = await classifyError(event);
    const updatedEvent = updateEventClassification(event.id, classification);

    res.json({ event: updatedEvent, classification, cached: false });
  } catch (error) {
    console.error('Classification error:', error);
    res.status(500).json({ error: 'Failed to classify error' });
  }
});

// Acknowledge an error event
router.post('/:id/acknowledge', (req, res) => {
  const { acknowledged_by } = req.body;
  const event = getEventById(req.params.id);

  if (!event) {
    return res.status(404).json({ error: 'Event not found' });
  }

  if (event.status !== 'failure') {
    return res.status(400).json({ error: 'Only failed events can be acknowledged' });
  }

  const updatedEvent = acknowledgeEvent(event.id, acknowledged_by);
  res.json({ event: updatedEvent, message: 'Event acknowledged' });
});

// Resolve an error event
router.post('/:id/resolve', (req, res) => {
  const { resolved_by, notes } = req.body;
  const event = getEventById(req.params.id);

  if (!event) {
    return res.status(404).json({ error: 'Event not found' });
  }

  if (event.status !== 'failure') {
    return res.status(400).json({ error: 'Only failed events can be resolved' });
  }

  const updatedEvent = resolveEvent(event.id, resolved_by, notes);
  res.json({ event: updatedEvent, message: 'Event resolved' });
});

// Reopen a resolved/acknowledged event
router.post('/:id/reopen', (req, res) => {
  const event = getEventById(req.params.id);

  if (!event) {
    return res.status(404).json({ error: 'Event not found' });
  }

  if (event.status !== 'failure') {
    return res.status(400).json({ error: 'Only failed events can be reopened' });
  }

  const updatedEvent = reopenEvent(event.id);
  res.json({ event: updatedEvent, message: 'Event reopened' });
});

export default router;
