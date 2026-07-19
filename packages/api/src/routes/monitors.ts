import { Router } from 'express';
import {
  createMonitor,
  listMonitorsForOrg,
  getMonitorForOrg,
  updateMonitorForOrg,
  deleteMonitorForOrg,
  getMonitorSeries,
} from '../services/monitorStore.js';
import { validateMatchSpec } from '../services/monitorMatch.js';
import { requireOrgMember, requireOrgAdmin, getOrgId } from '../middleware/auth.js';

const router = Router();

// All monitor data is org-scoped; members read, admins write.
router.use(requireOrgMember);

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const MAX_BUCKETS = 500; // guard against absurd window/bucket combos

router.get('/', (req, res) => {
  res.json({ monitors: listMonitorsForOrg(getOrgId(req)) });
});

router.post('/', requireOrgAdmin, (req, res) => {
  const { name, matchSpec } = req.body ?? {};
  if (typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  const parsed = validateMatchSpec(matchSpec);
  if (!parsed.ok) return res.status(400).json({ error: parsed.message });

  const monitor = createMonitor(getOrgId(req), name.trim(), parsed.spec);
  res.status(201).json({ monitor });
});

router.patch('/:id', requireOrgAdmin, (req, res) => {
  const { name, enabled, matchSpec } = req.body ?? {};
  const patch: { name?: string; enabled?: boolean; matchSpec?: import('../types/index.js').MonitorMatchSpec } = {};

  if (name !== undefined) {
    if (typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'name must be a non-empty string' });
    }
    patch.name = name.trim();
  }
  if (enabled !== undefined) {
    if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'enabled must be a boolean' });
    patch.enabled = enabled;
  }
  if (matchSpec !== undefined) {
    const parsed = validateMatchSpec(matchSpec);
    if (!parsed.ok) return res.status(400).json({ error: parsed.message });
    patch.matchSpec = parsed.spec;
  }

  const monitor = updateMonitorForOrg(req.params.id, getOrgId(req), patch);
  if (!monitor) return res.status(404).json({ error: 'Monitor not found' });
  res.json({ monitor });
});

router.delete('/:id', requireOrgAdmin, (req, res) => {
  if (!deleteMonitorForOrg(req.params.id, getOrgId(req))) {
    return res.status(404).json({ error: 'Monitor not found' });
  }
  res.json({ deleted: true });
});

// The monitor graph: matching-event counts bucketed over a window.
router.get('/:id/series', (req, res) => {
  const orgId = getOrgId(req);
  const monitor = getMonitorForOrg(req.params.id, orgId);
  if (!monitor) return res.status(404).json({ error: 'Monitor not found' });

  const windowMs = Math.max(HOUR_MS, Number(req.query.window) || 7 * DAY_MS);
  let bucketMs = Math.max(60_000, Number(req.query.bucket) || HOUR_MS);
  // Keep the point count bounded regardless of what's requested.
  if (windowMs / bucketMs > MAX_BUCKETS) bucketMs = Math.ceil(windowMs / MAX_BUCKETS);

  res.json({
    monitor,
    series: getMonitorSeries(orgId, monitor.matchSpec, windowMs, bucketMs),
    windowMs,
    bucketMs,
  });
});

export default router;
