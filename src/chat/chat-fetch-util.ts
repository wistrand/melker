/**
 * Chat fetch utilities for streaming chat content from APIs
 */

import { ensureError } from '../utils/error.ts';

// Types for chat streaming
export interface ChatOptions {
  data: unknown;
  headers: Record<string, string>;
  apiUrl: string;
  fetchTimeout?: number;
  readTimeout?: number;
  totalTime?: number;
}

export interface AnthropicContentBlockDelta {
  type: 'content_block_delta';
  index: number;
  delta: {
    type: 'text_delta';
    text: string;
  };
  meta?: unknown;
}

export interface OpenAIChoice {
  delta?: {
    content?: string;
    function_call?: {
      name?: string;
      arguments?: string;
    };
  };
}

export interface OpenAIChatResponse {
  choices?: OpenAIChoice[];
  meta?: unknown;
}

export type ChatResponseCallback = (
  content: string,
  isComplete: boolean,
  data?: AnthropicContentBlockDelta | OpenAIChatResponse
) => Promise<void>;

export type ChatFinishCallback = () => Promise<void>;

export type ChatErrorCallback = (error: Error) => Promise<void>;

interface StreamResult {
  type: 'data' | 'error';
  value: any;
}

interface FetchChatParams {
  apiUrl: string;
  headers: Record<string, string>;
  body: string;
  fetchTimeout: number;
}

/**
 * Read OpenAI streamed chat content
 */
export async function fetchStreamedChatContent(
  options: ChatOptions,
  onResponse?: ChatResponseCallback,
  onFinish?: ChatFinishCallback,
  onError?: ChatErrorCallback
): Promise<void> {
  try {
    let chunks: string[] = [];
    let count = 0;

    await fetchStreamedChat(
      options,
      async (responseChunk: string) => {
        count++;
        let data: AnthropicContentBlockDelta | OpenAIChatResponse | undefined;
        let content: string;

        try {
          if (responseChunk?.startsWith('event: ')) {
            // Skip Anthropic event stream control line
          } else if (responseChunk?.startsWith('{"type":"content_block_delta"')) {
            // Anthropic event stream
            // {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" helpful"}}
            data = JSON.parse(responseChunk.trim()) as AnthropicContentBlockDelta;
            chunks = []; // Successful parse means no kept chunks
            content = (data as AnthropicContentBlockDelta).delta?.text ?? '';

            if ((content || data?.meta) && onResponse) {
              await onResponse(content, false, data);
            }
          } else {
            const json = chunks.join("") + responseChunk;
            data = JSON.parse(json.trim()) as OpenAIChatResponse;
            chunks = []; // Successful parse means no kept chunks
            content = '';

            const choice = data?.choices?.[0];
            if (choice?.delta?.function_call?.name) {
              content = choice.delta.function_call.name + " ";
            } else if (choice?.delta?.function_call?.arguments) {
              content = choice.delta.function_call.arguments;
            } else {
              content = choice?.delta?.content || '';
            }

            chunks = [];
            if ((content || data?.meta) && onResponse) {
              await onResponse(content, false, data);
            }
          }
        } catch (e) {
          if (data !== undefined) {
            throw e;
          } else {
            chunks.push(responseChunk);
          }
        }
      }
    );

    if (onFinish) {
      await onFinish();
    }
  } catch (error) {
    if (onError) {
      await onError(ensureError(error));
    }
  }
}

async function fetchStreamedChat(
  options: ChatOptions,
  onChunkReceived: (chunk: string) => Promise<void>
): Promise<void> {
  const {
    data,
    headers,
    apiUrl,
    fetchTimeout = 30000,
    readTimeout = 20000,
    totalTime = 300000
  } = options;

  const body = JSON.stringify(data);
  const t0 = Date.now();

  function totalTimeTimeout(): Promise<never> {
    return new Promise((_, reject) => {
      const dt = Date.now() - t0;
      const remainingTime = totalTime - dt;

      if (remainingTime <= 0) {
        reject(new Error(`Total timeout ${totalTime}ms reached`));
      } else {
        setTimeout(
          () => reject(new Error(`Total timeout ${totalTime}ms reached`)),
          remainingTime
        );
      }
    });
  }

  async function processStream(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    decoder: TextDecoder,
    onChunkReceived: (chunk: string) => Promise<void>
  ): Promise<void> {
    while (true) {
      const result: StreamResult = await Promise.race([
        reader.read().then((res) => ({ type: 'data' as const, value: res })),
        timeout(readTimeout).then(() => ({
          type: 'error' as const,
          value: new Error(`readTimeout ${readTimeout}ms`)
        })),
        totalTimeTimeout().then(() => ({
          type: 'error' as const,
          value: new Error(`Total timeout ${totalTime}ms reached`)
        })),
      ]);

      if (result.type === 'error') {
        throw result.value;
      }

      const { done, value } = result.value as ReadableStreamReadResult<Uint8Array>;

      if (done) {
        return;
      }

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n').filter(line => line.trim() !== '');

      for (const line of lines) {
        // Each line has a 'data: ' prefix -- remove it
        const message = line.replace(/^data: /, '');

        if (message === '[DONE]') {
          return;
        }

        await onChunkReceived(message);
      }
    }
  }

  async function fetchChatResponse(params: FetchChatParams): Promise<Response> {
    const { apiUrl, headers, body, fetchTimeout } = params;

    try {
      const response = await Promise.race([
        fetch(apiUrl, {
          method: 'POST',
          headers: headers,
          body: body,
        }),
        timeout(fetchTimeout),
        totalTimeTimeout(),
      ]);

      if (response && 'status' in response) {
        return response as Response;
      } else {
        return jsonReply(408, { message: "timeout" });
      }
    } catch (error) {
      throw new Error(`Failed to fetch chat: ${error}`);
    }
  }

  const res = await fetchChatResponse({ apiUrl, headers, body, fetchTimeout });

  if (res?.status === 200) {
    if (!res.body) {
      throw new Error("Response body is null");
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');

    await processStream(reader, decoder, onChunkReceived);
  } else {
    const errorText = res ? await res.text() : "";
    throw new Error(`Bad stream response ${res?.status} ${res?.statusText} ${errorText}`);
  }
}

export async function timeout(ms: number): Promise<never> {
  return new Promise((_resolve, reject) =>
    setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms)
  );
}

export function jsonReply(
  status: number,
  obj: unknown,
  extraHeaders?: Record<string, string>
): Response {
  const str = (obj && typeof obj === 'string') ? obj : JSON.stringify(obj, undefined, ' ');

  return new Response(str, {
    status: status,
    headers: {
      ...(extraHeaders || {}),
      "content-type": "application/json; charset=utf-8",
      "content-length": String(new TextEncoder().encode(str).length)
    }
  });
}