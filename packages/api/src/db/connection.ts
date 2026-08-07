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
  -- TODO(rename-stability): key GitHub identities on the STABLE numeric ghUser.id
  -- instead of the login. Deferred because legacy rows only stored the login;
  -- doing it right needs a dual-key lookback (match id OR login, then migrate the
  -- row to the id on next sign-in) so existing accounts aren't stranded.
  -- password_hash is set ONLY on provider='password' rows (null for every OAuth
  -- provider): the scrypt digest for email+password sign-in. See
  -- services/passwordAuth.ts.
  CREATE TABLE IF NOT EXISTS identities (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    provider TEXT NOT NULL,
    provider_user_id TEXT NOT NULL,
    email TEXT,
    password_hash TEXT,
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

  -- ---- OAuth authorization server (ROADMAP #11, Phase 4) -------------------
  -- Lets Claude.ai / Claude Desktop connect via browser sign-in instead of a
  -- pasted read token. See services/oauthStore.ts and mcp/oauthProvider.ts.

  -- Clients registered via RFC 7591 dynamic client registration. Deliberately
  -- NO client_secret column: every client is registered PUBLIC
  -- (token_endpoint_auth_method 'none') and authenticated by PKCE instead. The
  -- MCP SDK compares client secrets in PLAINTEXT (authenticateClient in
  -- server/auth/middleware/clientAuth.js), so storing one would mean keeping a
  -- usable credential at rest. Public + PKCE is also what OAuth 2.1 recommends
  -- for clients that can't keep a secret, which is exactly what these are.
  CREATE TABLE IF NOT EXISTS oauth_clients (
    client_id TEXT PRIMARY KEY,
    client_name TEXT,
    redirect_uris TEXT NOT NULL,
    grant_types TEXT NOT NULL,
    response_types TEXT NOT NULL,
    scope TEXT,
    created_at INTEGER NOT NULL
  );

  -- An /authorize request parked while the user signs in and consents. Holds no
  -- user identity - that's only known once consent is submitted with a session.
  CREATE TABLE IF NOT EXISTS oauth_pending (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    redirect_uri TEXT NOT NULL,
    code_challenge TEXT NOT NULL,
    state TEXT,
    scope TEXT,
    resource TEXT,
    expires_at INTEGER NOT NULL
  );

  -- Issued authorization codes. Single-use: consumed_at is stamped on exchange,
  -- and a second exchange of the same code is refused (OAuth 2.1 requires it).
  -- Only the hash is stored, like read tokens.
  CREATE TABLE IF NOT EXISTS oauth_codes (
    code_hash TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    org_id TEXT NOT NULL,
    redirect_uri TEXT NOT NULL,
    code_challenge TEXT NOT NULL,
    scope TEXT,
    resource TEXT,
    expires_at INTEGER NOT NULL,
    consumed_at INTEGER
  );

  -- Access + refresh tokens, hashed. The resource column is the RFC 8707
  -- audience: a token minted for this MCP server must not be replayable elsewhere.
  CREATE TABLE IF NOT EXISTS oauth_tokens (
    token_hash TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('access', 'refresh')),
    client_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    org_id TEXT NOT NULL,
    scope TEXT,
    resource TEXT,
    expires_at INTEGER,
    revoked_at INTEGER,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_oauth_tokens_user ON oauth_tokens(user_id);
  CREATE INDEX IF NOT EXISTS idx_oauth_codes_expiry ON oauth_codes(expires_at);
  CREATE INDEX IF NOT EXISTS idx_oauth_pending_expiry ON oauth_pending(expires_at);
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
const userColumns = db.prepare('PRAGMA table_info(users)').all() as {
  name: string;
  notnull: number;
}[];
for (const col of ['email', 'name', 'avatar_url']) {
  if (!userColumns.some((c) => c.name === col)) {
    db.exec(`ALTER TABLE users ADD COLUMN ${col} TEXT`);
  }
}

// Email+password sign-in (Phase 3 Build 2): the identities table on deployments
// that predate it has no password_hash, and CREATE IF NOT EXISTS won't add one.
const identityColumns = db.prepare('PRAGMA table_info(identities)').all() as { name: string }[];
if (!identityColumns.some((c) => c.name === 'password_hash')) {
  db.exec('ALTER TABLE identities ADD COLUMN password_hash TEXT');
}

// Non-GitHub sign-in unblock (Phase 3): relax github_login NOT NULL on existing
// prod DBs. Fresh DBs already declare it nullable (see the CREATE above), but the
// original prod table was `github_login TEXT UNIQUE NOT NULL` and CREATE IF NOT
// EXISTS is a no-op there - so inserting a Google/Facebook user (github_login =
// NULL) would violate NOT NULL. SQLite can't ALTER a column's nullability, so we
// run the standard 12-step table rebuild. GUARDED + idempotent: only rebuild when
// PRAGMA reports github_login as notnull=1, so this is skipped on fresh/already-
// migrated DBs. Runs AFTER the email/name/avatar ALTER above so those columns are
// guaranteed present for the row-copy. Every row + id is preserved, so the
// org_memberships / projects / read_tokens FK references to users(id) still hold.
const githubLoginCol = (
  db.prepare('PRAGMA table_info(users)').all() as { name: string; notnull: number }[]
).find((c) => c.name === 'github_login');
if (githubLoginCol?.notnull === 1) {
  const rebuild = db.transaction(() => {
    db.exec(`
      CREATE TABLE users_new (
        id TEXT PRIMARY KEY,
        github_login TEXT UNIQUE,
        email TEXT,
        name TEXT,
        avatar_url TEXT,
        created_at INTEGER NOT NULL
      );
      INSERT INTO users_new (id, github_login, email, name, avatar_url, created_at)
        SELECT id, github_login, email, name, avatar_url, created_at FROM users;
      DROP TABLE users;
      ALTER TABLE users_new RENAME TO users;
    `);
  });
  // foreign_keys must be toggled OUTSIDE the transaction (the pragma is a no-op
  // mid-transaction), so the DROP TABLE users isn't blocked by the FK references.
  db.pragma('foreign_keys = OFF');
  rebuild();
  db.pragma('foreign_keys = ON');
}

// Enforce one account per verified email (the account-linking key). Partial so
// the many null emails stay allowed. Created AFTER the ALTER + rebuild above so
// the column exists and the index (dropped with the old table in a rebuild) is
// recreated. Safe on existing data: legacy users have email=NULL.
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
