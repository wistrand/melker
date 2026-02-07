// JWT token decoding and formatting utilities

import { decodeJwt } from '../deps.ts';
import type { OAuthTokens, JwtClaims, DecodedJwt, DecodedTokens } from './types.ts';

/**
 * Decode a JWT token without verification
 * NOTE: This does NOT verify the token signature - do not use for security decisions
 */
export function decodeToken(token: string): DecodedJwt {
  const [header, payload, signature] = decodeJwt(token);

  return {
    header: header as DecodedJwt['header'],
    payload: payload as JwtClaims,
    signature,
  };
}

/**
 * Safely decode a JWT token, returning null on error instead of throwing
 */
export function decodeTokenSafe(token: string): DecodedJwt | null {
  try {
    return decodeToken(token);
  } catch {
    return null;
  }
}

/**
 * Decode all tokens from an OAuthTokens response
 */
export function decodeOAuthTokens(tokens: OAuthTokens): DecodedTokens {
  const result: DecodedTokens = {};

  if (tokens.accessToken) {
    try {
      result.accessToken = decodeToken(tokens.accessToken);
    } catch (error) {
      result.accessTokenError = error instanceof Error ? error.message : 'Failed to decode access token';
    }
  }

  if (tokens.idToken) {
    try {
      result.idToken = decodeToken(tokens.idToken);
    } catch (error) {
      result.idTokenError = error instanceof Error ? error.message : 'Failed to decode ID token';
    }
  }

  return result;
}

/**
 * Format a Unix timestamp as a human-readable date string
 */
export function formatTimestamp(timestamp?: number): string {
  if (!timestamp) return 'N/A';
  return new Date(timestamp * 1000).toLocaleString();
}

/**
 * Check if a token is expired based on its exp claim
 */
export function isTokenExpired(claims: JwtClaims): boolean {
  if (!claims.exp) return false;
  const now = Math.floor(Date.now() / 1000);
  return claims.exp < now;
}

/**
 * Get the remaining time until token expiration in a human-readable format
 */
export function getTokenExpiryInfo(claims: JwtClaims): string {
  if (!claims.exp) return 'No expiration';

  const now = Math.floor(Date.now() / 1000);
  const remaining = claims.exp - now;

  if (remaining < 0) {
    const ago = Math.abs(remaining);
    if (ago < 60) return `Expired ${ago}s ago`;
    if (ago < 3600) return `Expired ${Math.floor(ago / 60)}m ago`;
    if (ago < 86400) return `Expired ${Math.floor(ago / 3600)}h ago`;
    return `Expired ${Math.floor(ago / 86400)}d ago`;
  }

  if (remaining < 60) return `Expires in ${remaining}s`;
  if (remaining < 3600) return `Expires in ${Math.floor(remaining / 60)}m`;
  if (remaining < 86400) return `Expires in ${Math.floor(remaining / 3600)}h`;
  return `Expires in ${Math.floor(remaining / 86400)}d`;
}

/**
 * Format audience claim (can be string or array)
 */
export function formatAudience(aud?: string | string[]): string {
  if (!aud) return 'N/A';
  if (Array.isArray(aud)) return aud.join(', ');
  return aud;
}

/**
 * Format OAuth tokens as markdown for display
 */
export function formatTokensAsMarkdown(tokens: OAuthTokens | null): string {
  if (!tokens) {
    return '*No token information available*';
  }

  const decoded = decodeOAuthTokens(tokens);
  const accessClaims = decoded.accessToken?.payload;
  const idClaims = decoded.idToken?.payload;

  let md = '## Access Token\n\n';

  if (accessClaims) {
    md += '| Claim | Value |\n';
    md += '|-------|-------|\n';
    md += '| **Subject** | `' + (accessClaims.sub || 'N/A') + '` |\n';
    md += '| **Audience** | ' + formatAudience(accessClaims.aud) + ' |\n';
    md += '| **Scope** | ' + (accessClaims.scope || tokens.scope || 'N/A') + ' |\n';
    md += '| **Expiry** | ' + getTokenExpiryInfo(accessClaims) + ' |\n';
    md += '| **Issuer** | ' + (accessClaims.iss || 'N/A') + ' |\n';
    if (accessClaims.client_id || accessClaims.azp) {
      md += '| **Client ID** | ' + (accessClaims.client_id || accessClaims.azp) + ' |\n';
    }
  } else if (decoded.accessTokenError) {
    md += '> **Error:** ' + decoded.accessTokenError + '\n\n';
    md += '| Claim | Value |\n';
    md += '|-------|-------|\n';
    md += '| **Scope** | ' + (tokens.scope || 'N/A') + ' |\n';
    md += '| **Expiry** | ' + (tokens.expiresAt ? new Date(tokens.expiresAt).toLocaleString() : 'N/A') + ' |\n';
  } else {
    md += '*Opaque token (not a JWT)*\n\n';
    md += '| Claim | Value |\n';
    md += '|-------|-------|\n';
    md += '| **Scope** | ' + (tokens.scope || 'N/A') + ' |\n';
    md += '| **Expiry** | ' + (tokens.expiresAt ? new Date(tokens.expiresAt).toLocaleString() : 'N/A') + ' |\n';
  }

  if (tokens.idToken) {
    md += '\n## ID Token\n\n';
    if (idClaims) {
      md += '| Claim | Value |\n';
      md += '|-------|-------|\n';
      if (idClaims.name) md += '| **Name** | ' + idClaims.name + ' |\n';
      if (idClaims.given_name) md += '| **Given Name** | ' + idClaims.given_name + ' |\n';
      if (idClaims.family_name) md += '| **Family Name** | ' + idClaims.family_name + ' |\n';
      if (idClaims.email) md += '| **Email** | ' + idClaims.email + (idClaims.email_verified ? ' (verified)' : '') + ' |\n';
      if (idClaims.locale) md += '| **Locale** | ' + idClaims.locale + ' |\n';
      if (idClaims.sub) md += '| **Subject** | `' + idClaims.sub + '` |\n';
    } else if (decoded.idTokenError) {
      md += '> **Error:** ' + decoded.idTokenError + '\n';
    }
  }

  md += '\n## Session\n\n';
  md += '- **Refresh Token:** ' + (tokens.refreshToken ? 'Available' : 'None') + '\n';
  md += '- **Token Type:** ' + (tokens.tokenType || 'Bearer') + '\n';

  md += '\n## Decoded JSON\n\n';
  if (accessClaims) {
    md += '### Access Token Claims\n\n';
    md += '```json\n' + JSON.stringify(accessClaims, null, 2) + '\n```\n\n';
  }
  if (idClaims) {
    md += '### ID Token Claims\n\n';
    md += '```json\n' + JSON.stringify(idClaims, null, 2) + '\n```\n';
  }

  return md;
}
