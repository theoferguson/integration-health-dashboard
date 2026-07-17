/**
 * Project Store
 * Projects identify who is allowed to POST /api/ingest and with what key.
 * Owned by the user who created them via the UI - the CLI script
 * (scripts/createProject.ts) still works standalone and creates an
 * ownerless project (userId undefined), useful for bootstrapping/scripting
 * outside the web UI.
 */

import { randomUUID, randomBytes } from 'crypto';
import { db } from '../db/connection.js';

export interface Project {
  id: string;
  name: string;
  apiKey: string;
  userId: string | null;
  createdAt: Date;
}

interface ProjectRow {
  id: string;
  name: string;
  api_key: string;
  user_id: string | null;
  created_at: number;
}

function rowToProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    apiKey: row.api_key,
    userId: row.user_id,
    createdAt: new Date(row.created_at),
  };
}

export function createProject(name: string, userId?: string): Project {
  const project: Project = {
    id: randomUUID(),
    name,
    apiKey: `proj_${randomBytes(24).toString('hex')}`,
    userId: userId ?? null,
    createdAt: new Date(),
  };

  db.prepare(
    'INSERT INTO projects (id, name, api_key, user_id, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(project.id, project.name, project.apiKey, project.userId, project.createdAt.getTime());

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

export function listProjectsForUser(userId: string): Project[] {
  const rows = db.prepare('SELECT * FROM projects WHERE user_id = ? ORDER BY created_at DESC').all(
    userId
  ) as ProjectRow[];
  return rows.map(rowToProject);
}

/** Returns false if the project doesn't exist or isn't owned by this user - same signal either way, so ownership can't be probed by id. */
export function deleteProjectForUser(id: string, userId: string): boolean {
  const result = db.prepare('DELETE FROM projects WHERE id = ? AND user_id = ?').run(id, userId);
  return result.changes > 0;
}
