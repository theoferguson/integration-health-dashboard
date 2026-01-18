import { Router } from 'express';
import {
  getEvents,
  getEventById,
  updateEventClassification,
} from '../services/eventStore.js';
import { classifyError } from '../services/classifier.js';
import type { IntegrationType } from '../types/index.js';

const router = Router();

// Get all events with optional filters
router.get('/', (req, res) => {
  const { integration, status, limit, since } = req.query;

  const events = getEvents({
    integration: integration as IntegrationType | undefined,
    status: status as 'success' | 'failure' | undefined,
    limit: limit ? parseInt(limit as string, 10) : 50,
    since: since ? new Date(since as string) : undefined,
  });

  res.json({ events, total: events.length });
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

export default router;
