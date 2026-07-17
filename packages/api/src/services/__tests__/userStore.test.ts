import { describe, it, expect } from 'vitest';
import { findOrCreateUser, getUserById } from '../userStore.js';

describe('userStore', () => {
  describe('findOrCreateUser', () => {
    it('should create a new user for a first-time github login', () => {
      const user = findOrCreateUser('newuser123');

      expect(user.githubLogin).toBe('newuser123');
      expect(user.id).toBeDefined();
    });

    it('should return the same user on a repeat login (find, not duplicate-create)', () => {
      const first = findOrCreateUser('repeatuser');
      const second = findOrCreateUser('repeatuser');

      expect(second.id).toBe(first.id);
    });

    it('should treat different logins as different users', () => {
      const a = findOrCreateUser('user-a');
      const b = findOrCreateUser('user-b');

      expect(a.id).not.toBe(b.id);
    });
  });

  describe('getUserById', () => {
    it('should return the user for a valid id', () => {
      const created = findOrCreateUser('lookupuser');

      const found = getUserById(created.id);

      expect(found?.githubLogin).toBe('lookupuser');
    });

    it('should return undefined for an unknown id', () => {
      expect(getUserById('not-a-real-id')).toBeUndefined();
    });
  });
});
