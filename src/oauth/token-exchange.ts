// OAuth token exchange functions

import type { OAuthTokens } from './types.ts';
import { getLogger } from '../logging.ts';

const logger = getLogger('oauth');

/**
 * Exchange authorization code for tokens
 */
export async function exchangeCodeForTokens(
  tokenEndpoint: string,
  code: string,
  codeVerifier: string,
  clientId: string,
  redirectUri: string
): Promise<OAuthTokens> {
  logger.debug('Exchanging authorization code for tokens');
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    code_verifier: codeVerifier,
    client_id: clientId,
    redirect_uri: redirectUri,
  });

  const response = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error('Token exchange failed', undefined, { status: response.status });
    throw new Error(`Token exchange failed: ${response.status} - ${errorBody}`);
  }

  const data = await response.json();
  logger.debug('Token exchange successful', { expiresIn: data.expires_in, hasRefreshToken: !!data.refresh_token });

  return {
    accessToken: data.access_token,
    tokenType: data.token_type || 'Bearer',
    expiresIn: data.expires_in,
    refreshToken: data.refresh_token,
    idToken: data.id_token,
    scope: data.scope,
  };
}

/**
 * Refresh access token using refresh token
 */
export async function refreshAccessToken(
  tokenEndpoint: string,
  refreshToken: string,
  clientId: string
): Promise<OAuthTokens> {
  logger.debug('Refreshing access token');
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
  });

  const response = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error('Token refresh request failed', undefined, { status: response.status });
    throw new Error(`Token refresh failed: ${response.status} - ${errorBody}`);
  }

  const data = await response.json();
  logger.debug('Token refresh request successful', { expiresIn: data.expires_in });

  return {
    accessToken: data.access_token,
    tokenType: data.token_type || 'Bearer',
    expiresIn: data.expires_in,
    refreshToken: data.refresh_token || refreshToken,
    idToken: data.id_token,
    scope: data.scope,
  };
}
