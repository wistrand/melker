// Shared URL utility functions for policy module

/**
 * Extract host from an HTTP/HTTPS URL.
 * Returns null if the URL is invalid or not HTTP/HTTPS.
 */
export function extractHostFromUrl(url: string): string | null {
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return null;
  }
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/**
 * Extract host from a URL, or return the original value if not a URL.
 * Useful for permission entries that can be either hosts or full URLs.
 */
export function extractHostOrValue(value: string): string {
  if (value.startsWith('http://') || value.startsWith('https://')) {
    try {
      return new URL(value).host;
    } catch {
      return value;
    }
  }
  return value;
}
