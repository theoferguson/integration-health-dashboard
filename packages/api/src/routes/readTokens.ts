/**
 * Manage an org's read tokens (the credentials for the /api/v1 read surface).
 * Session-authed: members can list, admins can mint and revoke - the same
 * member-read / admin-write split as projects and monitors. The plaintext
 * secret is returned exactly once, at creation.
 */

import { Router } from 'express';
import {
  createReadToken,
  listReadTokensForOrg,
  revokeReadTokenForOrg,
} from '../services/readTokenStore.js';
import { requireOrgMember, requireOrgAdmin, getOrgId } from '../middleware/auth.js';

const router = Router();

router.use(requireOrgMember);

// List the org's tokens (metadata only - never the secret or hash).
router.get('/', (req, res) => {
  res.json({ tokens: listReadTokensForOrg(getOrgId(req)) });
});

// Mint a token. The `secret` in this response is shown once and is not retrievable later.
router.post('/', requireOrgAdmin, (req, res) => {
  const { name } = req.body ?? {};
  if (typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  const { token, secret } = createReadToken(getOrgId(req), name.trim());
  res.status(201).json({ token, secret });
});

// Revoke a token.
router.delete('/:id', requireOrgAdmin, (req, res) => {
  if (!revokeReadTokenForOrg(req.params.id, getOrgId(req))) {
    return res.status(404).json({ error: 'Token not found' });
  }
  res.json({ revoked: true });
});

export default router;
