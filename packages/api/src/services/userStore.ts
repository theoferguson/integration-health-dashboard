/**
 * User Store
 *
 * A user is PROVIDER-AGNOSTIC (Phase 2): it has an optional email / name / avatar
 * and one or more linked *identities* (github, google, facebook, password, ...).
 * Signing in goes through `findOrCreateUserByIdentity`, which is the entire
 * signup + login flow - no separate registration step. One person who signs in
 * via several providers lands on ONE user, linked by a provider-verified email.
 *
 * `github_login` on `users` is retained (still written for GitHub sign-ins) for
 * back-compat with the legacy org backfill in db/connection.ts. A later phase,
 * when the first non-GitHub provider ships, relaxes its NOT NULL.
 */
import { randomUUID } from 'crypto';
import { db } from '../db/connection.js';

export type IdentityProvider = 'github' | 'google' | 'facebook' | 'password';

export interface User {
  id: string;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
  githubLogin: string | null;
  createdAt: Date;
}

interface UserRow {
  id: string;
  email: string | null;
  name: string | null;
  avatar_url: string | null;
  github_login: string | null;
  created_at: number;
}

function rowToUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email ?? null,
    name: row.name ?? null,
    avatarUrl: row.avatar_url ?? null,
    githubLogin: row.github_login ?? null,
    createdAt: new Date(row.created_at),
  };
}

/** Best label to show for a user, in preference order. Never empty. */
export function displayName(user: User): string {
  return user.name || user.email || user.githubLogin || 'user';
}

export function getUserById(id: string): User | undefined {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
  return row ? rowToUser(row) : undefined;
}

interface IdentityRow {
  id: string;
  user_id: string;
  provider: string;
  provider_user_id: string;
  email: string | null;
  created_at: number;
}

export interface IdentityInput {
  provider: IdentityProvider;
  /** The provider's stable id for this account (for GitHub: the login). */
  providerUserId: string;
  /** The email this provider asserts for the account, if any. */
  email?: string | null;
  /**
   * Whether the provider has VERIFIED that email belongs to this account.
   * Cross-provider account linking happens ONLY when this is true: auto-linking
   * on an *unverified* email would let someone claim another user's account by
   * signing up elsewhere with that person's address.
   */
  emailVerified?: boolean;
  name?: string | null;
  avatarUrl?: string | null;
}

/** A user carrying this (verified-origin) email, if any - the link target. */
function findUserIdByEmail(email: string): string | undefined {
  const byUser = db.prepare('SELECT id FROM users WHERE email = ? LIMIT 1').get(email) as
    | { id: string }
    | undefined;
  if (byUser) return byUser.id;
  const byIdentity = db
    .prepare('SELECT user_id FROM identities WHERE email = ? LIMIT 1')
    .get(email) as { user_id: string } | undefined;
  return byIdentity?.user_id;
}

/** Fill profile fields that are currently empty; never overwrite existing data. */
function refreshProfile(userId: string, input: IdentityInput): void {
  const user = getUserById(userId);
  if (!user) return;
  const email = user.email ?? input.email ?? null;
  const name = user.name ?? input.name ?? null;
  const avatarUrl = user.avatarUrl ?? input.avatarUrl ?? null;
  const githubLogin =
    user.githubLogin ?? (input.provider === 'github' ? input.providerUserId : null);
  if (
    email !== user.email ||
    name !== user.name ||
    avatarUrl !== user.avatarUrl ||
    githubLogin !== user.githubLogin
  ) {
    db.prepare(
      'UPDATE users SET email = ?, name = ?, avatar_url = ?, github_login = ? WHERE id = ?'
    ).run(email, name, avatarUrl, githubLogin, userId);
  }
}

/**
 * Resolve a provider sign-in to a user, creating and/or linking as needed. The
 * entire signup + login flow:
 *   1. Known identity (provider + providerUserId) -> its user (profile refreshed).
 *   2. Else a VERIFIED email matching an existing user -> attach a new identity
 *      to that user (cross-provider account linking).
 *   3. Else -> a brand-new user + identity.
 */
export function findOrCreateUserByIdentity(input: IdentityInput): User {
  const { provider, providerUserId } = input;
  const email = input.email ?? null;
  const now = Date.now();

  const existing = db
    .prepare('SELECT * FROM identities WHERE provider = ? AND provider_user_id = ?')
    .get(provider, providerUserId) as IdentityRow | undefined;

  if (existing) {
    refreshProfile(existing.user_id, input);
    if (email !== existing.email) {
      db.prepare('UPDATE identities SET email = ? WHERE id = ?').run(email, existing.id);
    }
    return getUserById(existing.user_id)!;
  }

  // No identity yet. Link to an existing user only on a provider-verified email.
  let userId = email && input.emailVerified ? findUserIdByEmail(email) : undefined;

  if (userId) {
    refreshProfile(userId, input); // linking - fill gaps, don't clobber
  } else {
    userId = randomUUID();
    db.prepare(
      `INSERT INTO users (id, email, name, avatar_url, github_login, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      userId,
      email,
      input.name ?? null,
      input.avatarUrl ?? null,
      provider === 'github' ? providerUserId : null,
      now
    );
  }

  db.prepare(
    `INSERT INTO identities (id, user_id, provider, provider_user_id, email, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(randomUUID(), userId, provider, providerUserId, email, now);

  return getUserById(userId)!;
}

/**
 * Back-compat helper: create/return a user from a bare GitHub login, no email.
 * Kept for tests and any caller that only has a login. Prefer
 * findOrCreateUserByIdentity for real sign-ins (it carries email/name/avatar).
 */
export function findOrCreateUser(githubLogin: string): User {
  return findOrCreateUserByIdentity({ provider: 'github', providerUserId: githubLogin });
}
