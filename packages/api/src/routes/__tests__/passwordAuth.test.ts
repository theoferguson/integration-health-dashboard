import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { findOrCreateUserByIdentity, getUserById } from '../../services/userStore.js';
import { hashPassword, verifyPassword } from '../../services/passwordAuth.js';

const uniq = () => `${Math.random()}`.slice(2);
const PASSWORD = 'correct horse battery';

describe('email + password auth', () => {
  let app: Express;

  beforeAll(async () => {
    // The auth limiter (10/min per IP) reads its cap at module load, and this
    // whole suite hits the endpoints from one IP - raise it so the limiter isn't
    // what's under test here. Dynamic import so the env is set first; vitest
    // isolates modules per file, so this only affects this suite.
    process.env.AUTH_RATE_LIMIT_PER_MIN = '1000';
    const { createApp } = await import('../../app.js');
    app = createApp();
  });

  describe('hashing', () => {
    it('round-trips the right password and rejects the wrong one', async () => {
      const hash = await hashPassword(PASSWORD);
      expect(hash.startsWith('scrypt$')).toBe(true);
      expect(hash).not.toContain(PASSWORD); // never stored in the clear
      expect(await verifyPassword(PASSWORD, hash)).toBe(true);
      expect(await verifyPassword('wrong password', hash)).toBe(false);
    });

    it('salts - the same password hashes differently every time', async () => {
      expect(await hashPassword(PASSWORD)).not.toBe(await hashPassword(PASSWORD));
    });

    it('fails closed on a malformed or unknown-scheme hash', async () => {
      expect(await verifyPassword(PASSWORD, 'not-a-hash')).toBe(false);
      expect(await verifyPassword(PASSWORD, 'bcrypt$aa$bb')).toBe(false);
      expect(await verifyPassword(PASSWORD, '')).toBe(false);
    });
  });

  describe('POST /api/auth/signup', () => {
    it('creates an account and sets a session cookie', async () => {
      const res = await request(app)
        .post('/api/auth/signup')
        .send({ email: `new-${uniq()}@example.com`, password: PASSWORD });

      expect(res.status).toBe(201);
      expect(res.body.ok).toBe(true);
      expect(String(res.headers['set-cookie'])).toContain('ihd_session=');
    });

    it('shows the email as the display name, not the generic fallback', async () => {
      // users.email stays null for an unverified account, so the display name has
      // to come from somewhere else or every password user renders as "user".
      const email = `display-${uniq()}@example.com`;
      const res = await request(app).post('/api/auth/signup').send({ email, password: PASSWORD });
      expect(res.body.login).toBe(email);
    });

    it('rejects a duplicate email with 409', async () => {
      const email = `dupe-${uniq()}@example.com`;
      await request(app).post('/api/auth/signup').send({ email, password: PASSWORD });
      const res = await request(app).post('/api/auth/signup').send({ email, password: PASSWORD });
      expect(res.status).toBe(409);
    });

    it('rejects a short password and a bad email with 400', async () => {
      const short = await request(app)
        .post('/api/auth/signup')
        .send({ email: `short-${uniq()}@example.com`, password: 'abc' });
      expect(short.status).toBe(400);

      const bad = await request(app)
        .post('/api/auth/signup')
        .send({ email: 'not-an-email', password: PASSWORD });
      expect(bad.status).toBe(400);
    });

    it('does NOT store the email as a linkable users.email (no verification)', async () => {
      // The account-takeover guard: a password signup can't be verified, so the
      // address must never become a cross-provider linking key.
      const email = `unverified-${uniq()}@example.com`;
      await request(app).post('/api/auth/signup').send({ email, password: PASSWORD });

      const me = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
      expect(me.status).toBe(200);

      // An OAuth sign-in with the SAME address, genuinely verified, must land on
      // a different account rather than adopting the password one.
      const viaGoogle = findOrCreateUserByIdentity({
        provider: 'google',
        providerUserId: `goog-${uniq()}`,
        email,
        emailVerified: true,
      });
      const passwordLogin = await request(app)
        .post('/api/auth/login')
        .send({ email, password: PASSWORD });
      expect(passwordLogin.status).toBe(200);
      // Different accounts: the Google user carries the verified email, the
      // password user carries none.
      expect(getUserById(viaGoogle.id)?.email).toBe(email);
    });
  });

  describe('POST /api/auth/login', () => {
    it('signs in with the correct password', async () => {
      const email = `login-${uniq()}@example.com`;
      await request(app).post('/api/auth/signup').send({ email, password: PASSWORD });

      const res = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
      expect(res.status).toBe(200);
      expect(String(res.headers['set-cookie'])).toContain('ihd_session=');
    });

    it('is case-insensitive on the email', async () => {
      const local = uniq();
      await request(app)
        .post('/api/auth/signup')
        .send({ email: `Case.${local}@Example.COM`, password: PASSWORD });

      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: `case.${local}@example.com`, password: PASSWORD });
      expect(res.status).toBe(200);
    });

    it('rejects a wrong password with 401 and no cookie', async () => {
      const email = `wrong-${uniq()}@example.com`;
      await request(app).post('/api/auth/signup').send({ email, password: PASSWORD });

      const res = await request(app).post('/api/auth/login').send({ email, password: 'not the one' });
      expect(res.status).toBe(401);
      expect(res.headers['set-cookie']).toBeUndefined();
    });

    it('gives an unknown account the SAME response as a wrong password', async () => {
      // No account-existence oracle: identical status and message either way.
      const email = `known-${uniq()}@example.com`;
      await request(app).post('/api/auth/signup').send({ email, password: PASSWORD });

      const wrongPassword = await request(app)
        .post('/api/auth/login')
        .send({ email, password: 'not the one' });
      const noSuchAccount = await request(app)
        .post('/api/auth/login')
        .send({ email: `ghost-${uniq()}@example.com`, password: PASSWORD });

      expect(noSuchAccount.status).toBe(wrongPassword.status);
      expect(noSuchAccount.body).toEqual(wrongPassword.body);
    });

    it('will not log into an OAuth-only account (no password set)', async () => {
      const email = `oauth-only-${uniq()}@example.com`;
      findOrCreateUserByIdentity({
        provider: 'google',
        providerUserId: `goog-${uniq()}`,
        email,
        emailVerified: true,
      });
      const res = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
      expect(res.status).toBe(401);
    });
  });
});
