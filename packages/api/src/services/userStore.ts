/**
 * User Store
 * Anyone with a GitHub account can sign in - findOrCreateUser is the entire
 * signup flow, no separate registration step.
 */
import { randomUUID } from 'crypto';
import { db } from '../db/connection.js';

export interface User {
  id: string;
  githubLogin: string;
  createdAt: Date;
}

interface UserRow {
  id: string;
  github_login: string;
  created_at: number;
}

function rowToUser(row: UserRow): User {
  return {
    id: row.id,
    githubLogin: row.github_login,
    createdAt: new Date(row.created_at),
  };
}

export function findOrCreateUser(githubLogin: string): User {
  const existing = db.prepare('SELECT * FROM users WHERE github_login = ?').get(githubLogin) as
    | UserRow
    | undefined;
  if (existing) return rowToUser(existing);

  const user: User = { id: randomUUID(), githubLogin, createdAt: new Date() };
  db.prepare('INSERT INTO users (id, github_login, created_at) VALUES (?, ?, ?)').run(
    user.id,
    user.githubLogin,
    user.createdAt.getTime()
  );
  return user;
}

export function getUserById(id: string): User | undefined {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
  return row ? rowToUser(row) : undefined;
}
