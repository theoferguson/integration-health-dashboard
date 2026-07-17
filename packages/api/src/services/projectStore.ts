/**
 * Project Store
 * Projects identify who is allowed to POST /api/ingest and with what key.
 */

import { randomUUID, randomBytes } from 'crypto';
import { db } from '../db/connection.js';

export interface Project {
  id: string;
  name: string;
  apiKey: string;
  createdAt: Date;
}

interface ProjectRow {
  id: string;
  name: string;
  api_key: string;
  created_at: number;
}

function rowToProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    apiKey: row.api_key,
    createdAt: new Date(row.created_at),
  };
}

export function createProject(name: string): Project {
  const project: Project = {
    id: randomUUID(),
    name,
    apiKey: `proj_${randomBytes(24).toString('hex')}`,
    createdAt: new Date(),
  };

  db.prepare(
    'INSERT INTO projects (id, name, api_key, created_at) VALUES (?, ?, ?, ?)'
  ).run(project.id, project.name, project.apiKey, project.createdAt.getTime());

  return project;
}

export function getProjectByApiKey(apiKey: string): Project | undefined {
  const row = db.prepare('SELECT * FROM projects WHERE api_key = ?').get(apiKey) as
    | ProjectRow
    | undefined;
  return row ? rowToProject(row) : undefined;
}
