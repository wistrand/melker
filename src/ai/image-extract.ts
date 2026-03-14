// Image response format normalizer for OpenAI-compatible APIs
// Extracts image data from various response formats and returns a data: URL

import { getLogger } from '../logging.ts';

const logger = getLogger('ImageExtract');

export interface ExtractImageOptions {
  /** AbortSignal for secondary fetches (remote URL formats) */
  signal?: AbortSignal;
}

/**
 * Extract an image from an OpenAI-compatible API response.
 * Normalizes all known response formats into a `data:` URL string.
 *
 * Supported formats:
 * - choices[].message.content[] with image_url.url (OpenRouter)
 * - choices[].message.content[] with inline_data (Gemini)
 * - choices[].message.images[] (OpenRouter alt)
 * - choices[].message.content as string data URL
 * - choices[].message.content with markdown image URL (fetches remote)
 * - data[].b64_json (DALL-E)
 * - data[].url (DALL-E URL, fetches remote)
 *
 * @param json - Parsed JSON response from the API
 * @param options - Optional abort signal for secondary fetches
 * @returns data: URL string
 * @throws if no image data found in response
 */
export async function extractImageFromResponse(
  json: unknown,
  options: ExtractImageOptions = {}
): Promise<string> {
  const obj = json as Record<string, unknown>;
  const choice = (obj.choices as Record<string, unknown>[])?.[0]
    ?.message as Record<string, unknown> | undefined;

  // content array formats (image_url, inline_data)
  if (choice?.content && Array.isArray(choice.content)) {
    for (const part of choice.content as Record<string, unknown>[]) {
      // image_url format
      if (part.type === 'image_url') {
        const url = (part.image_url as Record<string, unknown>)?.url as string;
        if (url) {
          logger.debug('Image via image_url | size=' + url.length);
          return url;
        }
      }
      // inline_data format (Gemini)
      if (part.type === 'inline_data' && part.data) {
        const mime = (part.mime_type as string) || 'image/png';
        const dataUrl = 'data:' + mime + ';base64,' + part.data;
        logger.debug('Image via inline_data | mime=' + mime);
        return dataUrl;
      }
    }
  }

  // message.images[] format
  if (choice?.images && Array.isArray(choice.images) && (choice.images as unknown[]).length > 0) {
    const img = (choice.images as unknown[])[0];
    if (typeof img === 'object' && img !== null) {
      const imgObj = img as Record<string, unknown>;
      // {type: "image_url", image_url: {url: "data:..."}}
      const nestedUrl = (imgObj.image_url as Record<string, unknown>)?.url as string;
      if (nestedUrl) {
        logger.debug('Image via images[].image_url.url | size=' + nestedUrl.length);
        return nestedUrl;
      }
      // Fallback object keys
      const raw = (imgObj.url || imgObj.data || imgObj.b64_json) as string;
      if (raw && typeof raw === 'string') {
        if (raw.startsWith('data:')) return raw;
        const mime = (imgObj.mime_type || imgObj.content_type || 'image/png') as string;
        return 'data:' + mime + ';base64,' + raw;
      }
    }
    // Plain string
    if (typeof img === 'string') {
      if (img.startsWith('data:')) return img;
      return 'data:image/png;base64,' + img;
    }
  }

  // String content (data URL or markdown image)
  if (typeof choice?.content === 'string') {
    const content = (choice.content as string).trim();
    if (content.startsWith('data:image/')) return content;
    // Markdown image URL — requires fetch
    const urlMatch = content.match(/!\[.*?\]\((https?:\/\/[^\s)]+)\)/);
    if (urlMatch) {
      logger.debug('Fetching image from markdown URL: ' + urlMatch[1].slice(0, 100));
      return await fetchAsDataUrl(urlMatch[1], options.signal);
    }
  }

  // data[] format (DALL-E / OpenAI images API)
  const data = obj.data as Record<string, unknown>[];
  if (Array.isArray(data) && data.length > 0) {
    const d = data[0];
    if (d.b64_json) {
      return 'data:image/png;base64,' + d.b64_json;
    }
    if (d.url && typeof d.url === 'string') {
      logger.debug('Fetching image from data[].url: ' + (d.url as string).slice(0, 100));
      return await fetchAsDataUrl(d.url as string, options.signal);
    }
  }

  throw new Error('No image data in response');
}

/**
 * Fetch a remote image URL and convert to a data: URL.
 */
async function fetchAsDataUrl(url: string, signal?: AbortSignal): Promise<string> {
  const res = await fetch(url, signal ? { signal } : undefined);
  if (!res.ok) {
    throw new Error('Image fetch failed: ' + res.status);
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  const contentType = res.headers.get('content-type') || 'image/png';
  const b64 = btoa(String.fromCharCode(...bytes));
  return 'data:' + contentType + ';base64,' + b64;
}
