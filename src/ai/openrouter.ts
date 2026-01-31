// OpenRouter API client with streaming support
// Provides LLM access for accessibility features

import { getLogger } from '../logging.ts';
import { Env } from '../env.ts';
import { MelkerConfig } from '../config/mod.ts';
import { ensureError } from '../utils/error.ts';

const logger = getLogger('ai:openrouter');

export interface OpenRouterConfig {
  apiKey: string;
  model: string;
  endpoint?: string;
  siteUrl?: string;
  siteName?: string;
}

// Tool call from the model
export interface ToolCallRequest {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

// Chat message with optional tool-related fields
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCallRequest[];
  tool_call_id?: string; // For tool result messages
}

// Tool definition for API
export interface ApiTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, { type: string; description: string; enum?: string[] }>;
      required: string[];
    };
  };
}

export interface StreamCallback {
  onToken: (token: string) => void;
  onComplete: (fullResponse: string) => void;
  onError: (error: Error) => void;
  onToolCall?: (toolCalls: ToolCallRequest[]) => void | Promise<void>;
}

// Default configuration
// const DEFAULT_MODEL = 'google/gemini-2.5-flash-lite';

const DEFAULT_MODEL = 'openai/gpt-5.2-chat';
// const DEFAULT_MODEL = 'mistralai/devstral-2512';
const DEFAULT_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_SITE_URL = 'https://github.com/melker';
const DEFAULT_SITE_NAME = 'Melker';

/**
 * Get OpenRouter configuration from MelkerConfig and environment
 */
export function getOpenRouterConfig(): OpenRouterConfig | null {
  // API key is a secret, read from env directly
  const apiKey = Env.get('OPENROUTER_API_KEY');
  if (!apiKey) {
    logger.warn('OPENROUTER_API_KEY not set - AI accessibility features disabled');
    return null;
  }

  const config = MelkerConfig.get();
  const model = config.aiModel;
  const endpoint = config.aiEndpoint;
  logger.info('OpenRouter configured', { model, endpoint });

  return {
    apiKey,
    model,
    endpoint,
    siteUrl: config.aiSiteUrl || DEFAULT_SITE_URL,
    siteName: config.aiSiteName || DEFAULT_SITE_NAME,
  };
}

/**
 * Stream a chat completion from OpenRouter
 * Responses are delivered token by token via the callback
 * @param tools Optional array of tools the model can use
 */
export async function streamChat(
  messages: ChatMessage[],
  config: OpenRouterConfig,
  callback: StreamCallback,
  tools?: ApiTool[]
): Promise<void> {
  logger.info('Starting chat stream', {
    model: config.model,
    messageCount: messages.length,
    toolCount: tools?.length || 0
  });

  try {
    const requestBody: Record<string, unknown> = {
      model: config.model,
      messages,
      stream: true,
    };

    // Add tools if provided
    if (tools && tools.length > 0) {
      requestBody.tools = tools;
      requestBody.tool_choice = 'auto';
    }

    // Log the full request for debugging
    logger.info('Sending API request', {
      model: config.model,
      messageCount: messages.length,
      hasTools: !!tools && tools.length > 0,
      toolNames: tools?.map(t => t.function.name) || [],
      requestBody: JSON.stringify(requestBody).substring(0, 2000)
    });

    const endpoint = config.endpoint || DEFAULT_ENDPOINT;

    // Build headers, starting with defaults
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${config.apiKey}`,
      'HTTP-Referer': config.siteUrl || DEFAULT_SITE_URL,
      'X-Title': config.siteName || DEFAULT_SITE_NAME,
      'Content-Type': 'application/json',
    };

    // Add custom headers from config
    const customHeaders = MelkerConfig.get().aiHeaders;
    if (customHeaders) {
      for (const [name, value] of Object.entries(customHeaders)) {
        if (name && value) {
          headers[name] = value;
          logger.debug('Added custom header', { name, valueLength: value.length });
        }
      }
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      const apiError = new Error(`OpenRouter API error: ${response.status} ${errorText}`);
      logger.error('OpenRouter API error', apiError, {
        status: response.status,
        errorBody: errorText.substring(0, 1000),
        model: config.model
      });
      throw apiError;
    }

    logger.debug('OpenRouter stream started');

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body reader available');
    }

    const decoder = new TextDecoder();
    let fullResponse = '';
    let buffer = '';
    // Track tool calls being assembled from streaming chunks
    const pendingToolCalls: Map<number, ToolCallRequest> = new Map();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete SSE messages
      const lines = buffer.split('\n');
      // Keep incomplete line in buffer
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':')) {
          // Empty line or comment, skip
          continue;
        }

        if (trimmed.startsWith('data: ')) {
          const data = trimmed.slice(6);

          if (data === '[DONE]') {
            // Check if we have tool calls to report
            const doneToolCalls = Array.from(pendingToolCalls.values());
            logger.info('[DONE] received', {
              responseLength: fullResponse.length,
              response: fullResponse.substring(0, 500),
              pendingToolCallCount: pendingToolCalls.size,
              toolCalls: doneToolCalls.length > 0 ? JSON.stringify(doneToolCalls) : 'none'
            });

            if (pendingToolCalls.size > 0) {
              logger.info('Triggering onToolCall callback', {
                toolCallCount: doneToolCalls.length,
                tools: doneToolCalls.map(tc => tc.function.name)
              });
              if (callback.onToolCall) {
                try {
                  await callback.onToolCall(doneToolCalls);
                } catch (toolCallError) {
                  const err = toolCallError instanceof Error ? toolCallError : new Error(String(toolCallError));
                  logger.error('Error in onToolCall callback', err);
                  callback.onError(err);
                }
              }
              return;
            }
            logger.info('Triggering onComplete callback', { responseLength: fullResponse.length });
            callback.onComplete(fullResponse);
            return;
          }

          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta;
            const finishReason = parsed.choices?.[0]?.finish_reason;

            // Log each chunk for debugging - INFO level for visibility
            logger.debug('SSE chunk', {
              delta: JSON.stringify(delta),
              finishReason: finishReason || null,
              rawData: data.substring(0, 500)
            });

            // Handle text content
            if (delta?.content) {
              fullResponse += delta.content;
              callback.onToken(delta.content);
            }

            // Handle tool calls
            if (delta?.tool_calls) {
              logger.debug('Tool call delta received', {
                toolCalls: JSON.stringify(delta.tool_calls),
                currentPendingCount: pendingToolCalls.size
              });
              for (const toolCallDelta of delta.tool_calls) {
                const index = toolCallDelta.index ?? 0;

                if (!pendingToolCalls.has(index)) {
                  // New tool call
                  const newToolCall = {
                    id: toolCallDelta.id || `call_${index}`,
                    type: 'function' as const,
                    function: {
                      name: toolCallDelta.function?.name || '',
                      arguments: toolCallDelta.function?.arguments || '',
                    },
                  };
                  pendingToolCalls.set(index, newToolCall);
                  logger.info('New tool call started', { index, toolCall: JSON.stringify(newToolCall) });
                } else {
                  // Append to existing tool call
                  const existing = pendingToolCalls.get(index)!;
                  if (toolCallDelta.function?.name) {
                    // Only append name if current name is empty or incomplete
                    if (!existing.function.name) {
                      existing.function.name = toolCallDelta.function.name;
                    } else {
                      existing.function.name += toolCallDelta.function.name;
                    }
                  }
                  if (toolCallDelta.function?.arguments) {
                    // Check if existing arguments look like complete JSON before appending
                    const existingArgs = existing.function.arguments.trim();
                    const newArgs = toolCallDelta.function.arguments;

                    // If existing is empty or clearly incomplete, append
                    if (!existingArgs ||
                        !existingArgs.endsWith('}') ||
                        (existingArgs.match(/\{/g)?.length || 0) > (existingArgs.match(/\}/g)?.length || 0)) {
                      existing.function.arguments += newArgs;
                    } else {
                      // Existing looks complete, log warning but still append (model might send in parts)
                      logger.warn('Appending to possibly complete JSON', {
                        existing: existingArgs,
                        new: newArgs
                      });
                      existing.function.arguments += newArgs;
                    }
                  }
                  logger.info('Tool call updated', { index, toolCall: JSON.stringify(existing) });
                }
              }
            }
          } catch {
            // Ignore JSON parse errors for incomplete chunks
          }
        }
      }
    }

    // If we exit the loop without [DONE], check for tool calls or complete
    const finalToolCalls = Array.from(pendingToolCalls.values());
    logger.info('Stream ended (no [DONE] marker)', {
      responseLength: fullResponse.length,
      response: fullResponse.substring(0, 500),
      pendingToolCallCount: pendingToolCalls.size,
      toolCalls: finalToolCalls.length > 0 ? JSON.stringify(finalToolCalls) : 'none'
    });

    if (pendingToolCalls.size > 0) {
      const toolCalls = Array.from(pendingToolCalls.values());
      logger.info('Chat stream completed with tool calls (no [DONE])', {
        toolCallCount: toolCalls.length,
        toolCalls: toolCalls.map(tc => ({ name: tc.function.name, args: tc.function.arguments }))
      });
      if (callback.onToolCall) {
        callback.onToolCall(toolCalls);
      }
    } else {
      logger.info('Chat stream completed (no [DONE])', { responseLength: fullResponse.length });
      callback.onComplete(fullResponse);
    }
  } catch (error) {
    const err = ensureError(error);
    logger.error('Chat stream error', err);
    callback.onError(err);
  }
}

/**
 * Non-streaming chat completion (for simpler use cases)
 */
export async function chat(
  messages: ChatMessage[],
  config: OpenRouterConfig
): Promise<string> {
  return new Promise((resolve, reject) => {
    let result = '';
    streamChat(messages, config, {
      onToken: (token) => {
        result += token;
      },
      onComplete: (fullResponse) => {
        resolve(fullResponse);
      },
      onError: (error) => {
        reject(error);
      },
    });
  });
}
