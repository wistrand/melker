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
import { AudioRecorder, transcribeAudio } from './audio.ts';

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
  getSelectedText?: () => string | undefined;
}

// IDs used by the accessibility dialog (to exclude from context)
const DIALOG_ELEMENT_IDS = [
  'accessibility-dialog',
  'accessibility-main',
  'accessibility-input-row',
  'accessibility-status-row',
  'accessibility-query-input',
  'accessibility-send-btn',
  'accessibility-listen-btn',
  'accessibility-response-container',
  'accessibility-response',
  'accessibility-close-btn',
  'accessibility-status',
];

// Default audio recording duration in seconds
const DEFAULT_LISTEN_DURATION = 10;

// Maximum number of messages before compaction (not counting system message)
const MAX_MESSAGES_BEFORE_COMPACT = 10;
// Target number of messages after compaction
const COMPACT_TARGET_MESSAGES = 4;

// Default dialog dimensions
const DEFAULT_DIALOG_WIDTH = 70;
const DEFAULT_DIALOG_HEIGHT = 20;

// Saved dialog position and size (persisted across open/close)
interface DialogGeometry {
  offsetX?: number;
  offsetY?: number;
  width: number;
  height: number;
}

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
  // Audio recording
  private _audioRecorder: AudioRecorder;
  private _isListening = false;
  // Saved dialog geometry (position and size)
  private _savedGeometry: DialogGeometry = {
    width: DEFAULT_DIALOG_WIDTH,
    height: DEFAULT_DIALOG_HEIGHT,
  };

  constructor(deps: AccessibilityDialogDependencies) {
    this._deps = deps;
    this._debouncedRenderAction = createDebouncedAction(() => {
      this._deps.render();
      this._scrollToBottom();
    }, 50);
    this._audioRecorder = new AudioRecorder();
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
            <button id="accessibility-close-btn" label="Close" onClick=${onClose} />
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
    const onListen = () => this._handleListen();
    const onInputKeyPress = (event: { key: string }) => {
      if (event.key === 'Enter' && !this._isProcessing) {
        this._handleAsk();
      }
    };

    // Initial help text
    const initialText = this._conversationHistory || 'Type a question and click Send, or click Listen to use voice input.\n\nExamples:\n- What is on this screen?\n- How do I navigate?\n- What can I do here?';

    // Use saved geometry if available
    const { offsetX, offsetY, width, height } = this._savedGeometry;

    this._overlay = melker`
      <dialog
        id="accessibility-dialog"
        title="AI Assistant (Alt+H)"
        open=${true}
        modal=${true}
        backdrop=${false}
        draggable=${true}
        resizable=${true}
        width=${width}
        height=${height}
        offsetX=${offsetX}
        offsetY=${offsetY}
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
            id="accessibility-status-row"
            style="display: flex; flex-direction: row; width: fill; padding-left: 1; padding-right: 1; height: 1"
          >
            <text id="accessibility-status" text=" " style="color: gray; width: fill" />
          </container>
          <container
            id="accessibility-input-row"
            style="display: flex; flex-direction: row; width: fill; gap: 1; padding: 1; padding-top: 0"
          >
            <input
              id="accessibility-query-input"
              placeholder="Ask a question..."
              style="flex: 1"
              onKeyPress=${onInputKeyPress}
            />
            <button id="accessibility-listen-btn" label="Listen" onClick=${onListen} style="" />
            <button id="accessibility-send-btn" label="Send" onClick=${onSend} style="" />
            <button id="accessibility-close-btn" label="Close" onClick=${onClose} style="" />
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
    // Include any currently selected text
    const selectedText = this._deps.getSelectedText?.();
    const context = buildContext(
      this._deps.document,
      AccessibilityDialogManager.getExcludeIds(),
      selectedText
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
   * Handle the Listen button click - toggle audio recording
   */
  private async _handleListen(): Promise<void> {
    const listenBtn = this._deps.document.getElementById('accessibility-listen-btn');
    const statusElement = this._deps.document.getElementById('accessibility-status');
    const inputElement = this._deps.document.getElementById('accessibility-query-input');

    // If already listening, stop recording
    if (this._isListening) {
      logger.info('Stopping audio recording');
      this._isListening = false;
      if (listenBtn) {
        listenBtn.props.title = 'Listen';
      }
      if (statusElement) {
        statusElement.props.text = 'Stopping...';
      }
      this._deps.render();
      await this._audioRecorder.stopRecording();
      return;
    }

    // Don't start listening if already processing a query
    if (this._isProcessing) {
      logger.debug('Cannot listen while processing');
      return;
    }

    // Start recording
    this._isListening = true;
    if (listenBtn) {
      listenBtn.props.title = 'Stop';
    }
    if (statusElement) {
      statusElement.props.text = 'Listening...';
    }
    this._deps.render();

    // Set up level callback to update status
    this._audioRecorder.setLevelCallback((level, remainingSeconds) => {
      if (statusElement && this._isListening) {
        // Show visual level indicator with device info
        const bars = Math.min(5, Math.round(level * 50));
        const levelIndicator = '|'.repeat(bars) + ' '.repeat(5 - bars);
        const deviceDesc = this._audioRecorder.getDeviceDescription();
        const deviceInfo = deviceDesc ? ` (${deviceDesc})` : '';
        const paddedTime = String(remainingSeconds).padStart(2, ' ');
        statusElement.props.text = `[${levelIndicator}] ${paddedTime}s${deviceInfo}`;
        this._deps.render();
      }
    });

    try {
      logger.info('Starting audio recording');
      const wavData = await this._audioRecorder.startRecording(DEFAULT_LISTEN_DURATION);

      // Recording finished (either by timeout or stop button)
      this._isListening = false;
      if (listenBtn) {
        listenBtn.props.title = 'Listen';
      }

      if (!wavData) {
        logger.info('No audio data captured');
        if (statusElement) {
          statusElement.props.text = 'No audio';
        }
        this._deps.render();
        setTimeout(() => {
          if (statusElement) {
            statusElement.props.text = '';
            this._deps.render();
          }
        }, 2000);
        return;
      }

      // Transcribe the audio
      if (statusElement) {
        statusElement.props.text = 'Transcribing...';
      }
      this._deps.render();

      const transcription = await transcribeAudio(wavData, (durationSeconds) => {
        if (statusElement) {
          statusElement.props.text = `Transcribing ${Math.max(1, Math.round(durationSeconds)).toFixed(0)}s...`;
          this._deps.render();
        }
      });

      if (!transcription) {
        logger.info('No speech detected in audio');
        if (statusElement) {
          statusElement.props.text = 'No speech';
        }
        this._deps.render();
        setTimeout(() => {
          if (statusElement) {
            statusElement.props.text = '';
            this._deps.render();
          }
        }, 2000);
        return;
      }

      logger.info('Transcription received', { text: transcription });

      // Put the transcription in the input field and submit it
      if (inputElement) {
        inputElement.props.value = transcription;
      }
      if (statusElement) {
        statusElement.props.text = '';
      }
      this._deps.render();

      // Automatically send the transcribed text as a question
      await this._handleAsk();
    } catch (error) {
      logger.error('Audio recording/transcription failed', error instanceof Error ? error : new Error(String(error)));
      this._isListening = false;
      if (listenBtn) {
        listenBtn.props.title = 'Listen';
      }
      if (statusElement) {
        // Extract compact error message
        const errorMsg = error instanceof Error ? error.message : String(error);
        let compactError = 'Audio error';

        // Check for missing command (e.g., "Failed to spawn 'ffmpeg': entity not found")
        const spawnMatch = errorMsg.match(/Failed to spawn '([^']+)'/);
        if (spawnMatch) {
          compactError = `${spawnMatch[1]} not found`;
        } else if (errorMsg.includes('NotFound') || errorMsg.includes('ENOENT') || errorMsg.includes('No such file')) {
          compactError = 'Command not found';
        } else if (errorMsg.includes('permission') || errorMsg.includes('Permission')) {
          compactError = 'Mic permission denied';
        } else if (errorMsg.includes('pulse') || errorMsg.includes('ALSA')) {
          compactError = 'No audio device';
        } else if (errorMsg.includes('timeout') || errorMsg.includes('Timeout')) {
          compactError = 'Recording timeout';
        } else if (errorMsg.includes('audio engine') || errorMsg.includes('AudioEngine')) {
          compactError = 'Audio engine failed';
        } else if (errorMsg.includes('converter') || errorMsg.includes('Converter') || errorMsg.includes('Conversion')) {
          compactError = 'Audio conversion failed';
        } else if (errorMsg.includes('output buffer') || errorMsg.includes('channel data')) {
          compactError = 'Audio buffer error';
        } else if (errorMsg.includes('output format') || errorMsg.includes('input format')) {
          compactError = 'Audio format error';
        }
        statusElement.props.text = compactError;
      }
      this._deps.render();
      setTimeout(() => {
        if (statusElement) {
          statusElement.props.text = '';
          this._deps.render();
        }
      }, 3000);
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
   * Toggle listening state (for F7 key when dialog is open)
   */
  toggleListen(): void {
    if (!this._overlay) {
      logger.debug('Cannot toggle listen - dialog not open');
      return;
    }
    this._handleListen();
  }

  /**
   * Show dialog and immediately start listening (for F7 key when dialog is closed)
   */
  showAndListen(): void {
    if (this._overlay) {
      logger.debug('Dialog already open, just starting listen');
      this._handleListen();
      return;
    }

    logger.info('Opening accessibility dialog with voice input');

    const config = getOpenRouterConfig();
    if (!config) {
      logger.warn('API key not configured - showing setup dialog');
      this._showConfigError();
      return;
    }

    this._createDialog();

    // Start listening after a short delay to ensure dialog is rendered
    setTimeout(() => {
      this._handleListen();
    }, 100);
  }

  /**
   * Close the accessibility dialog
   */
  close(): void {
    if (!this._overlay) return;

    logger.info('Closing accessibility dialog');

    // Save current geometry before closing
    const dialogElement = this._deps.document.getElementById('accessibility-dialog');
    if (dialogElement) {
      const props = dialogElement.props;
      this._savedGeometry = {
        offsetX: props.offsetX as number | undefined,
        offsetY: props.offsetY as number | undefined,
        width: (props.width as number) || DEFAULT_DIALOG_WIDTH,
        height: (props.height as number) || DEFAULT_DIALOG_HEIGHT,
      };
      logger.debug('Saved dialog geometry', { ...this._savedGeometry });
    }

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
