import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

function resolveDbPath(): string {
  // Isolated, ephemeral DB per test run - never touches disk.
  if (process.env.VITEST || process.env.NODE_ENV === 'test') {
    return ':memory:';
  }

  const dbPath = process.env.DB_PATH || path.join(process.cwd(), 'data', 'ihd.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  return dbPath;
}

export const db: Database.Database = new Database(resolveDbPath());
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    github_login TEXT UNIQUE NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    api_key TEXT UNIQUE NOT NULL,
    user_id TEXT REFERENCES users(id),
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    project_id TEXT REFERENCES projects(id),
    integration TEXT NOT NULL,
    event_type TEXT NOT NULL,
    status TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    payload TEXT NOT NULL,
    error TEXT,
    classification TEXT,
    resolution TEXT,
    idempotency_key TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp DESC);
  CREATE INDEX IF NOT EXISTS idx_events_integration ON events(integration);
  CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_events_idempotency
    ON events(project_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
`);

// CREATE TABLE IF NOT EXISTS is a no-op against a projects table that predates
// the multi-tenant migration - backfill the column on existing deployments.
const projectColumns = db.prepare('PRAGMA table_info(projects)').all() as { name: string }[];
if (!projectColumns.some((c) => c.name === 'user_id')) {
  db.exec('ALTER TABLE projects ADD COLUMN user_id TEXT REFERENCES users(id)');
}
