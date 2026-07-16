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
  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    integration TEXT NOT NULL,
    event_type TEXT NOT NULL,
    status TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    payload TEXT NOT NULL,
    error TEXT,
    classification TEXT,
    resolution TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp DESC);
  CREATE INDEX IF NOT EXISTS idx_events_integration ON events(integration);
  CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);
`);
