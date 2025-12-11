// OAuth token storage using system keyring

import type { OAuthTokens, StoredToken, TokenStorage } from './types.ts';
import { Keyring } from '../keyring.ts';

const KEYRING_KEY = 'oauth_tokens';


/*
  # List all secrets for melker service
  secret-tool search service melker

  # Get the oauth_tokens value directly
  secret-tool lookup service melker key oauth_tokens

  # Pretty-print the JSON
  secret-tool lookup service melker key oauth_tokens | jq .

  # Delete the stored tokens
  secret-tool clear service melker key oauth_tokens

  On macOS (Keychain):
  # Get value
  security find-generic-password -s melker -a oauth_tokens -w

  # Delete
  security delete-generic-password -s melker -a oauth_tokens
 */

/**
 * Convert stored token to OAuthTokens format
 */
export function storedTokenToOAuthTokens(stored: StoredToken): OAuthTokens {
  return {
    accessToken: stored.accessToken,
    tokenType: stored.tokenType,
    expiresAt: stored.expiresAt,
    refreshToken: stored.refreshToken,
    idToken: stored.idToken,
    scope: stored.scope,
  };
}

/**
 * Token storage class for persisting OAuth tokens in system keyring
 */
export class OAuthTokenStore {
  private keyring: Keyring;

  constructor() {
    this.keyring = new Keyring('melker');
  }

  /**
   * Generate unique key for IDP+client combination
   */
  static getIdpKey(wellKnownUrl: string, clientId: string): string {
    const combined = `${wellKnownUrl}:${clientId}`;
    const encoder = new TextEncoder();
    const data = encoder.encode(combined);
    let hash = 0;
    for (const byte of data) {
      hash = ((hash << 5) - hash) + byte;
      hash = hash & hash;
    }
    return `idp_${Math.abs(hash).toString(16)}`;
  }

  /**
   * Load all tokens from keyring
   */
  async loadTokens(): Promise<TokenStorage> {
    try {
      const content = await this.keyring.get(KEYRING_KEY);
      if (!content) {
        return {};
      }
      return JSON.parse(content) as TokenStorage;
    } catch {
      return {};
    }
  }

  /**
   * Save tokens to keyring
   */
  async saveTokens(storage: TokenStorage): Promise<void> {
    const content = JSON.stringify(storage);
    await this.keyring.set(KEYRING_KEY, content);
  }

  /**
   * Get token for specific IDP
   */
  async getToken(wellKnownUrl: string, clientId: string): Promise<StoredToken | null> {
    const storage = await this.loadTokens();
    const key = OAuthTokenStore.getIdpKey(wellKnownUrl, clientId);
    return storage[key] || null;
  }

  /**
   * Store token for specific IDP
   */
  async storeToken(wellKnownUrl: string, clientId: string, tokens: OAuthTokens): Promise<void> {
    const storage = await this.loadTokens();
    const key = OAuthTokenStore.getIdpKey(wellKnownUrl, clientId);

    const now = Date.now();
    const storedToken: StoredToken = {
      accessToken: tokens.accessToken,
      tokenType: tokens.tokenType,
      expiresAt: tokens.expiresAt || (tokens.expiresIn ? now + tokens.expiresIn * 1000 : undefined),
      refreshToken: tokens.refreshToken,
      idToken: tokens.idToken,
      scope: tokens.scope,
      issuedAt: now,
    };

    storage[key] = storedToken;
    await this.saveTokens(storage);
  }

  /**
   * Remove token for specific IDP
   */
  async removeToken(wellKnownUrl: string, clientId: string): Promise<void> {
    const storage = await this.loadTokens();
    const key = OAuthTokenStore.getIdpKey(wellKnownUrl, clientId);
    delete storage[key];

    // If no tokens left, delete the keyring entry entirely
    if (Object.keys(storage).length === 0) {
      await this.keyring.delete(KEYRING_KEY);
    } else {
      await this.saveTokens(storage);
    }
  }

  /**
   * Clear all stored tokens
   */
  async clearAll(): Promise<void> {
    await this.keyring.delete(KEYRING_KEY);
  }

  /**
   * Check if token is expired (with 60s buffer)
   */
  isExpired(token: StoredToken): boolean {
    if (!token.expiresAt) {
      return false;
    }
    const buffer = 60 * 1000;
    return Date.now() >= (token.expiresAt - buffer);
  }

  /**
   * Check if token can be refreshed
   */
  canRefresh(token: StoredToken): boolean {
    return !!token.refreshToken;
  }
}
