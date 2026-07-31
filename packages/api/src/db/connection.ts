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
  -- A user is provider-agnostic (Phase 2): identified by its linked identities,
  -- not by a GitHub login. github_login is nullable (a Google/email user has
  -- none) but still UNIQUE and still written for GitHub sign-ins. (email/name/
  -- avatar_url are added by the migration below for tables that predate them.)
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    github_login TEXT UNIQUE,
    email TEXT,
    name TEXT,
    avatar_url TEXT,
    created_at INTEGER NOT NULL
  );

  -- Federated identities: one row per (provider, provider account) linked to a
  -- user. A user can have several (GitHub + Google + email, ...), which is how
  -- one person signs in via multiple providers and lands on the same account.
  -- provider_user_id is the provider's account id. For GitHub we use the login
  -- (what we've always stored); note GitHub logins are renameable, so a rename
  -- looks like a new identity and re-links via the verified email. See
  -- services/userStore.
  CREATE TABLE IF NOT EXISTS identities (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    provider TEXT NOT NULL,
    provider_user_id TEXT NOT NULL,
    email TEXT,
    created_at INTEGER NOT NULL,
    UNIQUE (provider, provider_user_id)
  );

  CREATE INDEX IF NOT EXISTS idx_identities_user ON identities(user_id);
  CREATE INDEX IF NOT EXISTS idx_identities_email ON identities(email);

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

  -- Read tokens: org-scoped, read-only credentials for the /api/v1 programmatic
  -- surface (Door 2). Distinct from a project's ingest api_key and from the
  -- browser session. Only the SHA-256 hash is stored - the secret is shown once
  -- at creation. 'prefix' is a non-secret snippet for display in the UI/CLI.
  CREATE TABLE IF NOT EXISTS read_tokens (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES orgs(id),
    name TEXT NOT NULL,
    token_hash TEXT UNIQUE NOT NULL,
    prefix TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_used_at INTEGER,
    revoked_at INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_read_tokens_org ON read_tokens(org_id);
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

// Identity generalization (Phase 2): a user is no longer defined by its GitHub
// login. Add provider-agnostic profile columns (additive - github_login stays,
// still written for GitHub sign-ins and used by the legacy org backfill below).
const userColumns = db.prepare('PRAGMA table_info(users)').all() as { name: string }[];
for (const col of ['email', 'name', 'avatar_url']) {
  if (!userColumns.some((c) => c.name === col)) {
    db.exec(`ALTER TABLE users ADD COLUMN ${col} TEXT`);
  }
}
// Enforce one account per verified email (the account-linking key). Partial so
// the many null emails stay allowed. Created AFTER the ALTER above so the column
// exists on upgraded prod DBs. Safe on existing data: legacy users have email=NULL.
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL');

// Backfill a 'github' identity for every existing user (keyed on the github_login
// we already stored), so the new identities table has a row for each legacy
// account and nobody is stranded. Idempotent: only users with no identity yet.
const usersNeedingIdentity = db
  .prepare(
    `SELECT id, github_login FROM users
     WHERE github_login IS NOT NULL AND id NOT IN (SELECT user_id FROM identities)`
  )
  .all() as { id: string; github_login: string }[];
for (const u of usersNeedingIdentity) {
  db.prepare(
    `INSERT OR IGNORE INTO identities (id, user_id, provider, provider_user_id, email, created_at)
     VALUES (?, ?, 'github', ?, NULL, ?)`
  ).run(randomUUID(), u.id, u.github_login, Date.now());
}

// Backfill: every user without an org membership gets an auto-created personal
// org (as admin), and any of their pre-org projects get attached to it.
const usersWithoutOrg = db
  .prepare(
    `SELECT id, github_login, name, email FROM users
     WHERE id NOT IN (SELECT user_id FROM org_memberships)`
  )
  .all() as { id: string; github_login: string | null; name: string | null; email: string | null }[];

for (const user of usersWithoutOrg) {
  const orgId = randomUUID();
  const now = Date.now();
  // github_login is nullable now, so fall back through name/email to avoid a
  // literal "null's org" for a non-GitHub account.
  const label = user.name ?? user.email ?? user.github_login ?? 'My';
  db.prepare(
    'INSERT INTO orgs (id, name, invite_code, created_at) VALUES (?, ?, ?, ?)'
  ).run(orgId, `${label}'s org`, randomBytes(6).toString('hex'), now);
  db.prepare(
    'INSERT INTO org_memberships (user_id, org_id, role, created_at) VALUES (?, ?, ?, ?)'
  ).run(user.id, orgId, 'admin', now);
  db.prepare(
    'UPDATE projects SET org_id = ? WHERE user_id = ? AND org_id IS NULL'
  ).run(orgId, user.id);
}
