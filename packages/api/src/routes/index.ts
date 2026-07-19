import { Router } from 'express';
import eventsRoutes from './events.js';
import integrationsRoutes from './integrations.js';
import ingestRoutes from './ingest.js';
import authRoutes from './auth.js';
import projectsRoutes from './projects.js';
import orgsRoutes from './orgs.js';
import monitorsRoutes from './monitors.js';

const router = Router();

router.use('/events', eventsRoutes);
router.use('/integrations', integrationsRoutes);
router.use('/ingest', ingestRoutes);
router.use('/auth', authRoutes);
router.use('/projects', projectsRoutes);
router.use('/orgs', orgsRoutes);
router.use('/monitors', monitorsRoutes);

export default router;
