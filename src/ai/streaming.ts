// Streaming JSON extractor for SSE (Server-Sent Events) responses
// Extracts JSON fields progressively from OpenAI-compatible streaming APIs

import { getLogger } from '../logging.ts';

const logger = getLogger('StreamingExtractor');

/**
 * Options for creating a streaming extractor
 */
export interface StreamingExtractorOptions {
  /**
   * Called repeatedly as string fields grow during streaming.
   * `partial` is the current value, `complete` is true when the field is fully received.
   */
  /**
   * Called repeatedly as string fields grow during streaming.
   * `partial` is the current value, `complete` is true when the field is fully received.
   */
  onField?: Record<string, (partial: string, complete: boolean) => void>;
  /** Called with the accumulated full content after each chunk */
  onContent?: (content: string) => void;
  /** Called with the full parsed JSON when the stream ends */
  onComplete?: (json: unknown) => void;
  /** Called if the stream fails or JSON is malformed */
  onError?: (error: Error) => void;
}

/**
 * Result of a streaming extraction
 */
export interface StreamingExtractorResult {
  /** Resolves to the full accumulated text content when the stream ends */
  result: Promise<string>;
  /** Abort the stream */
  abort(): void;
}

/**
 * Unescape a partial JSON string value (may not have closing quote yet).
 * Finds the first unescaped closing quote, trims there, then unescapes.
 */
function unescapeJsonPartial(raw: string): string {
  let end = -1;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '\\') { i++; continue; }
    if (raw[i] === '"') { end = i; break; }
  }
  const str = end !== -1 ? raw.slice(0, end) : raw;
  return str.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

/**
 * Extract a JSON string field value from partial/complete JSON text.
 * Returns the unescaped value, or null if the field isn't found.
 * `complete` indicates whether the closing quote was found.
 */
function extractJsonStringField(text: string, key: string): { value: string; complete: boolean } | null {
  const marker = '"' + key + '"';
  const idx = text.indexOf(marker);
  if (idx === -1) return null;
  const afterKey = text.indexOf(':', idx + marker.length);
  if (afterKey === -1) return null;
  const valStart = text.indexOf('"', afterKey + 1);
  if (valStart === -1) return null;

  const raw = text.slice(valStart + 1);
  // Check if we have a closing quote
  let hasClose = false;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '\\') { i++; continue; }
    if (raw[i] === '"') { hasClose = true; break; }
  }

  return { value: unescapeJsonPartial(raw), complete: hasClose };
}

/**
 * Parse JSON from streaming LLM output, handling markdown fences and partial JSON.
 */
function parseStreamedJSON(text: string): unknown | null {
  try {
    let cleaned = text.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```\w*\n?/, '').replace(/\n?```$/, '');
    }
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

/**
 * Process an SSE stream from an OpenAI-compatible API response.
 * Extracts content deltas and calls field callbacks progressively.
 *
 * @param body - ReadableStream from fetch response (response.body)
 * @param options - Field callbacks, completion handler, error handler
 * @returns Object with `result` promise and `abort()` method
 */
export function createStreamingExtractor(
  body: ReadableStream<Uint8Array>,
  options: StreamingExtractorOptions = {}
): StreamingExtractorResult {
  let aborted = false;
  let readerRef: ReadableStreamDefaultReader<Uint8Array> | null = null;

  const result = (async () => {
    let fullContent = '';
    const reader = body.getReader();
    readerRef = reader;
    const td = new TextDecoder();
    let buf = '';
    // Track which fields have been seen as complete to avoid re-firing
    const completedFields = new Set<string>();

    try {
      while (true) {
        if (aborted) break;
        const { done, value } = await reader.read();
        if (done) break;

        buf += td.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;
          try {
            const delta = JSON.parse(data).choices?.[0]?.delta?.content;
            if (delta) {
              fullContent += delta;

              // Fire raw content callback
              if (options.onContent) {
                options.onContent(fullContent);
              }

              // Fire field callbacks for streaming string extraction
              if (options.onField) {
                for (const [fieldName, callback] of Object.entries(options.onField)) {
                  if (completedFields.has(fieldName)) continue;
                  const extracted = extractJsonStringField(fullContent, fieldName);
                  if (extracted) {
                    callback(extracted.value, extracted.complete);
                    if (extracted.complete) {
                      completedFields.add(fieldName);
                    }
                  }
                }
              }
            }
          } catch {
            // Malformed SSE line — skip
          }
        }
      }
    } catch (error) {
      if (!aborted) {
        const err = error instanceof Error ? error : new Error(String(error));
        logger.error('Stream error: ' + err.message);
        if (options.onError) options.onError(err);
        throw err;
      }
    } finally {
      try { reader.releaseLock(); } catch { /* already released */ }
    }

    if (!fullContent && !aborted) {
      const err = new Error('Empty streaming response');
      if (options.onError) options.onError(err);
      throw err;
    }

    // Parse full JSON and fire onComplete
    if (options.onComplete && fullContent) {
      const parsed = parseStreamedJSON(fullContent);
      if (parsed) {
        options.onComplete(parsed);
      } else if (options.onError) {
        options.onError(new Error('Failed to parse streaming response as JSON'));
      }
    }

    logger.debug('Stream complete | length=' + fullContent.length + ' chars');
    return fullContent;
  })();

  return {
    result,
    abort() {
      aborted = true;
      try { readerRef?.cancel(); } catch { /* ignore */ }
    },
  };
}
