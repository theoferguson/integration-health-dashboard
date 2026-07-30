/**
 * Auth for the `/api/v1` read surface (Door 2). A separate front door from the
 * browser session (middleware/auth.ts) and the ingest api_key: a read token
 * resolves to an org and grants read-only access to that org's data, nothing
 * more. The resolved org id is stashed on res.locals for handlers to read via
 * readOrgId(res).
 */

import type { Request, Response, NextFunction } from 'express';
import { verifyReadToken } from '../services/readTokenStore.js';

/** Structured error envelope - the v1 surface always responds `{ error: { code, message } }`. */
export function apiError(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: { code, message } });
}

function bearerToken(req: Request): string | null {
  const header = req.header('authorization') || '';
  return header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : null;
}

export function requireReadToken(req: Request, res: Response, next: NextFunction): void {
  const token = bearerToken(req);
  if (!token) {
    apiError(res, 401, 'unauthorized', 'Provide a read token via Authorization: Bearer <token>');
    return;
  }

  const ctx = verifyReadToken(token);
  if (!ctx) {
    apiError(res, 401, 'invalid_token', 'Invalid or revoked read token');
    return;
  }

  res.locals.orgId = ctx.orgId;
  res.locals.tokenId = ctx.tokenId;
  res.locals.tokenName = ctx.name;
  next();
}

/** The caller's org id. Only valid after requireReadToken. */
export function readOrgId(res: Response): string {
  return res.locals.orgId as string;
}

/** The name the caller's token was minted with. Only valid after requireReadToken. */
export function readTokenName(res: Response): string {
  return res.locals.tokenName as string;
}
