import type { Request, Response, NextFunction } from 'express';
import { verifySessionToken, type SessionPayload } from '../services/authToken.js';

const SESSION_COOKIE = 'ihd_session';

export function getSession(req: Request): SessionPayload | null {
  return verifySessionToken(req.cookies?.[SESSION_COOKIE]);
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!getSession(req)) {
    res.status(401).json({ error: 'Sign-in required' });
    return;
  }
  next();
}
