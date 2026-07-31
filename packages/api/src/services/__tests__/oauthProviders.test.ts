import { describe, it, expect, vi, afterEach } from 'vitest';
import { oauthProviders, exchangeCodeForToken } from '../oauthProviders.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Stub global.fetch with a router keyed on the request URL substring. */
function stubFetch(routes: Record<string, unknown>) {
  vi.spyOn(global, 'fetch').mockImplementation(async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const match = Object.keys(routes).find((key) => url.includes(key));
    const body = match ? routes[match] : {};
    return new Response(JSON.stringify(body), { status: 200 });
  });
}

describe('oauthProviders.fetchProfile', () => {
  describe('github', () => {
    it('normalizes /user + /user/emails to the common profile shape', async () => {
      stubFetch({
        'api.github.com/user/emails': [
          { email: 'secondary@example.com', primary: false, verified: true },
          { email: 'octocat@example.com', primary: true, verified: true },
        ],
        'api.github.com/user': {
          login: 'octocat',
          name: 'The Octocat',
          avatar_url: 'https://avatars.example/octo.png',
        },
      });

      const profile = await oauthProviders.github.fetchProfile('gh-token');
      expect(profile).toEqual({
        providerUserId: 'octocat',
        email: 'octocat@example.com',
        emailVerified: true,
        name: 'The Octocat',
        avatarUrl: 'https://avatars.example/octo.png',
      });
    });

    it('reports emailVerified=false when GitHub shares no verified email', async () => {
      stubFetch({
        'api.github.com/user/emails': [
          { email: 'unverified@example.com', primary: true, verified: false },
        ],
        'api.github.com/user': { login: 'noverify', name: null, avatar_url: null },
      });

      const profile = await oauthProviders.github.fetchProfile('gh-token');
      expect(profile.providerUserId).toBe('noverify');
      expect(profile.email).toBeNull();
      expect(profile.emailVerified).toBe(false);
    });
  });

  describe('google', () => {
    it('maps sub/email_verified/picture from the OIDC userinfo endpoint', async () => {
      stubFetch({
        'openidconnect.googleapis.com/v1/userinfo': {
          sub: '1234567890',
          email: 'ada@gmail.com',
          email_verified: true,
          name: 'Ada Lovelace',
          picture: 'https://lh3.example/ada.png',
        },
      });

      const profile = await oauthProviders.google.fetchProfile('goog-token');
      expect(profile).toEqual({
        providerUserId: '1234567890',
        email: 'ada@gmail.com',
        emailVerified: true,
        name: 'Ada Lovelace',
        avatarUrl: 'https://lh3.example/ada.png',
      });
    });

    it('carries emailVerified=false through when Google says email_verified=false', async () => {
      stubFetch({
        'openidconnect.googleapis.com/v1/userinfo': {
          sub: 'unverified-sub',
          email: 'maybe@gmail.com',
          email_verified: false,
          name: 'Maybe Verified',
          picture: null,
        },
      });

      const profile = await oauthProviders.google.fetchProfile('goog-token');
      expect(profile.providerUserId).toBe('unverified-sub');
      expect(profile.email).toBe('maybe@gmail.com');
      expect(profile.emailVerified).toBe(false);
    });
  });

  describe('facebook', () => {
    it('maps id/name/email/picture from the graph endpoint', async () => {
      stubFetch({
        'graph.facebook.com/me': {
          id: 'fb-9999',
          name: 'Grace Hopper',
          email: 'grace@fb.example',
          picture: { data: { url: 'https://graph.example/grace.png' } },
        },
      });

      const profile = await oauthProviders.facebook.fetchProfile('fb-token');
      expect(profile).toEqual({
        providerUserId: 'fb-9999',
        email: 'grace@fb.example',
        emailVerified: true, // Facebook only returns a confirmed email
        avatarUrl: 'https://graph.example/grace.png',
        name: 'Grace Hopper',
      });
    });

    it('treats a missing email as unverified (emailVerified=false)', async () => {
      stubFetch({
        'graph.facebook.com/me': { id: 'fb-noemail', name: 'No Email' },
      });

      const profile = await oauthProviders.facebook.fetchProfile('fb-token');
      expect(profile.providerUserId).toBe('fb-noemail');
      expect(profile.email).toBeNull();
      expect(profile.emailVerified).toBe(false);
      expect(profile.avatarUrl).toBeNull();
    });
  });
});

describe('exchangeCodeForToken', () => {
  it('reads access_token from a JSON exchange (github)', async () => {
    const spy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ access_token: 'gh-abc' }), { status: 200 }));

    const token = await exchangeCodeForToken(oauthProviders.github, {
      code: 'the-code',
      clientId: 'id',
      clientSecret: 'secret',
      redirectUri: 'https://app.example/api/auth/callback/github',
    });

    expect(token).toBe('gh-abc');
    const [, init] = spy.mock.calls[0];
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>)['Content-Type']).toContain('application/json');
  });

  it('reads access_token from a form-encoded exchange (google)', async () => {
    const spy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ access_token: 'goog-xyz' }), { status: 200 }));

    const token = await exchangeCodeForToken(oauthProviders.google, {
      code: 'the-code',
      clientId: 'id',
      clientSecret: 'secret',
      redirectUri: 'https://app.example/api/auth/callback/google',
    });

    expect(token).toBe('goog-xyz');
    const [, init] = spy.mock.calls[0];
    expect((init?.headers as Record<string, string>)['Content-Type']).toContain(
      'application/x-www-form-urlencoded'
    );
  });

  it('returns null when no access_token is granted', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'bad_verification_code' }), { status: 200 })
    );
    const token = await exchangeCodeForToken(oauthProviders.github, {
      code: 'x',
      clientId: 'id',
      clientSecret: 'secret',
      redirectUri: 'https://app.example/api/auth/callback/github',
    });
    expect(token).toBeNull();
  });
});
