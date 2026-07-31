import { Router } from 'express';
import { randomBytes } from 'crypto';
import { createSessionToken } from '../services/authToken.js';
import { findOrCreateUserByIdentity, displayName } from '../services/userStore.js';
import { getMembershipForUser, createOrgForUser } from '../services/orgStore.js';
import { getSession } from '../middleware/auth.js';

const router = Router();

const SESSION_COOKIE = 'ihd_session';
const STATE_COOKIE = 'ihd_oauth_state';
const isProd = process.env.NODE_ENV === 'production';
const FRONTEND_DEV_URL = 'http://localhost:5173';

function callbackUrl(req: import('express').Request): string {
  return `${req.protocol}://${req.get('host')}/api/auth/callback`;
}

/**
 * GitHub's `/user/emails` -> the primary verified address (or null). Requires the
 * `user:email` scope. GitHub only lists a user's own emails and marks which is
 * primary/verified, so a returned address is safe to treat as verified.
 */
async function fetchGithubPrimaryEmail(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch('https://api.github.com/user/emails', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'User-Agent': 'integration-health-dashboard',
      },
    });
    if (!res.ok) return null;
    const emails = (await res.json()) as { email: string; primary: boolean; verified: boolean }[];
    const chosen = emails.find((e) => e.primary && e.verified) ?? emails.find((e) => e.verified);
    return chosen?.email ?? null;
  } catch {
    return null;
  }
}

router.get('/login', (req, res) => {
  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
  if (!clientId) {
    return res.status(500).send('GITHUB_OAUTH_CLIENT_ID is not configured');
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
    redirect_uri: callbackUrl(req),
    // user:email lets us read the primary VERIFIED email, which becomes the
    // cross-provider account-linking key (Phase 2).
    scope: 'read:user user:email',
    state,
  });

  res.redirect(`https://github.com/login/oauth/authorize?${params}`);
});

router.get('/callback', async (req, res) => {
  const { code, state } = req.query;
  const expectedState = req.cookies?.[STATE_COOKIE];
  res.clearCookie(STATE_COOKIE);

  const redirectHome = () => res.redirect(isProd ? '/' : FRONTEND_DEV_URL);

  if (!code || typeof code !== 'string' || !state || state !== expectedState) {
    return redirectHome();
  }

  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return res.status(500).send('GitHub OAuth is not fully configured');
  }

  try {
    const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: callbackUrl(req),
      }),
    });
    const tokenData = (await tokenResponse.json()) as { access_token?: string };
    if (!tokenData.access_token) {
      return redirectHome();
    }

    const userResponse = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        'User-Agent': 'integration-health-dashboard',
      },
    });
    const ghUser = (await userResponse.json()) as {
      login?: string;
      name?: string | null;
      avatar_url?: string | null;
    };

    if (!ghUser.login) {
      return redirectHome();
    }

    // Primary verified email (needs the user:email scope) - the account-linking
    // key so the same person via another provider later lands on this account.
    // null if GitHub won't share a verified address.
    const email = await fetchGithubPrimaryEmail(tokenData.access_token);

    // Open signup: any successful GitHub login gets an account. This is a generic
    // platform any project can report into, not a single-admin tool.
    const user = findOrCreateUserByIdentity({
      provider: 'github',
      providerUserId: ghUser.login,
      email,
      emailVerified: email !== null, // this endpoint only yields verified primaries
      name: ghUser.name ?? null,
      avatarUrl: ghUser.avatar_url ?? null,
    });
    if (!getMembershipForUser(user.id)) {
      createOrgForUser(user.id, `${displayName(user)}'s org`);
    }
    res.cookie(SESSION_COOKIE, createSessionToken(user.id, displayName(user)), {
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
  res.json({
    loggedIn: session !== null,
    login: session?.login ?? null,
  });
});

export default router;
