import { Router } from 'express';
import webhooksRoutes from './webhooks/index.js';
import eventsRoutes from './events.js';
import integrationsRoutes from './integrations.js';
import simulateRoutes from './simulate.js';
import syncRoutes from './sync.js';

const router = Router();

router.use('/webhooks', webhooksRoutes);
router.use('/events', eventsRoutes);
router.use('/integrations', integrationsRoutes);
router.use('/simulate', simulateRoutes);
router.use('/sync', syncRoutes);

export default router;
