import { Router } from 'express';
import eventsRoutes from './events.js';
import integrationsRoutes from './integrations.js';

const router = Router();

router.use('/events', eventsRoutes);
router.use('/integrations', integrationsRoutes);

export default router;
