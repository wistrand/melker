// OAuth configuration from environment variables

import type { OAuthConfig } from './types.ts';

/**
 * Get OAuth config from environment variables
 *
 * Required:
 *   MELKER_OAUTH_WELLKNOWN_URL - IDP's .well-known/openid-configuration URL
 *
 * Optional:
 *   MELKER_OAUTH_CLIENT_ID     - OAuth2 client ID (default: melker-client)
 *   MELKER_OAUTH_REDIRECT_URI  - Callback URI (default: http://localhost:1900/melker/auth)
 *   MELKER_OAUTH_SCOPES        - Space-separated scopes (default: openid profile offline_access)
 *   MELKER_OAUTH_PORT          - Callback server port (default: 1900)
 *   MELKER_OAUTH_PATH          - Callback server path (default: /melker/auth)
 *   MELKER_OAUTH_AUDIENCE      - OAuth audience parameter
 */
export function getOAuthConfigFromEnv(): OAuthConfig {
  const wellKnownUrl = Deno.env.get('MELKER_OAUTH_WELLKNOWN_URL');
  const clientId = Deno.env.get('MELKER_OAUTH_CLIENT_ID') || 'melker-client';

  if (!wellKnownUrl) {
    throw new Error('MELKER_OAUTH_WELLKNOWN_URL environment variable is required');
  }

  const port = parseInt(Deno.env.get('MELKER_OAUTH_PORT') || '1900');
  const path = Deno.env.get('MELKER_OAUTH_PATH') || '/melker/auth';
  const redirectUri = Deno.env.get('MELKER_OAUTH_REDIRECT_URI') || `http://localhost:${port}${path}`;

  const scopesEnv = Deno.env.get('MELKER_OAUTH_SCOPES');
  const scopes = scopesEnv ? scopesEnv.split(' ') : ['openid', 'profile', 'offline_access'];

  const audience = Deno.env.get('MELKER_OAUTH_AUDIENCE');

  return {
    wellKnownUrl,
    clientId,
    redirectUri,
    scopes,
    audience,
  };
}
