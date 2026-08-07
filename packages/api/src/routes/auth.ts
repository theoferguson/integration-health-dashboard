import { Router } from 'express';
import type { Request, Response } from 'express';
import { randomBytes } from 'crypto';
import { createSessionToken } from '../services/authToken.js';
import {
  findOrCreateUserByIdentity,
  displayName,
  getUserById,
  getPasswordIdentity,
  normalizeEmail,
  type User,
} from '../services/userStore.js';
import { getMembershipForUser, createOrgForUser } from '../services/orgStore.js';
import { getSession } from '../middleware/auth.js';
import { authRateLimiter } from '../middleware/rateLimit.js';
import {
  hashPassword,
  verifyPassword,
  MIN_PASSWORD_LENGTH,
  DUMMY_PASSWORD_HASH,
} from '../services/passwordAuth.js';
import {
  oauthProviders,
  exchangeCodeForToken,
  type OAuthProviderId,
} from '../services/oauthProviders.js';

const router = Router();

const SESSION_COOKIE = 'ihd_session';
const STATE_COOKIE = 'ihd_oauth_state';
const isProd = process.env.NODE_ENV === 'production';
const FRONTEND_DEV_URL = 'http://localhost:5173';

/**
 * The redirect_uri for a given provider. It is now PER-PROVIDER
 * (`/api/auth/callback/<provider>`), so each provider's OAuth app must register
 * its own callback URL - the GitHub app's old `/api/auth/callback` must move to
 * `/api/auth/callback/github`. See the README.
 */
function callbackUrl(req: Request, provider: string): string {
  return `${req.protocol}://${req.get('host')}/api/auth/callback/${provider}`;
}

function lookupProvider(id: string) {
  return (oauthProviders as Record<string, (typeof oauthProviders)[OAuthProviderId]>)[id];
}

/**
 * Everything a successful sign-in does regardless of provider: make sure the
 * user has an org (first sign-in bootstraps one) and set the session cookie.
 * Shared by the OAuth callback and the password routes so the two paths can't
 * drift on cookie flags or the org bootstrap.
 */
function startSession(res: Response, user: User): void {
  if (!getMembershipForUser(user.id)) {
    createOrgForUser(user.id, `${displayName(user)}'s org`);
  }
  res.cookie(SESSION_COOKIE, createSessionToken(user.id), {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

// Back-compat: keep old `/api/auth/login` links working by sending them to the
// GitHub flow (the only provider before Phase 3).
router.get('/login', (_req, res) => {
  res.redirect('/api/auth/login/github');
});

router.get('/login/:provider', (req, res) => {
  const { provider } = req.params;
  const config = lookupProvider(provider);
  if (!config) {
    return res.status(404).send(`Unknown auth provider: ${provider}`);
  }

  const clientId = process.env[config.clientIdEnv];
  const clientSecret = process.env[config.clientSecretEnv];
  if (!clientId || !clientSecret) {
    return res.status(500).send(`${provider} OAuth is not configured`);
  }

  const state = randomBytes(16).toString('hex');
  res.cookie(STATE_COOKIE, state, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    maxAge: 10 * 60 * 1000,
  });

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: callbackUrl(req, provider),
    scope: config.scope,
    state,
    ...config.authorizeParams,
  });

  res.redirect(`${config.authorizeUrl}?${params}`);
});

router.get('/callback/:provider', async (req, res) => {
  const { provider } = req.params;
  const config = lookupProvider(provider);

  const redirectHome = () => res.redirect(isProd ? '/' : FRONTEND_DEV_URL);

  if (!config) {
    return res.status(404).send(`Unknown auth provider: ${provider}`);
  }

  const { code, state } = req.query;
  const expectedState = req.cookies?.[STATE_COOKIE];
  res.clearCookie(STATE_COOKIE);

  if (!code || typeof code !== 'string' || !state || state !== expectedState) {
    return redirectHome();
  }

  const clientId = process.env[config.clientIdEnv];
  const clientSecret = process.env[config.clientSecretEnv];
  if (!clientId || !clientSecret) {
    return res.status(500).send(`${provider} OAuth is not fully configured`);
  }

  try {
    const accessToken = await exchangeCodeForToken(config, {
      code,
      clientId,
      clientSecret,
      redirectUri: callbackUrl(req, provider),
    });
    if (!accessToken) {
      return redirectHome();
    }

    const profile = await config.fetchProfile(accessToken);
    if (!profile.providerUserId) {
      return redirectHome();
    }

    // Open signup: any successful provider login gets an account. The registry's
    // fetchProfile normalized the provider's response, so this call is identical
    // for every provider - the verified email (if any) is the account-linking key.
    const user = findOrCreateUserByIdentity({
      provider: provider as OAuthProviderId,
      providerUserId: profile.providerUserId,
      email: profile.email,
      emailVerified: profile.emailVerified,
      name: profile.name,
      avatarUrl: profile.avatarUrl,
    });
    startSession(res, user);
    return redirectHome();
  } catch (err) {
    console.error('[auth] callback error:', err);
    return redirectHome();
  }
});

// --- Email + password ---------------------------------------------------
// A local account is just another identity (provider='password'), so it reuses
// findOrCreateUserByIdentity and startSession like every OAuth provider. There
// is no mailer yet (ROADMAP #11), which has two deliberate consequences:
//   - NO email verification: emailVerified is false, so userStore never stores
//     the address as an account-linking key. A password account is therefore
//     always isolated - claiming someone else's address gains nothing.
//   - NO password reset. Forgetting the password means using an OAuth provider
//     instead. Add the reset flow when a mailer lands.

/** Reject anything that isn't a plausible address before it reaches the store. */
function isValidEmail(email: string): boolean {
  // Deliberately loose - the only real check on an address is sending to it,
  // which we can't do. This just rejects obvious junk and control characters.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

interface Credentials {
  email: string;
  password: string;
}

/** Pull + validate credentials from a request body. Returns an error string, or the pair. */
function readCredentials(body: unknown): { error: string } | Credentials {
  const { email, password } = (body ?? {}) as Record<string, unknown>;
  if (typeof email !== 'string' || typeof password !== 'string') {
    return { error: 'Email and password are required' };
  }
  const normalized = normalizeEmail(email);
  if (!normalized || !isValidEmail(normalized)) {
    return { error: 'Enter a valid email address' };
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` };
  }
  return { email: normalized, password };
}

router.post('/signup', authRateLimiter, async (req, res) => {
  const creds = readCredentials(req.body);
  if ('error' in creds) {
    return res.status(400).json({ error: creds.error });
  }

  if (getPasswordIdentity(creds.email)) {
    return res.status(409).json({ error: 'An account with that email already exists' });
  }

  try {
    const user = findOrCreateUserByIdentity({
      provider: 'password',
      providerUserId: creds.email,
      // NOT promoted to a linkable users.email (emailVerified stays false - we
      // have no way to confirm the address), so userStore drops it. It survives
      // as provider_user_id, which is what login looks up.
      email: creds.email,
      emailVerified: false,
      // Display only. users.email stays null for an unverified account, so
      // without this every password user would render as the generic "user"
      // fallback. `name` is never a lookup or linking key (findUserIdByEmail
      // reads users.email / identities.email only), so this is safe to set from
      // an unverified address.
      name: creds.email,
      passwordHash: await hashPassword(creds.password),
    });
    startSession(res, user);
    return res.status(201).json({ ok: true, login: displayName(user) });
  } catch (err) {
    // The UNIQUE(provider, provider_user_id) constraint is the real race guard -
    // two concurrent signups for one address leave exactly one winner.
    console.error('[auth] signup error:', err);
    return res.status(409).json({ error: 'An account with that email already exists' });
  }
});

router.post('/login', authRateLimiter, async (req, res) => {
  const creds = readCredentials(req.body);
  if ('error' in creds) {
    return res.status(400).json({ error: creds.error });
  }

  const identity = getPasswordIdentity(creds.email);
  // One message and one code for "no such account" and "wrong password", so the
  // endpoint isn't an account-existence oracle. Unknown addresses still pay the
  // scrypt cost (against a hash nothing matches) so timing doesn't leak it either.
  const invalid = () => res.status(401).json({ error: 'Incorrect email or password' });

  const ok = await verifyPassword(creds.password, identity?.passwordHash ?? DUMMY_PASSWORD_HASH);
  if (!ok || !identity) return invalid();

  const user = getUserById(identity.userId);
  if (!user) return invalid();

  startSession(res, user);
  return res.json({ ok: true, login: displayName(user) });
});

router.post('/logout', (req, res) => {
  res.clearCookie(SESSION_COOKIE);
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  const session = getSession(req);
  // Look the user up fresh (the token no longer carries a display field), so the
  // response reflects the current profile and nothing personal lives in the cookie.
  const user = session ? getUserById(session.userId) : null;
  res.json({ loggedIn: user !== null, login: user ? displayName(user) : null });
});

export default router;
