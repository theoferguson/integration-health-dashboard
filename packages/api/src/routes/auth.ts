import { Router } from 'express';
import type { Request } from 'express';
import { randomBytes } from 'crypto';
import { createSessionToken } from '../services/authToken.js';
import { findOrCreateUserByIdentity, displayName, getUserById } from '../services/userStore.js';
import { getMembershipForUser, createOrgForUser } from '../services/orgStore.js';
import { getSession } from '../middleware/auth.js';
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
    if (!getMembershipForUser(user.id)) {
      createOrgForUser(user.id, `${displayName(user)}'s org`);
    }
    res.cookie(SESSION_COOKIE, createSessionToken(user.id), {
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return redirectHome();
  } catch (err) {
    console.error('[auth] callback error:', err);
    return redirectHome();
  }
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
