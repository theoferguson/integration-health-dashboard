/**
 * OAuth consent screen (ROADMAP #11, Phase 4)
 *
 * The session bridge between the MCP SDK's authorization server and this app's
 * existing sign-in. `oauthProvider.authorize()` can't see the browser session
 * (the SDK hands it no `req`), so it parks the request and redirects here, where
 * the session cookie IS available.
 *
 * Two states, one page:
 *   - signed out -> the same providers the dashboard offers, each carrying a
 *     `next` back to this page, plus an email+password form.
 *   - signed in  -> what's being granted, to whom, for which org. Approving
 *     mints the authorization code and returns the browser to the client.
 *
 * Server-rendered rather than routed through the SPA: this page must work before
 * the app bundle loads and must never be confused with the dashboard's own UI.
 */

import { Router, urlencoded } from 'express';
import { getSession } from '../middleware/auth.js';
import { getUserById, displayName } from '../services/userStore.js';
import { getMembershipForUser } from '../services/orgStore.js';
import {
  getPendingAuthorization,
  deletePendingAuthorization,
  createAuthorizationCode,
  getOAuthClient,
} from '../services/oauthStore.js';
import { authRateLimiter } from '../middleware/rateLimit.js';

const router = Router();

/**
 * Escape text for HTML interpolation. NOT optional: `client_name` comes from
 * unauthenticated dynamic client registration, so anyone can register a client
 * named `<script>…` and this page would run it against the user's session.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Send the browser back to the client with an OAuth error, per the spec. */
function denyRedirect(redirectUri: string, state: string | null, error: string): string {
  const url = new URL(redirectUri);
  url.searchParams.set('error', error);
  if (state) url.searchParams.set('state', state);
  return url.href;
}

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 15px/1.5 system-ui, -apple-system, sans-serif; margin: 0;
         min-height: 100vh; display: grid; place-items: center; background: #f9fafb; color: #111827; }
  .card { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 28px;
          width: min(420px, calc(100vw - 32px)); box-shadow: 0 1px 3px rgb(0 0 0 / .08); }
  h1 { font-size: 18px; margin: 0 0 6px; }
  p { color: #6b7280; font-size: 13px; margin: 0 0 16px; }
  .grants { list-style: none; padding: 0; margin: 0 0 20px; }
  .grants li { padding: 8px 0; border-top: 1px solid #f3f4f6; font-size: 13px; }
  .row { display: flex; gap: 8px; }
  button, .btn { flex: 1; padding: 10px 14px; border-radius: 8px; font-size: 14px; font-weight: 500;
                 cursor: pointer; border: 1px solid #d1d5db; background: #fff; color: #374151;
                 text-align: center; text-decoration: none; display: block; }
  .primary { background: #2563eb; border-color: #2563eb; color: #fff; }
  input { width: 100%; box-sizing: border-box; padding: 8px 10px; margin-bottom: 8px;
          border: 1px solid #d1d5db; border-radius: 6px; font-size: 14px; }
  .muted { font-size: 12px; color: #9ca3af; margin-top: 14px; }
  .err { color: #dc2626; font-size: 13px; }
  @media (prefers-color-scheme: dark) {
    body { background: #0b0f19; color: #e5e7eb; }
    .card { background: #111827; border-color: #1f2937; }
    .grants li { border-color: #1f2937; }
    button, .btn { background: #1f2937; border-color: #374151; color: #e5e7eb; }
    .primary { background: #2563eb; border-color: #2563eb; color: #fff; }
    input { background: #1f2937; border-color: #374151; color: #e5e7eb; }
  }
</style></head><body><div class="card">${body}</div></body></html>`;
}

const PROVIDERS = [
  { id: 'google', label: 'Continue with Google' },
  { id: 'github', label: 'Continue with GitHub' },
  { id: 'facebook', label: 'Continue with Facebook' },
];

function signInPage(pendingId: string, clientName: string): string {
  const next = `/oauth/consent?p=${encodeURIComponent(pendingId)}`;
  const buttons = PROVIDERS.map(
    (p) =>
      `<a class="btn" style="margin-bottom:8px" href="/api/auth/login/${p.id}?next=${encodeURIComponent(
        next
      )}">${escapeHtml(p.label)}</a>`
  ).join('');

  return page(
    'Sign in to continue',
    `<h1>Sign in to continue</h1>
     <p><strong>${escapeHtml(clientName)}</strong> wants to connect to your Integration Health
        Dashboard. Sign in to choose whether to allow it.</p>
     ${buttons}
     <p class="muted" style="text-align:center;margin:14px 0 10px">or with email</p>
     <form id="pw">
       <input name="email" type="email" placeholder="Email" autocomplete="email" required>
       <input name="password" type="password" placeholder="Password" autocomplete="current-password" required>
       <button class="primary" type="submit">Sign in</button>
       <p class="err" id="e"></p>
     </form>
     <script>
       document.getElementById('pw').addEventListener('submit', async (ev) => {
         ev.preventDefault();
         const f = new FormData(ev.target);
         const r = await fetch('/api/auth/login', {
           method: 'POST', headers: { 'Content-Type': 'application/json' },
           body: JSON.stringify({ email: f.get('email'), password: f.get('password') })
         });
         if (r.ok) { location.reload(); }
         else { document.getElementById('e').textContent =
                  (await r.json().catch(() => ({}))).error || 'Sign-in failed'; }
       });
     </script>`
  );
}

router.get('/consent', (req, res) => {
  const pendingId = String(req.query.p ?? '');
  const pending = getPendingAuthorization(pendingId);
  if (!pending) {
    // Nothing to redirect to - an expired or forged id has no trustworthy
    // redirect_uri, so this has to be a dead end rather than a redirect.
    return res
      .status(400)
      .send(page('Request expired', '<h1>Request expired</h1><p>Start the connection again from your MCP client.</p>'));
  }

  const client = getOAuthClient(pending.clientId);
  const clientName = client?.client_name || 'An MCP client';

  const session = getSession(req);
  const user = session ? getUserById(session.userId) : null;
  if (!user) {
    return res.send(signInPage(pendingId, clientName));
  }

  const membership = getMembershipForUser(user.id);
  if (!membership) {
    return res
      .status(400)
      .send(page('No organization', '<h1>No organization</h1><p>Your account isn\'t in an org yet, so there\'s no data to share. Open the dashboard first.</p>'));
  }

  return res.send(
    page(
      'Authorize connection',
      `<h1>Authorize connection</h1>
       <p><strong>${escapeHtml(clientName)}</strong> wants to read integration health data.</p>
       <ul class="grants">
         <li>Organization: <strong>${escapeHtml(membership.org.name)}</strong></li>
         <li>Signed in as: <strong>${escapeHtml(displayName(user))}</strong></li>
         <li><strong>Read-only.</strong> It cannot change or delete anything.</li>
       </ul>
       <form method="post" action="/oauth/consent" class="row">
         <input type="hidden" name="p" value="${escapeHtml(pendingId)}">
         <button name="decision" value="deny" type="submit">Deny</button>
         <button name="decision" value="approve" type="submit" class="primary">Allow</button>
       </form>
       <p class="muted">You can revoke this at any time from the dashboard.</p>`
    )
  );
});

// The form posts urlencoded; the global express.json() doesn't parse that, and
// the SDK's own router only adds a urlencoded parser to its own sub-routes.
router.post('/consent', authRateLimiter, urlencoded({ extended: false }), (req, res) => {
  const pendingId = String(req.body?.p ?? '');
  const pending = getPendingAuthorization(pendingId);
  if (!pending) {
    return res.status(400).send(page('Request expired', '<h1>Request expired</h1><p>Start the connection again from your MCP client.</p>'));
  }

  // Re-check the session on POST. The GET rendering it is not authorization -
  // a stale or signed-out tab must not be able to complete the grant.
  const session = getSession(req);
  const user = session ? getUserById(session.userId) : null;
  if (!user) {
    return res.redirect(302, `/oauth/consent?p=${encodeURIComponent(pendingId)}`);
  }

  if (req.body?.decision !== 'approve') {
    deletePendingAuthorization(pendingId);
    return res.redirect(302, denyRedirect(pending.redirectUri, pending.state, 'access_denied'));
  }

  const membership = getMembershipForUser(user.id);
  if (!membership) {
    deletePendingAuthorization(pendingId);
    return res.redirect(302, denyRedirect(pending.redirectUri, pending.state, 'access_denied'));
  }

  const code = createAuthorizationCode({
    clientId: pending.clientId,
    userId: user.id,
    orgId: membership.org.id,
    redirectUri: pending.redirectUri,
    codeChallenge: pending.codeChallenge,
    scope: pending.scope,
    resource: pending.resource,
  });
  // One consent, one code: the parked request is spent.
  deletePendingAuthorization(pendingId);

  const redirect = new URL(pending.redirectUri);
  redirect.searchParams.set('code', code);
  if (pending.state) redirect.searchParams.set('state', pending.state);
  return res.redirect(302, redirect.href);
});

export default router;
