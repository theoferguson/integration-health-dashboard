import { Router } from 'express';
import { getSession, requireOrgMember, requireOrgAdmin } from '../middleware/auth.js';
import { getMembershipForUser } from '../services/orgStore.js';
import { createProject, listProjectsForOrg, deleteProjectForOrg } from '../services/projectStore.js';

const router = Router();

router.use(requireOrgMember);

router.get('/', (req, res) => {
  const session = getSession(req)!;
  const membership = getMembershipForUser(session.userId)!; // requireOrgMember already guarantees this
  const projects = listProjectsForOrg(membership.org.id).map((p) => ({
    id: p.id,
    name: p.name,
    createdAt: p.createdAt,
    // apiKey deliberately omitted - only shown once, at creation time
  }));
  res.json({ projects });
});

router.post('/', requireOrgAdmin, (req, res) => {
  const session = getSession(req)!;
  const membership = getMembershipForUser(session.userId)!;
  const { name } = req.body;

  if (typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'name is required' });
    return;
  }

  const project = createProject(name.trim(), membership.org.id);
  res.status(201).json({ project });
});

router.delete('/:id', requireOrgAdmin, (req, res) => {
  const session = getSession(req)!;
  const membership = getMembershipForUser(session.userId)!;
  const deleted = deleteProjectForOrg(req.params.id, membership.org.id);

  if (!deleted) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  res.json({ ok: true });
});

export default router;
