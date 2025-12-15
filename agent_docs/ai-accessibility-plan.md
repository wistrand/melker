# AI-Powered Accessibility Plan

## Overview

Implement an AI-powered accessibility system for Melker that allows users to ask questions about the current UI state and get natural language descriptions of what's on screen. This uses an LLM via OpenRouter API instead of traditional screen reader APIs (which don't exist for terminal UIs).

## Architecture

```
User presses Ctrl+/ -> Dialog overlay appears -> User types question
                                                       |
                                                       v
                          Context gathered (screen content, focus state, etc.)
                                                       |
                                                       v
                                    OpenRouter API (streaming)
                                                       |
                                                       v
                               Response streamed to dialog text area
```

## Phase 1: OpenRouter Integration

### API Client (`src/ai/openrouter.ts`)

```typescript
interface OpenRouterConfig {
  apiKey: string;
  model: string;  // default: 'mistralai/devstral-2512:free'
  siteUrl?: string;
  siteName?: string;
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface StreamCallback {
  onToken: (token: string) => void;
  onComplete: () => void;
  onError: (error: Error) => void;
}
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENROUTER_API_KEY` | (required) | API key for OpenRouter |
| `MELKER_AI_MODEL` | `mistralai/devstral-2512:free` | Model to use |
| `MELKER_AI_SITE_URL` | `https://github.com/melker` | Site URL for rankings |
| `MELKER_AI_SITE_NAME` | `Melker TUI` | Site name for rankings |

### Streaming Implementation

Use Server-Sent Events (SSE) for streaming responses:

```typescript
async function streamChat(
  messages: ChatMessage[],
  config: OpenRouterConfig,
  callback: StreamCallback
): Promise<void> {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.apiKey}`,
      'HTTP-Referer': config.siteUrl,
      'X-Title': config.siteName,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      stream: true,  // Enable streaming
    }),
  });

  const reader = response.body?.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value);
    // Parse SSE format: "data: {...}\n\n"
    const lines = chunk.split('\n');
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        if (data === '[DONE]') {
          callback.onComplete();
          return;
        }
        const parsed = JSON.parse(data);
        const token = parsed.choices?.[0]?.delta?.content;
        if (token) {
          callback.onToken(token);
        }
      }
    }
  }
}
```

## Phase 2: Context Gathering

### Screen Context Builder (`src/ai/context.ts`)

Gather information about current UI state to send to the model:

```typescript
interface UIContext {
  screenContent: string;      // Text representation of visible UI
  focusedElement: string;     // Currently focused element description
  elementTree: string;        // Simplified DOM-like structure
  availableActions: string[]; // What the user can do
}

function buildContext(document: Document, excludeIds?: string[]): UIContext {
  // Exclude specified element IDs (like the accessibility dialog itself)
  // Build text representation of screen
  // Identify focused element
  // List available keyboard actions
}
```

### System Prompt

```
You are an accessibility assistant for a terminal user interface (TUI) application.
The user may be visually impaired or need help understanding the current screen.

Current screen content:
{screenContent}

Currently focused: {focusedElement}

UI structure:
{elementTree}

Available actions:
{availableActions}

Answer the user's question about the UI concisely and helpfully.
Focus on what they can do and how to navigate.
```

## Phase 3: Query Caching

### Cache Implementation (`src/ai/cache.ts`)

Cache responses for **exact query matches only**:

```typescript
interface CacheEntry {
  query: string;        // Exact user query
  context: string;      // Hash of UI context
  response: string;     // Cached response
  timestamp: number;    // When cached
}

class QueryCache {
  private cache: Map<string, CacheEntry> = new Map();
  private maxAge = 5 * 60 * 1000;  // 5 minutes

  getCacheKey(query: string, contextHash: string): string {
    // Only exact query + context matches
    return `${query}|${contextHash}`;
  }

  get(query: string, contextHash: string): string | null {
    const key = this.getCacheKey(query, contextHash);
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > this.maxAge) {
      this.cache.delete(key);
      return null;
    }
    return entry.response;
  }

  set(query: string, contextHash: string, response: string): void {
    const key = this.getCacheKey(query, contextHash);
    this.cache.set(key, {
      query,
      context: contextHash,
      response,
      timestamp: Date.now(),
    });
  }
}
```

## Phase 4: UI Integration

### Global Shortcut

Register `Ctrl+/` as a global shortcut that triggers the accessibility dialog.

### Accessibility Dialog

Show a **non-modal overlay dialog** positioned in a corner so the user can still see part of the screen underneath. The dialog contains:

1. **Input field** - For typing questions
2. **Response area** - Text area showing streamed response
3. **Action buttons** - "Ask" and "Close"

```
+--Accessibility Assistant--+
| [Ask a question...]       |
|                           |
| Response appears here     |
| as it streams from the    |
| AI model...               |
|                           |
| [Ask]           [Close]   |
+---------------------------+
```

### Critical: Exclude Dialog from Context

When building the UI context to send to the model, **exclude the accessibility dialog itself**:

```typescript
const context = buildContext(document, excludeIds: ['accessibility-dialog']);
```

This prevents the model from seeing and describing its own dialog, which would be confusing.

### Streaming to Dialog

As tokens arrive from the API, update the response text area in real-time:

```typescript
function handleAsk(query: string) {
  const responseText = getElementById('ai-response');
  responseText.props.text = '';  // Clear previous response

  streamChat(messages, config, {
    onToken: (token) => {
      responseText.props.text += token;
      render();  // Update display
    },
    onComplete: () => {
      // Cache the complete response
      cache.set(query, contextHash, responseText.props.text);
    },
    onError: (error) => {
      responseText.props.text = `Error: ${error.message}`;
      render();
    },
  });
}
```

## File Structure

```
src/ai/
  mod.ts              - Exports
  openrouter.ts       - OpenRouter API client with streaming
  context.ts          - UI context builder
  cache.ts            - Query cache (exact matches only)
  dialog.ts           - Accessibility dialog component
  shortcuts.ts        - Global shortcut registration
```

## Usage Flow

1. User presses `Ctrl+/`
2. Accessibility dialog appears in corner (overlay, not blocking)
3. User types question like "What's on this screen?" or "How do I submit the form?"
4. System gathers UI context (excluding the dialog)
5. If exact query+context is cached, return cached response immediately
6. Otherwise, send to OpenRouter API with streaming enabled
7. Response streams into dialog text area token by token
8. User can see response building up in real-time
9. Complete response is cached for exact same queries
10. User presses `Close` or `Escape` to dismiss

## Phase 5: AI Tools System

### Built-in Tools (`src/ai/tools.ts`)

The AI assistant can interact with the UI through a tool-calling system:

| Tool | Description |
|------|-------------|
| `send_event` | Send events to UI elements (click, change, focus, keypress) |
| `read_element` | Read full text content from elements (markdown, text, input, etc.) |
| `close_dialog` | Close the AI assistant dialog |
| `exit_program` | Exit the entire application |

### Custom Tools (for .melker files)

Applications can register custom AI tools:

```typescript
registerAITool({
  name: "increment_counter",
  description: "Increase the counter value",
  parameters: {
    amount: { type: "number", required: false, description: "Amount to add" }
  },
  handler: (args, context) => {
    state.count += args.amount || 1;
    context.render();
    return { success: true, message: "Counter incremented" };
  }
});
```

### Tool Execution Flow

1. AI model decides to use a tool based on user request
2. Tool call is parsed from streaming response
3. Tool is executed with provided arguments
4. Result is sent back to model for continuation
5. Model generates final response incorporating tool results

## Phase 6: UI Improvements

### Debounced Rendering

Streaming token updates are debounced (50ms) to reduce rendering overhead while maintaining responsiveness.

### Draggable Dialog

The AI assistant dialog is draggable by its title bar:
- `draggable={true}` prop on dialog
- Click and drag title bar to reposition
- Position persists during session

### Auto-scroll

The response area automatically scrolls to bottom as new content streams in.

## Example Queries

- "What is currently on the screen?"
- "What am I focused on?"
- "How do I navigate to the submit button?"
- "What options are in the menu?"
- "Describe the form fields"
- "What keyboard shortcuts are available?"
- "Summarize the markdown content" (uses read_element tool)
- "Click the submit button" (uses send_event tool)
