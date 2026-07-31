import { describe, it, expect } from 'vitest';
import {
  findOrCreateUser,
  findOrCreateUserByIdentity,
  getUserById,
  displayName,
} from '../userStore.js';

const uniq = () => `${Math.random()}`.slice(2);

describe('userStore', () => {
  describe('findOrCreateUser (GitHub back-compat wrapper)', () => {
    it('creates a user for a first-time github login', () => {
      const login = `newuser-${uniq()}`;
      const user = findOrCreateUser(login);
      expect(user.githubLogin).toBe(login);
      expect(user.id).toBeDefined();
    });

    it('returns the same user on a repeat login (find, not duplicate-create)', () => {
      const login = `repeat-${uniq()}`;
      expect(findOrCreateUser(login).id).toBe(findOrCreateUser(login).id);
    });

    it('treats different logins as different users', () => {
      expect(findOrCreateUser(`a-${uniq()}`).id).not.toBe(findOrCreateUser(`b-${uniq()}`).id);
    });
  });

  describe('findOrCreateUserByIdentity', () => {
    it('creates a user + identity and carries profile fields', () => {
      const u = findOrCreateUserByIdentity({
        provider: 'github',
        providerUserId: `gh-${uniq()}`,
        email: `${uniq()}@example.com`,
        emailVerified: true,
        name: 'Ada Lovelace',
        avatarUrl: 'https://example.com/a.png',
      });
      expect(u.name).toBe('Ada Lovelace');
      expect(u.avatarUrl).toBe('https://example.com/a.png');
      expect(displayName(u)).toBe('Ada Lovelace');
    });

    it('returns the same user for a repeat sign-in with the same identity', () => {
      const id = `gh-${uniq()}`;
      const a = findOrCreateUserByIdentity({ provider: 'github', providerUserId: id });
      const b = findOrCreateUserByIdentity({ provider: 'github', providerUserId: id });
      expect(b.id).toBe(a.id);
    });

    it('LINKS a second provider to the same user when the email is verified', () => {
      const email = `${uniq()}@example.com`;
      const gh = findOrCreateUserByIdentity({
        provider: 'github',
        providerUserId: `gh-${uniq()}`,
        email,
        emailVerified: true,
      });
      // Same person signs in via Google with the same verified email.
      const google = findOrCreateUserByIdentity({
        provider: 'google',
        providerUserId: `goog-${uniq()}`,
        email,
        emailVerified: true,
        name: 'Grace Hopper',
      });
      expect(google.id).toBe(gh.id); // one account, two identities
      // Profile gap filled without clobbering.
      expect(getUserById(gh.id)?.name).toBe('Grace Hopper');
    });

    it('does NOT link on an UNVERIFIED email (account-takeover guard)', () => {
      const email = `${uniq()}@example.com`;
      const gh = findOrCreateUserByIdentity({
        provider: 'github',
        providerUserId: `gh-${uniq()}`,
        email,
        emailVerified: true,
      });
      const attacker = findOrCreateUserByIdentity({
        provider: 'google',
        providerUserId: `goog-${uniq()}`,
        email, // same address, but the provider did NOT verify it
        emailVerified: false,
      });
      expect(attacker.id).not.toBe(gh.id); // separate accounts - no hijack
    });

    it('does not link two identities that share no verified email', () => {
      const a = findOrCreateUserByIdentity({ provider: 'github', providerUserId: `gh-${uniq()}` });
      const b = findOrCreateUserByIdentity({ provider: 'google', providerUserId: `goog-${uniq()}` });
      expect(a.id).not.toBe(b.id);
    });

    it('an UNVERIFIED email cannot be pre-seeded to hijack a later verified sign-in', () => {
      // Attacker signs in FIRST asserting the victim's address, unverified.
      const victimEmail = `${uniq()}@corp.com`;
      const attacker = findOrCreateUserByIdentity({
        provider: 'google',
        providerUserId: `attacker-${uniq()}`,
        email: victimEmail,
        emailVerified: false,
      });
      // The unverified address must NOT have been stored (so it can't be a target).
      expect(getUserById(attacker.id)?.email).toBeNull();
      // Victim later signs in via GitHub with the genuinely-verified same address.
      const victim = findOrCreateUserByIdentity({
        provider: 'github',
        providerUserId: `victim-${uniq()}`,
        email: victimEmail,
        emailVerified: true,
      });
      expect(victim.id).not.toBe(attacker.id); // no takeover - separate accounts
    });

    it('creates a non-GitHub user with a NULL github_login (Phase 3 migration)', () => {
      // The point of the github_login NOT NULL relaxation: a Google sign-in has
      // no GitHub login, so the users row must accept github_login = NULL.
      const u = findOrCreateUserByIdentity({
        provider: 'google',
        providerUserId: `goog-${uniq()}`,
        email: `${uniq()}@example.com`,
        emailVerified: true,
        name: 'No GitHub Here',
      });
      expect(u.githubLogin).toBeNull();
      // ...and it round-trips (the insert succeeded and the row is findable).
      expect(getUserById(u.id)?.githubLogin).toBeNull();
      expect(getUserById(u.id)?.name).toBe('No GitHub Here');
    });

    it('links case-insensitively (normalized email)', () => {
      const local = uniq();
      const gh = findOrCreateUserByIdentity({
        provider: 'github',
        providerUserId: `gh-${uniq()}`,
        email: `Mixed.${local}@Example.COM`,
        emailVerified: true,
      });
      const google = findOrCreateUserByIdentity({
        provider: 'google',
        providerUserId: `goog-${uniq()}`,
        email: `mixed.${local}@example.com`,
        emailVerified: true,
      });
      expect(google.id).toBe(gh.id);
    });
  });

  describe('getUserById', () => {
    it('returns the user for a valid id', () => {
      const login = `lookup-${uniq()}`;
      const created = findOrCreateUser(login);
      expect(getUserById(created.id)?.githubLogin).toBe(login);
    });

    it('returns undefined for an unknown id', () => {
      expect(getUserById('not-a-real-id')).toBeUndefined();
    });
  });

  describe('displayName', () => {
    it('prefers name, then email, then github login, then a fallback', () => {
      const base = { id: 'x', avatarUrl: null, createdAt: new Date() };
      expect(displayName({ ...base, name: 'N', email: 'e@x.com', githubLogin: 'gh' })).toBe('N');
      expect(displayName({ ...base, name: null, email: 'e@x.com', githubLogin: 'gh' })).toBe('e@x.com');
      expect(displayName({ ...base, name: null, email: null, githubLogin: 'gh' })).toBe('gh');
      expect(displayName({ ...base, name: null, email: null, githubLogin: null })).toBe('user');
    });
  });
});
