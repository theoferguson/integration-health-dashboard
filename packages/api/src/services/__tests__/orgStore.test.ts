import { describe, it, expect } from 'vitest';
import {
  createOrgForUser,
  getMembershipForUser,
  regenerateInviteCode,
  joinOrgByCode,
} from '../orgStore.js';
import { findOrCreateUser } from '../userStore.js';

describe('orgStore', () => {
  it('createOrgForUser makes the user an admin of the new org', () => {
    const user = findOrCreateUser('org-admin');
    const org = createOrgForUser(user.id, "org-admin's org");

    const membership = getMembershipForUser(user.id);
    expect(membership?.org.id).toBe(org.id);
    expect(membership?.role).toBe('admin');
    expect(org.inviteCode).toMatch(/^[0-9a-f]+$/);
  });

  it('getMembershipForUser returns null for a user in no org', () => {
    const user = findOrCreateUser('no-org-user');
    expect(getMembershipForUser(user.id)).toBeNull();
  });

  it('regenerateInviteCode changes the code', () => {
    const user = findOrCreateUser('regen-user');
    const org = createOrgForUser(user.id, "regen-user's org");

    const newCode = regenerateInviteCode(org.id);

    expect(newCode).not.toBe(org.inviteCode);
    expect(getMembershipForUser(user.id)?.org.inviteCode).toBe(newCode);
  });

  describe('joinOrgByCode', () => {
    it('joins as a viewer and makes it the active org, dropping the personal org', () => {
      const admin = findOrCreateUser('join-admin');
      const target = createOrgForUser(admin.id, "join-admin's org");

      const joiner = findOrCreateUser('join-viewer');
      createOrgForUser(joiner.id, "join-viewer's personal org"); // auto-created on signup

      const joined = joinOrgByCode(joiner.id, target.inviteCode);

      expect(joined?.id).toBe(target.id);
      const membership = getMembershipForUser(joiner.id);
      expect(membership?.org.id).toBe(target.id);
      expect(membership?.role).toBe('viewer');
    });

    it('returns null for an unknown invite code', () => {
      const user = findOrCreateUser('bad-code-user');
      createOrgForUser(user.id, "bad-code-user's org");

      expect(joinOrgByCode(user.id, 'not-a-real-code')).toBeNull();
      // membership unchanged
      expect(getMembershipForUser(user.id)?.role).toBe('admin');
    });

    it('is a no-op that preserves role when already a member', () => {
      const admin = findOrCreateUser('self-join');
      const org = createOrgForUser(admin.id, "self-join's org");

      // Admin "joins" their own org via its code - should stay admin, not become viewer
      joinOrgByCode(admin.id, org.inviteCode);

      expect(getMembershipForUser(admin.id)?.role).toBe('admin');
    });
  });
});
