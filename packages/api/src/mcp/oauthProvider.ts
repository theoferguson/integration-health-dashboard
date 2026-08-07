/**
 * OAuth Authorization Server provider (ROADMAP #11, Phase 4)
 *
 * Implements the MCP SDK's `OAuthServerProvider` so `mcpAuthRouter` can expose a
 * real authorization server at /authorize, /token, /register and /revoke, plus
 * the discovery metadata Claude.ai and Claude Desktop read to offer a one-click
 * "Connect" button. This is what replaces "paste a read token" with "sign in
 * with your browser".
 *
 * Division of labour with the SDK: the router validates the client, the
 * redirect_uri (RFC 8252 loopback-port relaxation included) and the PKCE
 * parameters, and verifies the code_verifier against the challenge this file
 * returns. Everything stateful - who consented, to what, and which tokens exist
 * - lives here and in services/oauthStore.ts.
 *
 * THE SESSION BRIDGE: `authorize()` is handed `(client, params, res)` with no
 * `req`, so it can't see the browser session and can't know who the user is.
 * That's fine, because it shouldn't decide: it parks the request and redirects
 * to /oauth/consent, an ordinary route where the session cookie IS available and
 * where the user can sign in first if needed. Consent is what mints the code.
 */

import type { Response } from 'express';
import type {
  OAuthServerProvider,
  AuthorizationParams,
} from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type {
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import {
  InvalidGrantError,
  InvalidTokenError,
  InvalidTargetError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js';
import {
  getOAuthClient,
  registerOAuthClient,
  createPendingAuthorization,
  getAuthorizationCode,
  consumeAuthorizationCode,
  issueTokenPair,
  verifyOAuthToken,
  revokeOAuthToken,
} from '../services/oauthStore.js';

/** Where the browser is sent to sign in (if needed) and approve the connection. */
export const CONSENT_PATH = '/oauth/consent';

/** The single scope this server issues. Read-only is the whole product surface. */
export const MCP_SCOPE = 'mcp:read';

const clientsStore: OAuthRegisteredClientsStore = {
  getClient: (clientId) => getOAuthClient(clientId),
  registerClient: (client) => registerOAuthClient(client),
};

/**
 * Compare an RFC 8707 `resource` against what a grant was issued for. The spec
 * ignores the fragment, and a trailing slash is not a meaningful difference for
 * a resource identifier, so normalize both before comparing.
 */
function sameResource(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  const normalize = (value: string) => {
    try {
      const url = new URL(value);
      url.hash = '';
      return url.href.replace(/\/$/, '');
    } catch {
      return value;
    }
  };
  return normalize(a) === normalize(b);
}

export const ihdOAuthProvider: OAuthServerProvider = {
  get clientsStore() {
    return clientsStore;
  },

  /**
   * Park the authorization request and hand the browser to the consent page.
   * No code is minted here - there is no authenticated user yet.
   */
  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response
  ): Promise<void> {
    const pendingId = createPendingAuthorization({
      clientId: client.client_id,
      redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge,
      state: params.state,
      scope: params.scopes?.join(' '),
      resource: params.resource?.href,
    });
    res.redirect(302, `${CONSENT_PATH}?p=${encodeURIComponent(pendingId)}`);
  },

  /** The stored PKCE challenge; the SDK verifies the verifier against it. */
  async challengeForAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string
  ): Promise<string> {
    const record = getAuthorizationCode(authorizationCode);
    // Also enforces that the code belongs to the client presenting it, so one
    // client can't redeem a code issued to another.
    if (!record || record.clientId !== client.client_id) {
      throw new InvalidGrantError('Invalid or expired authorization code');
    }
    return record.codeChallenge;
  },

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier: string | undefined, // verified by the SDK before we're called
    redirectUri?: string,
    resource?: URL
  ): Promise<OAuthTokens> {
    // Consume FIRST: single-use is enforced by the atomic UPDATE, so a replayed
    // code fails here even if two exchanges race.
    const record = consumeAuthorizationCode(authorizationCode);
    if (!record || record.clientId !== client.client_id) {
      throw new InvalidGrantError('Invalid or expired authorization code');
    }
    // redirect_uri must match the one the code was issued against (OAuth 2.1).
    if (redirectUri !== undefined && redirectUri !== record.redirectUri) {
      throw new InvalidGrantError('redirect_uri does not match the authorization request');
    }
    // RFC 8707: a token must not be issued for an audience the user didn't
    // consent to, or the client could redeem it against a different server.
    if (!sameResource(resource?.href ?? null, record.resource)) {
      throw new InvalidTargetError('resource does not match the authorization request');
    }

    const { accessToken, refreshToken, expiresIn } = issueTokenPair({
      clientId: record.clientId,
      userId: record.userId,
      orgId: record.orgId,
      scope: record.scope,
      resource: record.resource,
    });

    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: expiresIn,
      refresh_token: refreshToken,
      scope: record.scope ?? MCP_SCOPE,
    };
  },

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[],
    resource?: URL
  ): Promise<OAuthTokens> {
    const record = verifyOAuthToken(refreshToken, 'refresh');
    if (!record || record.clientId !== client.client_id) {
      throw new InvalidGrantError('Invalid or revoked refresh token');
    }
    if (resource !== undefined && !sameResource(resource.href, record.resource)) {
      throw new InvalidTargetError('resource does not match the original grant');
    }
    // Never widen scope on refresh - a refresh can only ever re-mint what was
    // already granted.
    const requested = scopes?.join(' ');
    if (requested && requested !== record.scope) {
      throw new InvalidGrantError('Cannot change scope on refresh');
    }

    // ROTATE: the old refresh token dies with the new pair. If a leaked token is
    // used, the legitimate client's next refresh fails and the theft surfaces
    // instead of granting silent parallel access.
    revokeOAuthToken(refreshToken);

    const issued = issueTokenPair({
      clientId: record.clientId,
      userId: record.userId,
      orgId: record.orgId,
      scope: record.scope,
      resource: record.resource,
    });

    return {
      access_token: issued.accessToken,
      token_type: 'Bearer',
      expires_in: issued.expiresIn,
      refresh_token: issued.refreshToken,
      scope: record.scope ?? MCP_SCOPE,
    };
  },

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const record = verifyOAuthToken(token, 'access');
    if (!record) {
      throw new InvalidTokenError('Invalid or expired access token');
    }
    return {
      token,
      clientId: record.clientId,
      scopes: record.scope ? record.scope.split(' ') : [MCP_SCOPE],
      expiresAt: record.expiresAt ? Math.floor(record.expiresAt / 1000) : undefined,
      resource: record.resource ? new URL(record.resource) : undefined,
      // How the MCP auth boundary scopes tools to one org without re-querying.
      extra: { orgId: record.orgId, userId: record.userId },
    };
  },

  async revokeToken(
    _client: OAuthClientInformationFull,
    request: OAuthTokenRevocationRequest
  ): Promise<void> {
    // RFC 7009: revoking an unknown token is a success, not an error.
    revokeOAuthToken(request.token);
  },
};
