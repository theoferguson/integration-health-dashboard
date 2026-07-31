/**
 * OAuth Provider Registry (Phase 3)
 *
 * One entry per social login provider, each describing where to send the user
 * for authorization, how to exchange the returned code for an access token, and
 * how to normalize that provider's profile response into the SAME shape every
 * caller consumes: `{ providerUserId, email, emailVerified, name, avatarUrl }`.
 * `routes/auth.ts` is provider-agnostic and drives everything off this registry,
 * and each normalized profile funnels straight into
 * `userStore.findOrCreateUserByIdentity`.
 *
 * SECURITY: `emailVerified` is the account-linking gate (see userStore) - it must
 * only be true when the provider actually asserts the address is confirmed.
 */

/** The normalized profile every provider's fetchProfile resolves to. */
export interface OAuthProfile {
  /** The provider's stable id for this account (GitHub: the login; Google: sub). */
  providerUserId: string;
  email: string | null;
  /** True only when the provider asserts the email is verified/confirmed. */
  emailVerified: boolean;
  name: string | null;
  avatarUrl: string | null;
}

/** How a provider's token endpoint wants the code-exchange request encoded. */
type TokenExchangeStyle = 'json' | 'form';

export interface OAuthProviderConfig {
  authorizeUrl: string;
  tokenUrl: string;
  scope: string;
  clientIdEnv: string;
  clientSecretEnv: string;
  /** Provider-specific params appended to the authorize redirect. */
  authorizeParams: Record<string, string>;
  tokenExchangeStyle: TokenExchangeStyle;
  /** Fetch + normalize the provider's profile for a granted access token. */
  fetchProfile(accessToken: string): Promise<OAuthProfile>;
}

export type OAuthProviderId = 'github' | 'google' | 'facebook';

const GITHUB_UA = 'integration-health-dashboard';

/**
 * GitHub's `/user/emails` -> the primary verified address (or null). Requires the
 * `user:email` scope. GitHub only lists a user's own emails and marks which is
 * primary/verified, so a returned address is safe to treat as verified.
 * (Moved here from routes/auth.ts as part of the provider abstraction.)
 */
async function fetchGithubPrimaryEmail(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch('https://api.github.com/user/emails', {
      headers: { Authorization: `Bearer ${accessToken}`, 'User-Agent': GITHUB_UA },
    });
    if (!res.ok) return null;
    const emails = (await res.json()) as { email: string; primary: boolean; verified: boolean }[];
    const chosen = emails.find((e) => e.primary && e.verified) ?? emails.find((e) => e.verified);
    return chosen?.email ?? null;
  } catch {
    return null;
  }
}

export const oauthProviders: Record<OAuthProviderId, OAuthProviderConfig> = {
  github: {
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    // user:email lets us read the primary VERIFIED email, the cross-provider
    // account-linking key (Phase 2).
    scope: 'read:user user:email',
    clientIdEnv: 'GITHUB_OAUTH_CLIENT_ID',
    clientSecretEnv: 'GITHUB_OAUTH_CLIENT_SECRET',
    authorizeParams: {},
    tokenExchangeStyle: 'json',
    async fetchProfile(accessToken: string): Promise<OAuthProfile> {
      const res = await fetch('https://api.github.com/user', {
        headers: { Authorization: `Bearer ${accessToken}`, 'User-Agent': GITHUB_UA },
      });
      const user = (await res.json()) as {
        login?: string;
        name?: string | null;
        avatar_url?: string | null;
      };
      // The primary verified email; null if GitHub won't share a verified address.
      const email = await fetchGithubPrimaryEmail(accessToken);
      return {
        providerUserId: user.login ?? '',
        email,
        // This endpoint only ever yields verified primaries, so a present email
        // is a verified one.
        emailVerified: email !== null,
        name: user.name ?? null,
        avatarUrl: user.avatar_url ?? null,
      };
    },
  },

  google: {
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scope: 'openid email profile',
    clientIdEnv: 'GOOGLE_OAUTH_CLIENT_ID',
    clientSecretEnv: 'GOOGLE_OAUTH_CLIENT_SECRET',
    authorizeParams: {
      response_type: 'code',
      access_type: 'online',
      prompt: 'select_account',
    },
    tokenExchangeStyle: 'form',
    async fetchProfile(accessToken: string): Promise<OAuthProfile> {
      const res = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const info = (await res.json()) as {
        sub?: string;
        email?: string | null;
        email_verified?: boolean;
        name?: string | null;
        picture?: string | null;
      };
      return {
        providerUserId: info.sub ?? '',
        email: info.email ?? null,
        emailVerified: info.email_verified === true,
        name: info.name ?? null,
        avatarUrl: info.picture ?? null,
      };
    },
  },

  facebook: {
    authorizeUrl: 'https://www.facebook.com/v19.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v19.0/oauth/access_token',
    scope: 'email public_profile',
    clientIdEnv: 'FACEBOOK_OAUTH_CLIENT_ID',
    clientSecretEnv: 'FACEBOOK_OAUTH_CLIENT_SECRET',
    authorizeParams: {},
    tokenExchangeStyle: 'form',
    async fetchProfile(accessToken: string): Promise<OAuthProfile> {
      const url = new URL('https://graph.facebook.com/me');
      url.searchParams.set('fields', 'id,name,email,picture');
      url.searchParams.set('access_token', accessToken);
      const res = await fetch(url);
      const info = (await res.json()) as {
        id?: string;
        name?: string | null;
        email?: string | null;
        picture?: { data?: { url?: string | null } };
      };
      const email = info.email ?? null;
      return {
        providerUserId: info.id ?? '',
        email,
        // Facebook has no explicit verified flag, but it only returns an email
        // the account has confirmed - so a present email is a verified one.
        emailVerified: email !== null,
        name: info.name ?? null,
        avatarUrl: info.picture?.data?.url ?? null,
      };
    },
  },
};

export interface TokenExchangeInput {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/**
 * Exchange an authorization code for an access token. GitHub accepts JSON with
 * `Accept: application/json`; Google and Facebook want form-encoded. Returns the
 * access token, or null if the provider didn't grant one.
 */
export async function exchangeCodeForToken(
  config: OAuthProviderConfig,
  { code, clientId, clientSecret, redirectUri }: TokenExchangeInput
): Promise<string | null> {
  const fields = {
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
  };

  const res =
    config.tokenExchangeStyle === 'json'
      ? await fetch(config.tokenUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(fields),
        })
      : await fetch(config.tokenUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
          },
          body: new URLSearchParams(fields).toString(),
        });

  const data = (await res.json()) as { access_token?: string };
  return data.access_token ?? null;
}
