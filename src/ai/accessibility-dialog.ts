// Accessibility Dialog Manager
// Shows an overlay dialog for AI-powered accessibility assistance

import { Document } from '../document.ts';
import { createElement } from '../element.ts';
import { melker } from '../template.ts';
import { Element } from '../types.ts';
import { FocusManager } from '../focus.ts';
import { getLogger } from '../logging.ts';
import { getOpenRouterConfig, streamChat, type ChatMessage, type ToolCallRequest } from './openrouter.ts';
import { buildContext, buildSystemPrompt, hashContext, type UIContext } from './context.ts';
import { getGlobalCache } from './cache.ts';
import { toolsToOpenRouterFormat, executeTool, type ToolContext, type ToolCall } from './tools.ts';
import { createDebouncedAction, type DebouncedAction } from '../utils/timing.ts';

const logger = getLogger('ai:dialog');

export interface AccessibilityDialogDependencies {
  document: Document;
  focusManager: FocusManager | null;
  registerElementTree: (element: Element) => void;
  render: () => void;
  forceRender: () => void;
  autoRender: boolean;
  exitProgram?: () => void | Promise<void>;
  scrollToBottom?: (containerId: string) => void;
}

// IDs used by the accessibility dialog (to exclude from context)
const DIALOG_ELEMENT_IDS = [
  'accessibility-dialog',
  'accessibility-main',
  'accessibility-input-row',
  'accessibility-query-input',
  'accessibility-send-btn',
  'accessibility-response-container',
  'accessibility-response',
  'accessibility-close-btn',
  'accessibility-status',
];

// Maximum number of messages before compaction (not counting system message)
const MAX_MESSAGES_BEFORE_COMPACT = 10;
// Target number of messages after compaction
const COMPACT_TARGET_MESSAGES = 4;

export class AccessibilityDialogManager {
  private _overlay?: Element;
  private _deps: AccessibilityDialogDependencies;
  private _isProcessing = false;
  private _currentResponse = '';
  private _conversationHistory = '';  // Accumulated Q+A history for display
  private _messageHistory: ChatMessage[] = [];  // Full conversation for API context
  private _isCompacting = false;
  // Debounced action for streaming render updates (50ms batching)
  private _debouncedRenderAction: DebouncedAction;

  constructor(deps: AccessibilityDialogDependencies) {
    this._deps = deps;
    this._debouncedRenderAction = createDebouncedAction(() => {
      this._deps.render();
      this._scrollToBottom();
    }, 50);
  }

  /**
   * Debounced render for streaming updates - batches rapid token updates
   */
  private _debouncedRender(): void {
    this._debouncedRenderAction.call();
  }

  /**
   * Flush any pending debounced render immediately
   */
  private _flushRender(): void {
    this._debouncedRenderAction.flush();
  }

  /**
   * Scroll the response container to the bottom
   */
  private _scrollToBottom(): void {
    if (this._deps.scrollToBottom) {
      this._deps.scrollToBottom('accessibility-response-container');
    }
  }

  /**
   * Check if accessibility dialog is open
   */
  isOpen(): boolean {
    return this._overlay !== undefined;
  }

  /**
   * Get the overlay element
   */
  getOverlay(): Element | undefined {
    return this._overlay;
  }

  /**
   * Get the IDs to exclude from context
   */
  static getExcludeIds(): string[] {
    return [...DIALOG_ELEMENT_IDS];
  }

  /**
   * Toggle the accessibility dialog (Ctrl+/)
   */
  toggle(): void {
    if (this._overlay) {
      this.close();
    } else {
      this.show();
    }
  }

  /**
   * Show the accessibility dialog
   */
  show(): void {
    if (this._overlay) {
      logger.debug('Dialog already open');
      return;
    }

    logger.info('Opening accessibility dialog');

    const config = getOpenRouterConfig();
    if (!config) {
      // Show error if API key not configured
      logger.warn('API key not configured - showing setup dialog');
      this._showConfigError();
      return;
    }

    this._createDialog();
  }

  /**
   * Show configuration error dialog
   */
  private _showConfigError(): void {
    const onClose = () => this.close();

    this._overlay = melker`
      <dialog
        id="accessibility-dialog"
        title="Accessibility Assistant - Setup Required"
        open=${true}
        modal=${true}
        backdrop=${false}
        draggable=${true}
        width=${65}
        height=${12}
        style="position: fixed"
      >
        <container
          id="accessibility-main"
          style="display: flex; flex-direction: column; width: fill; height: fill; padding: 1"
        >
          <text
            id="accessibility-error-title"
            text="AI Accessibility is not configured"
            style="color: yellow; bold: true"
          />
          <text
            id="accessibility-error-msg1"
            text="To enable AI-powered accessibility assistance:"
          />
          <text
            id="accessibility-error-msg2"
            text="1. Get a free API key from https://openrouter.ai"
          />
          <text
            id="accessibility-error-msg3"
            text="2. Set the environment variable:"
          />
          <text
            id="accessibility-error-msg4"
            text="   export OPENROUTER_API_KEY=your-key-here"
            style="color: cyan"
          />
          <container
            id="accessibility-footer"
            style="display: flex; flex-direction: row; justify-content: flex-end; width: fill; margin-top: 1"
          >
            <button id="accessibility-close-btn" title="Close" onClick=${onClose} />
          </container>
        </container>
      </dialog>
    `;

    this._addOverlayToDocument();
  }

  /**
   * Create the main accessibility dialog
   */
  private _createDialog(): void {
    const onClose = () => this.close();
    const onSend = () => this._handleAsk();
    const onInputKeyPress = (event: { key: string }) => {
      if (event.key === 'Enter' && !this._isProcessing) {
        this._handleAsk();
      }
    };

    // Initial help text
    const initialText = this._conversationHistory || 'Type a question and click Send.\n\nExamples:\n- What is on this screen?\n- How do I navigate?\n- What can I do here?';

    this._overlay = melker`
      <dialog
        id="accessibility-dialog"
        title="AI Assistant (Alt+H)"
        open=${true}
        modal=${true}
        backdrop=${false}
        draggable=${true}
        width=${70}
        height=${20}
        style="position: fixed"
      >
        <container
          id="accessibility-main"
          style="display: flex; flex-direction: column; width: fill; height: fill"
        >
          <container
            id="accessibility-response-container"
            scrollable=${true}
            focusable=${true}
            style="flex: 1; width: fill; padding: 1; overflow: scroll"
          >
            <markdown
              id="accessibility-response"
              text=${initialText}
            />
          </container>
          <container
            id="accessibility-input-row"
            style="display: flex; flex-direction: row; width: fill; gap: 1; padding: 1; padding-top: 0"
          >
            <text id="accessibility-status" text="" style="color: gray; width: 10" />
            <input
              id="accessibility-query-input"
              placeholder="Ask a question..."
              style="flex: 1"
              onKeyPress=${onInputKeyPress}
            />
            <button id="accessibility-send-btn" title="Send" onClick=${onSend} style="width: 8" />
            <button id="accessibility-close-btn" title="Close" onClick=${onClose} style="width: 9" />
          </container>
        </container>
      </dialog>
    `;

    this._addOverlayToDocument();

    // Focus the input field
    if (this._deps.focusManager) {
      this._deps.focusManager.focus('accessibility-query-input');
    }
  }

  /**
   * Add the overlay to the document
   */
  private _addOverlayToDocument(): void {
    if (!this._overlay) return;

    const root = this._deps.document.root;
    if (root.children) {
      root.children.push(this._overlay);
    }
    this._deps.registerElementTree(this._overlay);
    this._deps.forceRender();
  }

  /**
   * Handle the Ask button click or Enter key
   */
  private async _handleAsk(): Promise<void> {
    if (this._isProcessing) {
      logger.debug('Already processing a query');
      return;
    }

    const inputElement = this._deps.document.getElementById('accessibility-query-input');
    const responseElement = this._deps.document.getElementById('accessibility-response');
    const statusElement = this._deps.document.getElementById('accessibility-status');

    if (!inputElement || !responseElement) return;

    const query = (inputElement.props.value || '').trim();
    if (!query) {
      logger.debug('Empty query, ignoring');
      return;
    }

    logger.info('Processing accessibility query', { query });

    // Clear the input field
    inputElement.props.value = '';

    const config = getOpenRouterConfig();
    if (!config) return;

    // Build context excluding the dialog itself
    const context = buildContext(
      this._deps.document,
      AccessibilityDialogManager.getExcludeIds()
    );
    const contextHash = hashContext(context);

    // Add question to conversation history
    if (this._conversationHistory) {
      this._conversationHistory += '\n\n---\n\n';
    }
    this._conversationHistory += `**You:** ${query}\n\n`;

    // Check cache for exact match
    const cache = getGlobalCache();
    const cachedResponse = cache.get(query, contextHash);
    if (cachedResponse) {
      logger.info('Cache hit for query', { query, responseLength: cachedResponse.length });
      this._conversationHistory += `**Assistant:** ${cachedResponse}`;
      responseElement.props.text = this._conversationHistory;
      if (statusElement) {
        statusElement.props.text = '(cached)';
      }
      this._deps.render();
      // Clear cached status after a moment
      setTimeout(() => {
        if (statusElement) {
          statusElement.props.text = '';
          this._deps.render();
        }
      }, 1500);
      return;
    }

    // Start processing
    this._isProcessing = true;
    this._currentResponse = '';
    this._conversationHistory += '**Assistant:** ';
    responseElement.props.text = this._conversationHistory + '...';

    if (statusElement) {
      statusElement.props.text = 'Thinking...';
    }
    this._deps.render();

    // Add user message to history
    this._messageHistory.push({ role: 'user', content: query });

    // Build messages for the API - include full conversation history
    const messages: ChatMessage[] = [
      { role: 'system', content: buildSystemPrompt(context) },
      ...this._messageHistory,
    ];

    // Get tools for the API
    const tools = toolsToOpenRouterFormat();

    logger.info('Sending messages to API', {
      historyLength: this._messageHistory.length,
      totalMessages: messages.length,
      toolCount: tools.length,
      roles: this._messageHistory.map(m => m.role)
    });

    // Create tool context for execution
    const toolContext: ToolContext = {
      document: this._deps.document,
      closeDialog: () => this.close(),
      exitProgram: async () => {
        // Close the dialog first
        this.close();
        // Then exit - the exitProgram callback should handle cleanup
        if (this._deps.exitProgram) {
          await this._deps.exitProgram();
        }
      },
      render: () => this._deps.render(),
    };

    // Stream the response
    try {
      await streamChat(messages, config, {
        onToken: (token) => {
          this._currentResponse += token;
          responseElement.props.text = this._conversationHistory + this._currentResponse;
          this._debouncedRender();
        },
        onComplete: async (fullResponse) => {
          // Flush any pending debounced render before completing
          this._flushRender();

          // Update conversation history with complete response
          this._conversationHistory += fullResponse;
          responseElement.props.text = this._conversationHistory;

          // Add assistant response to message history
          this._messageHistory.push({ role: 'assistant', content: fullResponse });

          logger.debug('Response complete', {
            historyLength: this._messageHistory.length,
            responseLength: fullResponse.length
          });

          // Cache the complete response
          cache.set(query, contextHash, fullResponse);

          if (statusElement) {
            statusElement.props.text = '';
          }
          this._isProcessing = false;
          this._deps.render();
          this._scrollToBottom();

          // Check if we need to compact the history
          if (this._messageHistory.length > MAX_MESSAGES_BEFORE_COMPACT) {
            await this._compactHistory();
          }
        },
        onToolCall: async (toolCalls: ToolCallRequest[]) => {
          // Handle tool calls from the model
          logger.info('Received tool calls', {
            count: toolCalls.length,
            tools: toolCalls.map(tc => tc.function.name)
          });

          // Add assistant message with tool calls to history
          // Ensure arguments are valid JSON before storing
          const sanitizedToolCalls = toolCalls.map(tc => {
            let validArgs = '{}';
            try {
              // Parse and re-stringify to ensure valid JSON
              const parsed = JSON.parse(tc.function.arguments || '{}');
              validArgs = JSON.stringify(parsed);
            } catch {
              logger.warn('Invalid tool call arguments, using empty object', {
                toolName: tc.function.name,
                rawArgs: tc.function.arguments
              });
            }
            return {
              ...tc,
              function: {
                ...tc.function,
                arguments: validArgs
              }
            };
          });

          this._messageHistory.push({
            role: 'assistant',
            content: null,
            tool_calls: sanitizedToolCalls,
          });

          // Execute each tool and collect results
          const toolResults: Array<{ id: string; result: string }> = [];
          for (const toolCall of toolCalls) {
            // Parse arguments with error handling
            let parsedArgs: Record<string, unknown> = {};
            const rawArgs = toolCall.function.arguments || '{}';
            logger.info('Parsing tool call arguments', {
              toolName: toolCall.function.name,
              rawArgs: rawArgs,
              rawArgsLength: rawArgs.length
            });
            try {
              parsedArgs = JSON.parse(rawArgs);
              logger.info('Parsed tool call arguments', {
                toolName: toolCall.function.name,
                parsedArgs: JSON.stringify(parsedArgs)
              });
            } catch (parseError) {
              logger.error('Failed to parse tool call arguments', parseError instanceof Error ? parseError : new Error(String(parseError)), {
                toolName: toolCall.function.name,
                rawArgs: rawArgs
              });
              // Try to extract just the JSON object if there's extra content
              const jsonMatch = rawArgs.match(/^\s*(\{[\s\S]*?\})\s*/);
              if (jsonMatch) {
                try {
                  parsedArgs = JSON.parse(jsonMatch[1]);
                  logger.info('Recovered JSON from malformed arguments', { recovered: jsonMatch[1] });
                } catch {
                  // Give up and use empty args
                  logger.warn('Could not recover JSON, using empty args');
                }
              }
            }

            const toolCallParsed: ToolCall = {
              id: toolCall.id,
              name: toolCall.function.name,
              arguments: parsedArgs,
            };

            const result = await executeTool(toolCallParsed, toolContext);

            // Add to results
            toolResults.push({
              id: toolCall.id,
              result: JSON.stringify(result),
            });

            // Update conversation display
            const actionText = `*[Action: ${toolCall.function.name}]*\n${result.message}\n\n`;
            this._conversationHistory += actionText;
            responseElement.props.text = this._conversationHistory;
            this._deps.render();
          }

          // Add tool results to message history
          for (const result of toolResults) {
            this._messageHistory.push({
              role: 'tool',
              content: result.result,
              tool_call_id: result.id,
            });
          }

          // Continue the conversation if tools were called
          // The model might want to respond after seeing tool results
          if (statusElement) {
            statusElement.props.text = 'Continuing...';
          }
          this._deps.render();

          // Build new messages including tool results
          const continueMessages: ChatMessage[] = [
            { role: 'system', content: buildSystemPrompt(context) },
            ...this._messageHistory,
          ];

          // Make another call to get the final response
          this._currentResponse = '';
          this._conversationHistory += '**Assistant:** ';

          // Log message history state before continuation
          logger.info('Message history before continuation', {
            length: this._messageHistory.length,
            roles: this._messageHistory.map(m => m.role)
          });

          // Re-read config to allow dynamic changes
          const continueConfig = getOpenRouterConfig();
          if (!continueConfig) {
            logger.error('Config became unavailable during continuation');
            return;
          }

          await streamChat(continueMessages, continueConfig, {
            onToken: (token) => {
              this._currentResponse += token;
              responseElement.props.text = this._conversationHistory + this._currentResponse;
              this._debouncedRender();
            },
            onComplete: async (fullResponse) => {
              // Flush any pending debounced render before completing
              this._flushRender();

              this._conversationHistory += fullResponse;
              responseElement.props.text = this._conversationHistory;
              this._messageHistory.push({ role: 'assistant', content: fullResponse });

              if (statusElement) {
                statusElement.props.text = '';
              }
              this._isProcessing = false;
              this._deps.render();
              this._scrollToBottom();

              if (this._messageHistory.length > MAX_MESSAGES_BEFORE_COMPACT) {
                await this._compactHistory();
              }
            },
            onError: (error) => {
              logger.error('Continuation call failed', error);
              // Add placeholder assistant message to maintain alternation
              this._messageHistory.push({
                role: 'assistant',
                content: `[Error during response: ${error.message}]`
              });
              this._conversationHistory += `*Error: ${error.message}*`;
              responseElement.props.text = this._conversationHistory;
              if (statusElement) {
                statusElement.props.text = '';
              }
              this._isProcessing = false;
              this._deps.render();
            },
          });
        },
        onError: (error) => {
          // Remove the user message that failed
          this._messageHistory.pop();
          this._conversationHistory += `*Error: ${error.message}*`;
          responseElement.props.text = this._conversationHistory;
          if (statusElement) {
            statusElement.props.text = '';
          }
          this._isProcessing = false;
          this._deps.render();
        },
      }, tools);
    } catch (error) {
      // Remove the user message that failed
      this._messageHistory.pop();
      const errorMsg = error instanceof Error ? error.message : String(error);
      this._conversationHistory += `*Error: ${errorMsg}*`;
      responseElement.props.text = this._conversationHistory;
      if (statusElement) {
        statusElement.props.text = '';
      }
      this._isProcessing = false;
      this._deps.render();
    }
  }

  /**
   * Compact conversation history when it grows too large
   * Uses the model to summarize older messages
   */
  private async _compactHistory(): Promise<void> {
    if (this._isCompacting) return;
    this._isCompacting = true;

    logger.info('Compacting conversation history', {
      currentLength: this._messageHistory.length
    });

    // Re-read config to allow dynamic changes
    const config = getOpenRouterConfig();
    if (!config) {
      logger.error('Config unavailable for compaction');
      this._isCompacting = false;
      return;
    }

    const statusElement = this._deps.document.getElementById('accessibility-status');
    if (statusElement) {
      statusElement.props.text = 'Compacting...';
      this._deps.render();
    }

    try {
      // Keep the most recent messages
      const recentMessages = this._messageHistory.slice(-COMPACT_TARGET_MESSAGES);
      const oldMessages = this._messageHistory.slice(0, -COMPACT_TARGET_MESSAGES);

      if (oldMessages.length === 0) {
        this._isCompacting = false;
        return;
      }

      // Format old messages for summarization
      const oldConversation = oldMessages.map(m =>
        `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`
      ).join('\n\n');

      // Ask the model to summarize
      const summaryMessages: ChatMessage[] = [
        {
          role: 'system',
          content: 'You are summarizing a conversation for context. Provide a brief summary of the key points discussed, focusing on what the user asked about and what they learned. Keep it to 2-3 sentences.'
        },
        {
          role: 'user',
          content: `Summarize this conversation:\n\n${oldConversation}`
        },
      ];

      let summary = '';
      await streamChat(summaryMessages, config, {
        onToken: (token) => {
          summary += token;
        },
        onComplete: (fullSummary) => {
          summary = fullSummary;
        },
        onError: (error) => {
          logger.error('Failed to compact history', error);
          summary = '';
        },
      });

      if (summary) {
        // Replace old messages with a summary message
        this._messageHistory = [
          { role: 'assistant', content: `[Previous conversation summary: ${summary}]` },
          ...recentMessages,
        ];

        logger.info('History compacted', {
          newLength: this._messageHistory.length,
          summaryLength: summary.length
        });
      }
    } catch (error) {
      logger.error('Error compacting history', error instanceof Error ? error : new Error(String(error)));
    } finally {
      this._isCompacting = false;
      if (statusElement) {
        statusElement.props.text = '';
        this._deps.render();
      }
    }
  }

  /**
   * Close the accessibility dialog
   */
  close(): void {
    if (!this._overlay) return;

    logger.info('Closing accessibility dialog');

    // Remove from document root's children
    const root = this._deps.document.root;
    if (root.children) {
      const index = root.children.indexOf(this._overlay);
      if (index !== -1) {
        root.children.splice(index, 1);
      }
    }

    // Unregister all elements from document registry
    this._deps.document.removeElement(this._overlay);

    this._overlay = undefined;
    this._isProcessing = false;
    this._currentResponse = '';

    this._deps.forceRender();
  }
}
