import { Router } from 'express';
import {
  getAllIntegrationHealth,
  getIntegrationHealth,
  getOverallHealth,
} from '../services/healthCalculator.js';
import { getEvents } from '../services/eventStore.js';
import { requireOrgMember, getOrgId } from '../middleware/auth.js';

const router = Router();

// All integration data is scoped to the caller's org.
router.use(requireOrgMember);

// Get overall health summary
router.get('/health', (req, res) => {
  const orgId = getOrgId(req);
  const health = getOverallHealth(orgId);
  const integrations = getAllIntegrationHealth(orgId);

  res.json({ health, integrations });
});

// Get all integrations with their health status
router.get('/', (req, res) => {
  const integrations = getAllIntegrationHealth(getOrgId(req));
  res.json({ integrations });
});

// Get a single integration's health and recent events
router.get('/:id', (req, res) => {
  const integrationId = req.params.id;
  const orgId = getOrgId(req);

  try {
    const integration = getIntegrationHealth(integrationId, orgId);
    const recentEvents = getEvents({
      integration: integrationId,
      limit: 20,
      orgId,
    });

    res.json({ integration, recentEvents });
  } catch (error) {
    res.status(404).json({ error: 'Integration not found' });
  }
});

export default router;
