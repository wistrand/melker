// OAuth configuration from MelkerConfig

import type { OAuthConfig } from './types.ts';
import { MelkerConfig } from '../config/mod.ts';

/**
 * Get OAuth config from MelkerConfig
 *
 * Required:
 *   oauth.wellknownUrl - IDP's .well-known/openid-configuration URL
 *
 * Optional:
 *   oauth.clientId     - OAuth2 client ID (default: melker-client)
 *   oauth.redirectUri  - Callback URI (default: http://localhost:1900/melker/auth)
 *   oauth.scopes       - Space-separated scopes (default: openid profile offline_access)
 *   oauth.port         - Callback server port (default: 1900)
 *   oauth.path         - Callback server path (default: /melker/auth)
 *   oauth.audience     - OAuth audience parameter
 */
export function getOAuthConfigFromEnv(): OAuthConfig {
  const config = MelkerConfig.get();
  const wellKnownUrl = config.oauthWellknownUrl;
  const clientId = config.oauthClientId;

  if (!wellKnownUrl) {
    throw new Error('oauth.wellknownUrl is required');
  }

  const port = config.oauthPort;
  const path = config.oauthPath;
  const redirectUri = config.oauthRedirectUri || `http://localhost:${port}${path}`;

  const scopesString = config.oauthScopes;
  const scopes = scopesString.split(' ');

  const audience = config.oauthAudience;

  return {
    wellKnownUrl,
    clientId,
    redirectUri,
    scopes,
    audience,
  };
}
