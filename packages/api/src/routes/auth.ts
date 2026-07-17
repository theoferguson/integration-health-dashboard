import { Router } from 'express';
import { randomBytes } from 'crypto';
import { createSessionToken } from '../services/authToken.js';
import { findOrCreateUser } from '../services/userStore.js';
import { getSession } from '../middleware/auth.js';

const router = Router();

const SESSION_COOKIE = 'ihd_session';
const STATE_COOKIE = 'ihd_oauth_state';
const isProd = process.env.NODE_ENV === 'production';
const FRONTEND_DEV_URL = 'http://localhost:5173';

function callbackUrl(req: import('express').Request): string {
  return `${req.protocol}://${req.get('host')}/api/auth/callback`;
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
    scope: 'read:user',
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
    const ghUser = (await userResponse.json()) as { login?: string };

    if (!ghUser.login) {
      return redirectHome();
    }

    // Open signup: any successful GitHub login gets an account. This is a
    // generic platform any project can report into, not a single-admin tool.
    const user = findOrCreateUser(ghUser.login);
    res.cookie(SESSION_COOKIE, createSessionToken(user.id, user.githubLogin), {
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
