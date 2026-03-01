// Browser opening utility for OAuth flows

import { platform, Command } from '../runtime/mod.ts';

/**
 * Open URL in default browser
 */
export async function openBrowser(url: string): Promise<void> {
  const os = platform();

  let cmd: string[];
  if (os === 'darwin') {
    cmd = ['open', url];
  } else if (os === 'windows') {
    cmd = ['cmd', '/c', 'start', '', url];
  } else {
    cmd = ['xdg-open', url];
  }

  const command = new Command(cmd[0], { args: cmd.slice(1) });
  await command.output();
}

/**
 * Parse port from redirect URI
 */
export function parsePort(redirectUri: string): number {
  try {
    const url = new URL(redirectUri);
    return parseInt(url.port) || (url.protocol === 'https:' ? 443 : 80);
  } catch {
    return 1900;
  }
}

/**
 * Parse path from redirect URI
 */
export function parsePath(redirectUri: string): string {
  try {
    const url = new URL(redirectUri);
    return url.pathname || '/melker/auth';
  } catch {
    return '/melker/auth';
  }
}

/**
 * Build authorization URL with query parameters
 */
export function buildAuthorizationUrl(
  authorizationEndpoint: string,
  params: Record<string, string>
): string {
  const url = new URL(authorizationEndpoint);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}
