import { Router } from 'express';
import eventsRoutes from './events.js';
import integrationsRoutes from './integrations.js';
import ingestRoutes from './ingest.js';
import authRoutes from './auth.js';
import projectsRoutes from './projects.js';
import orgsRoutes from './orgs.js';
import monitorsRoutes from './monitors.js';
import readTokensRoutes from './readTokens.js';
import v1Routes from './v1.js';

const router = Router();

router.use('/events', eventsRoutes);
router.use('/integrations', integrationsRoutes);
router.use('/ingest', ingestRoutes);
router.use('/auth', authRoutes);
router.use('/projects', projectsRoutes);
router.use('/orgs', orgsRoutes);
router.use('/monitors', monitorsRoutes);
router.use('/read-tokens', readTokensRoutes);

// The versioned, read-only programmatic surface (Door 2), authed by a read token.
router.use('/v1', v1Routes);

export default router;
