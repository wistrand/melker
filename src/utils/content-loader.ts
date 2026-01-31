// Content loading utilities for files and URLs

/**
 * Check if a path is a URL (http:// or https://)
 */
export function isUrl(path: string): boolean {
  return path.startsWith('http://') || path.startsWith('https://');
}

/**
 * Load content from a file path or URL
 */
export async function loadContent(pathOrUrl: string): Promise<string> {
  if (isUrl(pathOrUrl)) {
    const response = await fetch(pathOrUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${pathOrUrl}: ${response.status} ${response.statusText}`);
    }
    return await response.text();
  }
  return await Deno.readTextFile(pathOrUrl);
}
