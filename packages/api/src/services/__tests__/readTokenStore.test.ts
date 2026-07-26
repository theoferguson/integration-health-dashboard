import { describe, it, expect } from 'vitest';
import {
  createReadToken,
  verifyReadToken,
  listReadTokensForOrg,
  revokeReadTokenForOrg,
} from '../readTokenStore.js';
import { findOrCreateUser } from '../userStore.js';
import { createOrgForUser } from '../orgStore.js';

// read_tokens.org_id is a real FK (better-sqlite3 enforces foreign keys), so
// each token needs a genuine org - mint one per call.
const orgId = () => createOrgForUser(findOrCreateUser(`u-${Math.random()}`).id, 'org').id;

describe('readTokenStore', () => {
  it('mints a token whose secret verifies back to its org', () => {
    const org = orgId();
    const { token, secret } = createReadToken(org, 'agent-1');

    expect(secret.startsWith('ihd_read_')).toBe(true);
    expect(token.prefix).toBe(secret.slice(0, 'ihd_read_'.length + 6));

    const ctx = verifyReadToken(secret);
    expect(ctx).toEqual({ orgId: org, tokenId: token.id });
  });

  it('rejects unknown, malformed, and revoked secrets', () => {
    const org = orgId();
    const { token, secret } = createReadToken(org, 'agent-2');

    expect(verifyReadToken('ihd_read_deadbeef')).toBeNull(); // unknown
    expect(verifyReadToken('not-a-token')).toBeNull(); // missing prefix

    expect(revokeReadTokenForOrg(token.id, org)).toBe(true);
    expect(verifyReadToken(secret)).toBeNull(); // revoked
    // Revoke is idempotent - a second revoke reports no change.
    expect(revokeReadTokenForOrg(token.id, org)).toBe(false);
  });

  it("won't revoke another org's token", () => {
    const org = orgId();
    const { token } = createReadToken(org, 'agent-3');
    expect(revokeReadTokenForOrg(token.id, orgId())).toBe(false); // different org
    expect(revokeReadTokenForOrg(token.id, org)).toBe(true);
  });

  it('lists an org tokens without leaking the secret or hash', () => {
    const org = orgId();
    createReadToken(org, 'a');
    createReadToken(org, 'b');
    const tokens = listReadTokensForOrg(org);

    expect(tokens).toHaveLength(2);
    for (const t of tokens) {
      const keys = Object.keys(t);
      expect(keys).not.toContain('token_hash');
      expect(keys).not.toContain('tokenHash');
      expect(keys).not.toContain('secret');
      // Only the short non-secret prefix is exposed, not a full-length secret.
      expect(t.prefix.startsWith('ihd_read_')).toBe(true);
      expect(t.prefix.length).toBe('ihd_read_'.length + 6);
    }
  });
});
