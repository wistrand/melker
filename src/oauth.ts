// OAuth2 Authorization Code Flow with PKCE
// Provides authentication for Melker applications with token persistence

import { getLogger } from './logging.ts';
import { MelkerConfig } from './config/mod.ts';

// Re-export types
export type {
  OAuthConfig,
  OAuthTokens,
  WellKnownConfig,
  StoredToken,
  TokenStorage,
  OAuthCallback,
  OAuthErrorCallback,
  InitOptions,
  AuthenticateOptions,
  CallbackServerOptions,
  CallbackResult,
  JwtClaims,
  DecodedJwt,
  DecodedTokens,
} from './oauth/types.ts';

// Re-export PKCE utilities
export {
  generateCodeVerifier,
  generateCodeChallenge,
  generateState,
} from './oauth/pkce.ts';

// Re-export token storage
export {
  OAuthTokenStore,
  storedTokenToOAuthTokens,
} from './oauth/token-storage.ts';

// Re-export callback server
export { OAuthCallbackServer } from './oauth/callback-server.ts';

// Re-export token exchange functions
export {
  exchangeCodeForTokens,
  refreshAccessToken,
} from './oauth/token-exchange.ts';

// Re-export JWT utilities
export {
  decodeToken,
  decodeTokenSafe,
  decodeOAuthTokens,
  formatTimestamp,
  isTokenExpired,
  getTokenExpiryInfo,
  formatAudience,
  formatTokensAsMarkdown,
} from './oauth/jwt.ts';

// Re-export well-known discovery
export {
  fetchWellKnownConfig,
  clearWellKnownCache,
} from './oauth/well-known.ts';

// Re-export browser utilities
export {
  openBrowser,
  parsePort,
  parsePath,
  buildAuthorizationUrl,
} from './oauth/browser.ts';

// Re-export config utilities
export { getOAuthConfigFromEnv } from './oauth/config.ts';

// Import for internal use
import type {
  OAuthConfig,
  OAuthTokens,
  OAuthCallback,
  OAuthErrorCallback,
  InitOptions,
  AuthenticateOptions,
} from './oauth/types.ts';

import { generateCodeVerifier, generateCodeChallenge, generateState } from './oauth/pkce.ts';
import { OAuthTokenStore, storedTokenToOAuthTokens } from './oauth/token-storage.ts';
import { OAuthCallbackServer } from './oauth/callback-server.ts';
import { exchangeCodeForTokens, refreshAccessToken } from './oauth/token-exchange.ts';
import { formatTokensAsMarkdown } from './oauth/jwt.ts';
import { fetchWellKnownConfig } from './oauth/well-known.ts';
import { openBrowser, parsePort, parsePath, buildAuthorizationUrl } from './oauth/browser.ts';
import { getOAuthConfigFromEnv } from './oauth/config.ts';

// Module logger
const logger = getLogger('oauth');

// Track active callback server for cleanup
let _activeCallbackServer: OAuthCallbackServer | null = null;

/**
 * Stop any active callback server
 */
export async function stopCallbackServer(): Promise<void> {
  if (_activeCallbackServer) {
    logger.debug('Stopping active callback server');
    await _activeCallbackServer.stop();
    _activeCallbackServer = null;
  }
}

// =============================================================================
// OAUTH CLIENT CLASS
// =============================================================================

/**
 * OAuth client for managing authentication state.
 * Supports multiple instances for multi-tenant scenarios.
 */
export class OAuthClient {
  private _config: OAuthConfig | null = null;
  private _tokens: OAuthTokens | null = null;
  private _initialized = false;
  private _onLogin: OAuthCallback | undefined;
  private _onLogout: OAuthCallback | undefined;
  private _onFail: OAuthErrorCallback | undefined;

  /**
   * Register callback for login events
   */
  onLoginEvent(callback: OAuthCallback): void {
    this._onLogin = callback;
    if (this._tokens) {
      callback();
    }
  }

  /**
   * Register callback for logout events
   */
  onLogoutEvent(callback: OAuthCallback): void {
    this._onLogout = callback;
  }

  /**
   * Register callback for error events
   */
  onFailEvent(callback: OAuthErrorCallback): void {
    this._onFail = callback;
  }

  /**
   * Initialize OAuth from provided config or environment variables
   */
  async init(options?: InitOptions): Promise<boolean> {
    logger.info('Initializing OAuth', { wellknown: options?.wellknown, clientId: options?.clientId, autoLogin: options?.autoLogin });

    if (options?.onLogin) this._onLogin = options.onLogin;
    if (options?.onLogout) this._onLogout = options.onLogout;
    if (options?.onFail) this._onFail = options.onFail;

    const melkerConfig = MelkerConfig.get();
    const wellknownUrl = options?.wellknown || melkerConfig.oauthWellknownUrl;
    if (!wellknownUrl || wellknownUrl.trim() === '' || wellknownUrl.startsWith('$')) {
      this._config = null;
      this._initialized = false;
      const error = new Error('OAuth wellknown URL not configured. Set oauth.wellknownUrl in config or provide wellknown option.');
      logger.error('OAuth init failed: wellknown URL is empty or not configured');
      this._onFail?.(error);
      throw error;
    }

    try {
      if (options?.wellknown) {
        const port = melkerConfig.oauthPort;
        const path = melkerConfig.oauthPath;
        const defaultScopes = ['openid'];

        this._config = {
          wellKnownUrl: options.wellknown,
          clientId: options.clientId || melkerConfig.oauthClientId,
          redirectUri: options.redirectUri || melkerConfig.oauthRedirectUri || `http://localhost:${port}${path}`,
          scopes: options.scopes?.split(' ') || melkerConfig.oauthScopes.split(' ') || defaultScopes,
          audience: options.audience || melkerConfig.oauthAudience,
          debugServer: options.debugServer,
        };
        logger.info('OAuth config from options ', { clientId: this._config.clientId, redirectUri: this._config.redirectUri , scopes : this._config.scopes});
      } else {
        this._config = getOAuthConfigFromEnv();
        logger.debug('OAuth config from MelkerConfig');
      }
    } catch (e) {
      this._config = null;
      this._initialized = false;
      const error = new Error('Missing: oauth.wellknownUrl');
      logger.error('OAuth init failed: missing wellknown URL ' + e);
      this._onFail?.(error);
      throw error;
    }

    this._initialized = true;

    try {
      const alreadyLoggedIn = await isLoggedIn(this._config);
      if (alreadyLoggedIn) {
        logger.info('Found existing valid token');
        this._tokens = await getCurrentToken(this._config);
        this._onLogin?.();
        return true;
      }
      logger.debug('No existing valid token found');
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.error('Error checking existing token', error);
      this._onFail?.(error);
      throw error;
    }

    this._tokens = null;

    if (options?.autoLogin) {
      logger.info('Starting auto-login');
      try {
        this._tokens = await authenticateWithPKCE(this._config);
        logger.info('Auto-login successful');
        this._onLogin?.();
        return true;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        logger.warn('Auto-login failed', { error: error.message });
        this._onFail?.(error);
        return false;
      }
    }

    return false;
  }

  /**
   * Check if OAuth is initialized
   */
  isInitialized(): boolean {
    return this._initialized && this._config !== null;
  }

  /**
   * Perform login via browser-based PKCE flow
   */
  async login(): Promise<OAuthTokens> {
    logger.info('Starting login');
    if (!this._config) {
      const error = new Error('OAuth not initialized - call init() first');
      logger.error('Login failed: not initialized');
      this._onFail?.(error);
      throw error;
    }
    try {
      this._tokens = await authenticateWithPKCE(this._config);
      logger.info('Login successful');
      this._onLogin?.();
      return this._tokens;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.error('Login failed', error);
      this._onFail?.(error);
      throw error;
    }
  }

  /**
   * Refresh the access token using the refresh token
   */
  async refresh(): Promise<OAuthTokens> {
    logger.info('Starting token refresh');
    if (!this._config) {
      const error = new Error('OAuth not initialized - call init() first');
      logger.error('Refresh failed: not initialized');
      this._onFail?.(error);
      throw error;
    }
    try {
      this._tokens = await authenticateWithPKCE(this._config);
      logger.info('Token refresh successful');
      this._onLogin?.();
      return this._tokens;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.error('Token refresh failed', error);
      this._onFail?.(error);
      throw error;
    }
  }

  /**
   * Logout and clear stored tokens
   */
  async logout(): Promise<void> {
    logger.info('Starting logout');
    try {
      if (this._config) {
        await logoutWithConfig(this._config);
      }
      this._tokens = null;
      logger.info('Logout successful');
      this._onLogout?.();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.error('Logout failed', error);
      this._onFail?.(error);
      throw error;
    }
  }

  /**
   * Get current tokens (may be null if not logged in)
   */
  getTokens(): OAuthTokens | null {
    return this._tokens;
  }

  /**
   * Check if the current token is expired
   */
  isTokenExpiredNow(): boolean {
    if (!this._tokens || !this._tokens.expiresAt) {
      return false;
    }
    const buffer = 60 * 1000;
    return Date.now() >= (this._tokens.expiresAt - buffer);
  }

  /**
   * Ensure we have a valid (non-expired) token
   */
  async ensureValidToken(): Promise<OAuthTokens | null> {
    if (!this._config) {
      return null;
    }

    if (this._tokens && !this.isTokenExpiredNow()) {
      return this._tokens;
    }

    try {
      this._tokens = await authenticateWithPKCE(this._config);
      this._onLogin?.();
      return this._tokens;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this._onFail?.(error);
      this._tokens = null;
      return null;
    }
  }

  /**
   * Get current config (may be null if not initialized)
   */
  getConfig(): OAuthConfig | null {
    return this._config;
  }

  /**
   * Check if we have a refresh token available
   */
  hasRefreshToken(): boolean {
    return !!this._tokens?.refreshToken;
  }

  /**
   * Get formatted markdown for current tokens
   */
  getTokensMarkdown(): string {
    return formatTokensAsMarkdown(this._tokens);
  }
}

// =============================================================================
// DEFAULT INSTANCE (for backwards compatibility)
// =============================================================================

const _defaultClient = new OAuthClient();

/**
 * Register callback for login events (called when user logs in or is already logged in)
 */
export function onLoginEvent(callback: OAuthCallback): void {
  _defaultClient.onLoginEvent(callback);
}

/**
 * Register callback for logout events
 */
export function onLogoutEvent(callback: OAuthCallback): void {
  _defaultClient.onLogoutEvent(callback);
}

/**
 * Register callback for error events
 */
export function onFailEvent(callback: OAuthErrorCallback): void {
  _defaultClient.onFailEvent(callback);
}

/**
 * Initialize OAuth from provided config or environment variables
 */
export async function init(options?: InitOptions): Promise<boolean> {
  return _defaultClient.init(options);
}

/**
 * Check if OAuth is initialized
 */
export function isInitialized(): boolean {
  return _defaultClient.isInitialized();
}

/**
 * Perform login via browser-based PKCE flow
 */
export async function login(): Promise<OAuthTokens> {
  return _defaultClient.login();
}

/**
 * Refresh the access token using the refresh token
 */
export async function refresh(): Promise<OAuthTokens> {
  return _defaultClient.refresh();
}

/**
 * Logout and clear stored tokens
 */
export async function logoutSession(): Promise<void> {
  return _defaultClient.logout();
}

/**
 * Get current tokens (may be null if not logged in)
 */
export function getTokens(): OAuthTokens | null {
  return _defaultClient.getTokens();
}

/**
 * Check if the current token is expired
 */
export function isTokenExpiredNow(): boolean {
  return _defaultClient.isTokenExpiredNow();
}

/**
 * Ensure we have a valid (non-expired) token
 */
export async function ensureValidToken(): Promise<OAuthTokens | null> {
  return _defaultClient.ensureValidToken();
}

/**
 * Get current config (may be null if not initialized)
 */
export function getConfig(): OAuthConfig | null {
  return _defaultClient.getConfig();
}

/**
 * Check if we have a refresh token available
 */
export function hasRefreshToken(): boolean {
  return _defaultClient.hasRefreshToken();
}

/**
 * Get formatted markdown for current tokens
 */
export function getTokensMarkdown(): string {
  return _defaultClient.getTokensMarkdown();
}

/**
 * Get the default OAuth client instance
 */
export function getDefaultClient(): OAuthClient {
  return _defaultClient;
}

// =============================================================================
// STATELESS UTILITY FUNCTIONS
// =============================================================================

/**
 * Authenticate using OAuth2 PKCE flow
 */
export async function authenticateWithPKCE(
  config: OAuthConfig,
  options?: AuthenticateOptions
): Promise<OAuthTokens> {
  logger.info('Starting PKCE authentication flow');
  const tokenStore = new OAuthTokenStore();

  if (!options?.forceLogin) {
    const storedToken = await tokenStore.getToken(config.wellKnownUrl, config.clientId);

    if (storedToken) {
      if (!tokenStore.isExpired(storedToken)) {
        logger.debug('Using existing valid token from storage');
        return storedTokenToOAuthTokens(storedToken);
      }

      if (tokenStore.canRefresh(storedToken) && !options?.skipRefresh) {
        logger.debug('Token expired, attempting refresh');
        try {
          const wellKnown = await fetchWellKnownConfig(config.wellKnownUrl);
          const newTokens = await refreshAccessToken(
            wellKnown.token_endpoint,
            storedToken.refreshToken!,
            config.clientId
          );

          await tokenStore.storeToken(config.wellKnownUrl, config.clientId, newTokens);
          logger.info('Token refreshed successfully');
          return newTokens;
        } catch (err) {
          logger.warn('Token refresh failed, falling back to interactive login', { error: err instanceof Error ? err.message : String(err) });
        }
      }
    }
  }

  logger.debug('Fetching well-known configuration');
  const wellKnown = await fetchWellKnownConfig(config.wellKnownUrl);

  logger.debug('Generating PKCE codes');
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);

  const port = parsePort(config.redirectUri);
  const path = parsePath(config.redirectUri);
  const keepAlive = config.debugServer ?? true;

  // Stop any existing callback server before starting a new one
  await stopCallbackServer();

  logger.info('Starting callback server', { port, path, keepAlive });
  const callbackServer = new OAuthCallbackServer({ port, path, keepAlive });
  await callbackServer.start();

  // Track for later cleanup
  _activeCallbackServer = callbackServer;

  try {
    const state = generateState();
    const scopes = config.scopes?.join(' ') || 'openid profile offline_access';

    const authParams: Record<string, string> = {
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: 'code',
      scope: scopes,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
    };

    if (config.audience) {
      authParams.audience = config.audience;
    }

    const authUrl = buildAuthorizationUrl(wellKnown.authorization_endpoint, authParams);

    logger.info('Opening browser for authentication');
    await openBrowser(authUrl);

    logger.debug('Waiting for authorization callback');
    const result = await callbackServer.waitForCode();
    logger.debug('Received authorization callback');

    if (result.state !== state) {
      logger.error('State mismatch detected');
      throw new Error('State mismatch - possible CSRF attack');
    }

    logger.debug('Exchanging code for tokens');
    const tokens = await exchangeCodeForTokens(
      wellKnown.token_endpoint,
      result.code,
      codeVerifier,
      config.clientId,
      config.redirectUri
    );

    logger.debug('Storing tokens');
    await tokenStore.storeToken(config.wellKnownUrl, config.clientId, tokens);

    logger.info('PKCE authentication flow completed successfully');
    return tokens;
  } finally {
    if (callbackServer.keepAlive) {
      logger.info('Callback server kept alive for debugging (debugServer: true)');
    } else {
      logger.debug('Stopping callback server');
      await callbackServer.stop();
      _activeCallbackServer = null;
    }
  }
}

/**
 * Logout - remove stored token (stateless version)
 */
export async function logout(config: OAuthConfig): Promise<void> {
  await logoutWithConfig(config);
}

/**
 * Internal logout with config
 */
async function logoutWithConfig(config: OAuthConfig): Promise<void> {
  // Stop any active callback server
  await stopCallbackServer();

  logger.debug('Removing stored token');
  const tokenStore = new OAuthTokenStore();
  await tokenStore.removeToken(config.wellKnownUrl, config.clientId);
  logger.debug('Token removed from storage');
}

/**
 * Check if user is logged in (valid token exists)
 */
export async function isLoggedIn(config: OAuthConfig): Promise<boolean> {
  const tokenStore = new OAuthTokenStore();
  const token = await tokenStore.getToken(config.wellKnownUrl, config.clientId);

  if (!token) {
    return false;
  }

  return !tokenStore.isExpired(token);
}

/**
 * Get current token without triggering login
 */
export async function getCurrentToken(config: OAuthConfig): Promise<OAuthTokens | null> {
  const tokenStore = new OAuthTokenStore();
  const token = await tokenStore.getToken(config.wellKnownUrl, config.clientId);

  if (!token) {
    return null;
  }

  return storedTokenToOAuthTokens(token);
}
