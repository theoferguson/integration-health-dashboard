import type { Request, Response, NextFunction } from 'express';
import { verifySessionToken, type SessionPayload } from '../services/authToken.js';
import { getMembershipForUser } from '../services/orgStore.js';

const SESSION_COOKIE = 'ihd_session';

export function getSession(req: Request): SessionPayload | null {
  return verifySessionToken(req.cookies?.[SESSION_COOKIE]);
}

/** The caller's org id. Only valid after requireOrgMember - session + membership are assumed present. */
export function getOrgId(req: Request): string {
  const session = getSession(req)!;
  return getMembershipForUser(session.userId)!.org.id;
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!getSession(req)) {
    res.status(401).json({ error: 'Sign-in required' });
    return;
  }
  next();
}

/** Signed in AND belongs to an org - required for any org-scoped data or action. */
export function requireOrgMember(req: Request, res: Response, next: NextFunction): void {
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ error: 'Sign-in required' });
    return;
  }
  if (!getMembershipForUser(session.userId)) {
    res.status(403).json({ error: 'Not a member of any org' });
    return;
  }
  next();
}

/** Signed in AND an admin of their org - required for project/invite management. */
export function requireOrgAdmin(req: Request, res: Response, next: NextFunction): void {
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ error: 'Sign-in required' });
    return;
  }
  const membership = getMembershipForUser(session.userId);
  if (!membership) {
    res.status(403).json({ error: 'Not a member of any org' });
    return;
  }
  if (membership.role !== 'admin') {
    res.status(403).json({ error: 'Admin role required' });
    return;
  }
  next();
}
