import { Router } from 'express';
import {
  getAllIntegrationHealth,
  getIntegrationHealth,
  getOverallHealth,
} from '../services/healthCalculator.js';
import { getEvents } from '../services/eventStore.js';
import type { IntegrationType } from '../types/index.js';

const router = Router();

// Get overall health summary
router.get('/health', (req, res) => {
  const health = getOverallHealth();
  const integrations = getAllIntegrationHealth();

  res.json({ health, integrations });
});

// Get all integrations with their health status
router.get('/', (req, res) => {
  const integrations = getAllIntegrationHealth();
  res.json({ integrations });
});

// Get a single integration's health and recent events
router.get('/:id', (req, res) => {
  const integrationId = req.params.id as IntegrationType;

  try {
    const integration = getIntegrationHealth(integrationId);
    const recentEvents = getEvents({
      integration: integrationId,
      limit: 20,
    });

    res.json({ integration, recentEvents });
  } catch (error) {
    res.status(404).json({ error: 'Integration not found' });
  }
});

export default router;
