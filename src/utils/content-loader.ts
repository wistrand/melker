// Content loading utilities for files and URLs

/**
 * Check if a path is a URL (http:// or https://)
 */
export function isUrl(path: string): boolean {
  return path.startsWith('http://') || path.startsWith('https://');
}

/**
 * Check if a path is a remote/network URL (http://, https://, or rtsp://)
 * Used for video streams that can include RTSP protocol
 */
export function isRemoteUrl(path: string): boolean {
  return path.startsWith('http://') || path.startsWith('https://') || path.startsWith('rtsp:');
}

/**
 * Strip shebang line (e.g. #!/usr/bin/env -S melker) from content.
 * Allows .melker files to be directly executable.
 */
export function stripShebang(content: string): string {
  if (content.startsWith('#!')) {
    const newline = content.indexOf('\n');
    return newline === -1 ? '' : content.substring(newline + 1);
  }
  return content;
}

/**
 * Load content from a file path or URL
 */
export async function loadContent(pathOrUrl: string): Promise<string> {
  let content: string;
  if (isUrl(pathOrUrl)) {
    const response = await fetch(pathOrUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${pathOrUrl}: ${response.status} ${response.statusText}`);
    }
    content = await response.text();
  } else {
    content = await Deno.readTextFile(pathOrUrl);
  }
  return stripShebang(content);
}
