// OpenID Connect well-known discovery

import type { WellKnownConfig } from './types.ts';
import { getLogger } from '../logging.ts';

const logger = getLogger('oauth');

const wellKnownCache = new Map<string, WellKnownConfig>();

/**
 * Fetch OpenID Connect discovery document
 */
export async function fetchWellKnownConfig(wellKnownUrl: string): Promise<WellKnownConfig> {
  const cached = wellKnownCache.get(wellKnownUrl);
  if (cached) {
    logger.debug('Using cached well-known config');
    return cached;
  }

  logger.debug('Fetching well-known config', { url: wellKnownUrl });

  let response: Response;
  try {
    response = await fetch(wellKnownUrl);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Failed to fetch well-known config: network error', undefined, { url: wellKnownUrl, error: message });
    throw new Error(`Failed to fetch well-known config from ${wellKnownUrl}: ${message}`);
  }

  if (!response.ok) {
    logger.error('Failed to fetch well-known config', undefined, { status: response.status, url: wellKnownUrl });
    throw new Error(`Failed to fetch well-known config: ${response.status} ${response.statusText}`);
  }

  const config = await response.json() as WellKnownConfig;
  logger.debug('Well-known config fetched', { issuer: config.issuer });

  if (!config.authorization_endpoint || !config.token_endpoint) {
    throw new Error('Invalid well-known config: missing required endpoints');
  }

  wellKnownCache.set(wellKnownUrl, config);

  return config;
}

/**
 * Clear the well-known config cache
 */
export function clearWellKnownCache(): void {
  wellKnownCache.clear();
}
