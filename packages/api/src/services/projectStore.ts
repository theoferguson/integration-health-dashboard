/**
 * Project Store
 * Projects identify who is allowed to POST /api/ingest and with what key.
 * Owned by an org (visible to every member, managed by admins) - the CLI
 * script (scripts/createProject.ts) still works standalone and creates an
 * ownerless project (orgId undefined), useful for bootstrapping/scripting
 * outside the web UI.
 */

import { randomUUID, randomBytes } from 'crypto';
import { db } from '../db/connection.js';

export interface Project {
  id: string;
  name: string;
  apiKey: string;
  orgId: string | null;
  createdAt: Date;
}

interface ProjectRow {
  id: string;
  name: string;
  api_key: string;
  org_id: string | null;
  created_at: number;
}

function rowToProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    apiKey: row.api_key,
    orgId: row.org_id,
    createdAt: new Date(row.created_at),
  };
}

export function createProject(name: string, orgId?: string): Project {
  const project: Project = {
    id: randomUUID(),
    name,
    apiKey: `proj_${randomBytes(24).toString('hex')}`,
    orgId: orgId ?? null,
    createdAt: new Date(),
  };

  db.prepare(
    'INSERT INTO projects (id, name, api_key, org_id, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(project.id, project.name, project.apiKey, project.orgId, project.createdAt.getTime());

  return project;
}

export function getProjectByApiKey(apiKey: string): Project | undefined {
  const row = db.prepare('SELECT * FROM projects WHERE api_key = ?').get(apiKey) as
    | ProjectRow
    | undefined;
  return row ? rowToProject(row) : undefined;
}

export function getProjectById(id: string): Project | undefined {
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined;
  return row ? rowToProject(row) : undefined;
}

export function listProjectsForOrg(orgId: string): Project[] {
  const rows = db.prepare('SELECT * FROM projects WHERE org_id = ? ORDER BY created_at DESC').all(
    orgId
  ) as ProjectRow[];
  return rows.map(rowToProject);
}

/** Returns false if the project doesn't exist or isn't owned by this org - same signal either way, so ownership can't be probed by id. */
export function deleteProjectForOrg(id: string, orgId: string): boolean {
  const result = db.prepare('DELETE FROM projects WHERE id = ? AND org_id = ?').run(id, orgId);
  return result.changes > 0;
}
