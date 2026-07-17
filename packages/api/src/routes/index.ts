import { Router } from 'express';
import eventsRoutes from './events.js';
import integrationsRoutes from './integrations.js';
import ingestRoutes from './ingest.js';

const router = Router();

router.use('/events', eventsRoutes);
router.use('/integrations', integrationsRoutes);
router.use('/ingest', ingestRoutes);

export default router;
