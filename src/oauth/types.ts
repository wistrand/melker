// OAuth type definitions

export interface OAuthConfig {
  wellKnownUrl: string;
  clientId: string;
  redirectUri: string;
  scopes?: string[];
  audience?: string;
  debugServer?: boolean;  // Keep callback server running for debugging
}

export interface OAuthTokens {
  accessToken: string;
  tokenType: string;
  expiresIn?: number;
  expiresAt?: number;
  refreshToken?: string;
  idToken?: string;
  scope?: string;
}

export interface WellKnownConfig {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint?: string;
  jwks_uri?: string;
  scopes_supported?: string[];
  response_types_supported?: string[];
  grant_types_supported?: string[];
}

export interface StoredToken {
  accessToken: string;
  tokenType: string;
  expiresAt?: number;
  refreshToken?: string;
  idToken?: string;
  scope?: string;
  issuedAt: number;
}

export interface TokenStorage {
  [idpKey: string]: StoredToken;
}

export type OAuthCallback = () => void;
export type OAuthErrorCallback = (error: Error) => void;

export interface InitOptions {
  wellknown?: string;
  clientId?: string;
  redirectUri?: string;
  scopes?: string;
  audience?: string;
  autoLogin?: boolean;
  debugServer?: boolean;
  onLogin?: OAuthCallback;
  onLogout?: OAuthCallback;
  onFail?: OAuthErrorCallback;
}

export interface AuthenticateOptions {
  forceLogin?: boolean;
  skipRefresh?: boolean;
}

export interface CallbackServerOptions {
  port?: number;
  host?: string;
  path?: string;
  timeout?: number;
  keepAlive?: boolean;  // Keep server running after callback for debugging
}

export interface CallbackResult {
  code: string;
  state: string;
}

// JWT types
export interface JwtClaims {
  // Standard claims
  iss?: string;
  sub?: string;
  aud?: string | string[];
  exp?: number;
  nbf?: number;
  iat?: number;
  jti?: string;

  // Common OAuth2/OIDC claims
  scope?: string;
  client_id?: string;
  azp?: string;

  // OIDC ID token claims
  nonce?: string;
  auth_time?: number;
  acr?: string;
  amr?: string[];

  // User info claims
  name?: string;
  given_name?: string;
  family_name?: string;
  email?: string;
  email_verified?: boolean;
  picture?: string;
  locale?: string;
  zoneinfo?: string;

  // Allow any additional custom claims
  [key: string]: unknown;
}

export interface DecodedJwt {
  header: {
    alg: string;
    typ?: string;
    kid?: string;
    [key: string]: unknown;
  };
  payload: JwtClaims;
  signature: Uint8Array;
}

export interface DecodedTokens {
  accessToken?: DecodedJwt;
  idToken?: DecodedJwt;
  accessTokenError?: string;
  idTokenError?: string;
}
