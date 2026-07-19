import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { randomUUID, randomBytes } from 'crypto';

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

  CREATE TABLE IF NOT EXISTS orgs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    invite_code TEXT UNIQUE NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS org_memberships (
    user_id TEXT NOT NULL REFERENCES users(id),
    org_id TEXT NOT NULL REFERENCES orgs(id),
    role TEXT NOT NULL CHECK (role IN ('admin', 'viewer')),
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, org_id)
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
    idempotency_key TEXT,
    metrics TEXT,
    tags TEXT,
    environment TEXT,
    severity TEXT,
    source TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp DESC);
  CREATE INDEX IF NOT EXISTS idx_events_integration ON events(integration);
  CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_events_idempotency
    ON events(project_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

  -- Monitors: an org-scoped saved event query rendered as a graph (#2). The
  -- graph is derived from the events table, so no firings table in v1.
  CREATE TABLE IF NOT EXISTS monitors (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES orgs(id),
    name TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    match_spec TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_monitors_org ON monitors(org_id);
`);

// CREATE TABLE IF NOT EXISTS is a no-op against a projects table that predates
// the multi-tenant migration - backfill the column on existing deployments.
const projectColumns = db.prepare('PRAGMA table_info(projects)').all() as { name: string }[];
if (!projectColumns.some((c) => c.name === 'user_id')) {
  db.exec('ALTER TABLE projects ADD COLUMN user_id TEXT REFERENCES users(id)');
}
if (!projectColumns.some((c) => c.name === 'org_id')) {
  db.exec('ALTER TABLE projects ADD COLUMN org_id TEXT REFERENCES orgs(id)');
}

// schemaVersion 2 event dimensions - add the columns on deployments whose events
// table predates them (CREATE IF NOT EXISTS won't alter an existing table).
const eventColumns = db.prepare('PRAGMA table_info(events)').all() as { name: string }[];
for (const col of ['metrics', 'tags', 'environment', 'severity', 'source']) {
  if (!eventColumns.some((c) => c.name === col)) {
    db.exec(`ALTER TABLE events ADD COLUMN ${col} TEXT`);
  }
}

// Backfill: every user without an org membership gets an auto-created personal
// org (as admin), and any of their pre-org projects get attached to it.
const usersWithoutOrg = db
  .prepare(
    `SELECT id, github_login FROM users
     WHERE id NOT IN (SELECT user_id FROM org_memberships)`
  )
  .all() as { id: string; github_login: string }[];

for (const user of usersWithoutOrg) {
  const orgId = randomUUID();
  const now = Date.now();
  db.prepare(
    'INSERT INTO orgs (id, name, invite_code, created_at) VALUES (?, ?, ?, ?)'
  ).run(orgId, `${user.github_login}'s org`, randomBytes(6).toString('hex'), now);
  db.prepare(
    'INSERT INTO org_memberships (user_id, org_id, role, created_at) VALUES (?, ?, ?, ?)'
  ).run(user.id, orgId, 'admin', now);
  db.prepare(
    'UPDATE projects SET org_id = ? WHERE user_id = ? AND org_id IS NULL'
  ).run(orgId, user.id);
}
