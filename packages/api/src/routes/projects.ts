import { Router } from 'express';
import { requireAuth, getSession } from '../middleware/auth.js';
import { createProject, listProjectsForUser, deleteProjectForUser } from '../services/projectStore.js';

const router = Router();

router.use(requireAuth);

router.get('/', (req, res) => {
  const session = getSession(req)!; // requireAuth already guarantees this
  const projects = listProjectsForUser(session.userId).map((p) => ({
    id: p.id,
    name: p.name,
    createdAt: p.createdAt,
    // apiKey deliberately omitted - only shown once, at creation time
  }));
  res.json({ projects });
});

router.post('/', (req, res) => {
  const session = getSession(req)!;
  const { name } = req.body;

  if (typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'name is required' });
    return;
  }

  const project = createProject(name.trim(), session.userId);
  res.status(201).json({ project });
});

router.delete('/:id', (req, res) => {
  const session = getSession(req)!;
  const deleted = deleteProjectForUser(req.params.id, session.userId);

  if (!deleted) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  res.json({ ok: true });
});

export default router;
