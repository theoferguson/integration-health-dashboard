/**
 * Org Store
 * A user's "current org" is their first membership (ordered by created_at) -
 * no org switcher, one active org per session. A user can still hold
 * memberships in more than one org (e.g. after joining via invite code).
 */
import { randomUUID, randomBytes } from 'crypto';
import { db } from '../db/connection.js';

export type OrgRole = 'admin' | 'viewer';

export interface Org {
  id: string;
  name: string;
  inviteCode: string;
  createdAt: Date;
}

export interface Membership {
  org: Org;
  role: OrgRole;
}

interface OrgRow {
  id: string;
  name: string;
  invite_code: string;
  created_at: number;
}

function rowToOrg(row: OrgRow): Org {
  return {
    id: row.id,
    name: row.name,
    inviteCode: row.invite_code,
    createdAt: new Date(row.created_at),
  };
}

export function createOrgForUser(userId: string, name: string): Org {
  const org: Org = {
    id: randomUUID(),
    name,
    inviteCode: randomBytes(6).toString('hex'),
    createdAt: new Date(),
  };
  const now = org.createdAt.getTime();
  db.prepare('INSERT INTO orgs (id, name, invite_code, created_at) VALUES (?, ?, ?, ?)').run(
    org.id,
    org.name,
    org.inviteCode,
    now
  );
  db.prepare(
    'INSERT INTO org_memberships (user_id, org_id, role, created_at) VALUES (?, ?, ?, ?)'
  ).run(userId, org.id, 'admin', now);
  return org;
}

/**
 * The user's active org and role within it, or null if they belong to none.
 * A user has exactly one membership (see joinOrgByCode) - the most recent one
 * wins if that invariant is ever broken.
 */
export function getMembershipForUser(userId: string): Membership | null {
  const row = db
    .prepare(
      `SELECT o.*, m.role as membership_role FROM org_memberships m
       JOIN orgs o ON o.id = m.org_id
       WHERE m.user_id = ?
       ORDER BY m.created_at DESC
       LIMIT 1`
    )
    .get(userId) as (OrgRow & { membership_role: OrgRole }) | undefined;
  if (!row) return null;
  return { org: rowToOrg(row), role: row.membership_role };
}

export function regenerateInviteCode(orgId: string): string {
  const inviteCode = randomBytes(6).toString('hex');
  db.prepare('UPDATE orgs SET invite_code = ? WHERE id = ?').run(inviteCode, orgId);
  return inviteCode;
}

/** Thrown by joinOrgByCode when leaving would leave an org with no admin. */
export class StrandedOrgError extends Error {
  constructor() {
    super('would_strand_org');
    this.name = 'StrandedOrgError';
  }
}

/**
 * True if this user leaving would strand an org: they're its sole admin and it
 * still has other members or projects that would be left unmanaged (invisible,
 * undeletable, still ingesting).
 */
function joinWouldStrandOrg(userId: string): boolean {
  const row = db
    .prepare(
      `SELECT 1 FROM org_memberships m
       WHERE m.user_id = ? AND m.role = 'admin'
         AND NOT EXISTS (
           SELECT 1 FROM org_memberships a
           WHERE a.org_id = m.org_id AND a.user_id != m.user_id AND a.role = 'admin')
         AND (
           EXISTS (SELECT 1 FROM org_memberships o WHERE o.org_id = m.org_id AND o.user_id != m.user_id)
           OR EXISTS (SELECT 1 FROM projects p WHERE p.org_id = m.org_id))
       LIMIT 1`
    )
    .get(userId);
  return !!row;
}

/**
 * Joins the org matching the invite code as a viewer, making it the user's
 * single active org (prior memberships are dropped). No-op join to an org the
 * user already belongs to just keeps their existing role. Throws StrandedOrgError
 * if leaving would strand an org (sole admin of an org with members/projects).
 * ponytail: one org per user; empty abandoned auto-created personal orgs aren't
 * garbage-collected. Add an org switcher + cleanup if multi-org is ever needed.
 */
export function joinOrgByCode(userId: string, inviteCode: string): Org | null {
  const row = db.prepare('SELECT * FROM orgs WHERE invite_code = ?').get(inviteCode) as
    | OrgRow
    | undefined;
  if (!row) return null;

  const alreadyMember = db
    .prepare('SELECT 1 FROM org_memberships WHERE user_id = ? AND org_id = ?')
    .get(userId, row.id);
  if (alreadyMember) return rowToOrg(row);

  if (joinWouldStrandOrg(userId)) throw new StrandedOrgError();

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM org_memberships WHERE user_id = ?').run(userId);
    db.prepare(
      "INSERT INTO org_memberships (user_id, org_id, role, created_at) VALUES (?, ?, 'viewer', ?)"
    ).run(userId, row.id, Date.now());
  });
  tx();

  return rowToOrg(row);
}
