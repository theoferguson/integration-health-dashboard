import { Router } from 'express';
import { getSession, requireAuth, requireOrgAdmin } from '../middleware/auth.js';
import { getMembershipForUser, regenerateInviteCode, joinOrgByCode } from '../services/orgStore.js';

const router = Router();

router.use(requireAuth);

router.get('/me', (req, res) => {
  const session = getSession(req)!;
  const membership = getMembershipForUser(session.userId);

  if (!membership) {
    res.json({ org: null });
    return;
  }

  res.json({
    org: {
      id: membership.org.id,
      name: membership.org.name,
      // invite code is only useful (and only shown) to an admin
      inviteCode: membership.role === 'admin' ? membership.org.inviteCode : undefined,
    },
    role: membership.role,
  });
});

router.post('/invite/regenerate', requireOrgAdmin, (req, res) => {
  const session = getSession(req)!;
  const membership = getMembershipForUser(session.userId)!;
  const inviteCode = regenerateInviteCode(membership.org.id);
  res.json({ inviteCode });
});

router.post('/join', (req, res) => {
  const session = getSession(req)!;
  const { code } = req.body;

  if (typeof code !== 'string' || !code.trim()) {
    res.status(400).json({ error: 'code is required' });
    return;
  }

  const org = joinOrgByCode(session.userId, code.trim());
  if (!org) {
    res.status(404).json({ error: 'Invalid invite code' });
    return;
  }

  res.json({ org: { id: org.id, name: org.name } });
});

export default router;
