# AI Accessibility System

Melker includes an AI-powered accessibility assistant that allows users to ask questions about the UI and interact with elements through natural language. It supports both text and voice input.

## Quick Start

1. Set your OpenRouter API key:
   ```bash
   export OPENROUTER_API_KEY=your_key_here
   ```

2. Open the AI assistant:
   - Press `Alt+H` to open with text input
   - Press `F7` to open and immediately start voice recording
   - Click "AI Assistant" button in the F12 Dev Tools dialog

3. Ask questions like:
   - "What's on this screen?"
   - "How do I navigate to the submit button?"
   - "Summarize the markdown content"

## Architecture

```
User presses Alt+H or F7
       │
       ▼
┌──────────────────────────────────────────────┐
│  Accessibility Dialog (draggable)            │
│  ┌────────────────────────────────────────┐  │
│  │ Markdown response area                 │  │
│  │ (auto-scrolls, text-select)            │  │
│  ├────────────────────────────────────────┤  │
│  │ Status: [|||||] 3s  (during recording) │  │
│  ├────────────────────────────────────────┤  │
│  │ [Input field]  [Listen] [Send] [Close] │  │
│  └────────────────────────────────────────┘  │
└──────────────────────────────────────────────┘
       │
       ▼
Context gathered (screen content, focus, element tree)
       │
       ▼
OpenRouter API (streaming + tool calls)
       │
       ▼
Response streamed to dialog (debounced 50ms)
```

## Files

| File | Purpose |
|------|---------|
| `src/ai/mod.ts` | Module exports |
| `src/ai/openrouter.ts` | OpenRouter API client with SSE streaming |
| `src/ai/context.ts` | UI context builder, element tree serialization |
| `src/ai/cache.ts` | Query response cache (5min TTL, exact match) |
| `src/ai/tools.ts` | Tool definitions and execution |
| `src/ai/accessibility-dialog.ts` | Dialog UI and conversation management |
| `src/ai/audio.ts` | Audio recording, transcription, and silence trimming |
| `src/ai/macos-audio-record.swift` | Native macOS audio capture using AVAudioEngine |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENROUTER_API_KEY` | (required) | API key for OpenRouter |
| `MELKER_AI_MODEL` | `openai/gpt-5.2-chat` | Model for chat/tools |
| `MELKER_AUDIO_MODEL` | `openai/gpt-4o-audio-preview` | Model for audio transcription |
| `MELKER_AI_ENDPOINT` | `https://openrouter.ai/api/v1/chat/completions` | API endpoint URL |
| `MELKER_AI_HEADERS` | (none) | Custom headers (format: `name: value; name2: value2`) |
| `MELKER_AI_SITE_URL` | `https://github.com/melker` | Site URL for rankings |
| `MELKER_AI_SITE_NAME` | `Melker` | Site name for rankings |
| `MELKER_AUDIO_GAIN` | `2.0` | Audio recording gain multiplier |
| `MELKER_AUDIO_DEBUG` | `false` | Replay recorded audio before transcription |
| `MELKER_FFMPEG` | `false` | Force ffmpeg on macOS instead of native Swift |

All environment variables are read fresh on each API call, allowing dynamic changes without restart.

## Voice Input

The AI assistant supports voice input through the Listen button or F7 key.

### How it Works

1. Press F7 or click "Listen" to start recording (5 seconds max)
2. Speak your question
3. Press F7 again or wait for timeout to stop recording
4. Audio is processed:
   - Silence trimmed from beginning and end (reduces API costs)
   - Audio validated for meaningful content (skips empty/silent recordings)
   - Sent to transcription model
5. Transcribed text automatically submitted as a question

### Audio Processing

The `audio.ts` module handles:

| Function | Purpose |
|----------|---------|
| `AudioRecorder` | Platform-specific audio capture (Swift on macOS, ffmpeg elsewhere) |
| `transcribeAudio()` | Send audio to OpenRouter for transcription |
| `trimSilence()` | Remove silent portions from start/end |
| `hasAudioContent()` | Validate audio has meaningful volume |
| `playbackAudio()` | Debug playback via ffplay (when `MELKER_AUDIO_DEBUG=true`) |

Audio analysis uses RMS (root mean square) in 100ms chunks:
- Threshold: 0.01 RMS (roughly quiet speech)
- Minimum active: 5% of chunks must exceed threshold
- Padding: 200ms kept around trimmed audio

### Platform Support

Audio capture auto-detects the platform:
- **Linux**: ffmpeg with PulseAudio/PipeWire (preferred) or ALSA fallback
- **macOS**: Native Swift script using AVAudioEngine (no ffmpeg required)
- **Windows**: ffmpeg with DirectShow

Requirements:
- **Linux/Windows**: `ffmpeg` installed and in PATH
- **macOS**: Swift runtime (included with Xcode or Command Line Tools)

Set `MELKER_FFMPEG=true` to force ffmpeg on macOS instead of native Swift.

### Visual Feedback

During recording, the status row shows:
- Volume level indicator: `[|||||]` (5 bars max)
- Remaining time (padded): ` 3s`
- Device name on Linux: `(PulseAudio (device_name))`

Example: `[|||  ]  8s (PulseAudio (alsa_input.usb-Blue_Microphones))`

## Tool System

The AI can interact with the UI through tools:

### Built-in Tools

| Tool | Description | Parameters |
|------|-------------|------------|
| `send_event` | Send events to UI elements | `element_id`, `event_type` (click/change/focus/keypress), `value` |
| `click_canvas` | Click at specific coordinates on a canvas | `element_id`, `x`, `y` (pixel buffer coordinates) |
| `read_element` | Read full text content from elements | `element_id` |
| `close_dialog` | Close the AI assistant dialog | (none) |
| `exit_program` | Exit the application | (none) |

### Custom Tools (for .melker files)

Applications can register custom tools:

```typescript
// In <script> block
registerAITool({
  name: "increment_counter",
  description: "Increase the counter value",
  parameters: {
    amount: {
      type: "number",
      required: false,
      description: "Amount to add (default: 1)"
    }
  },
  handler: (args, context) => {
    state.count += args.amount || 1;
    return { success: true, message: `Counter is now ${state.count}` };
  }
});
```

Tool handlers receive:
- `args`: Parsed arguments from the model
- `context`: `{ document, closeDialog, exitProgram, render }`

Return `{ success: boolean, message: string, data?: any }`.

### Tool Execution Flow

1. User asks something that requires UI interaction
2. Model decides to call a tool (e.g., `read_element` to get content)
3. Tool is executed, result returned to model
4. Model continues with tool results in context
5. Final response generated

## Context Building

When the user asks a question, the system gathers:

### Screen Content
Text representation of visible UI, excluding the AI dialog itself.

### Element Tree
Simplified DOM-like structure:
```
container#main [flex, column]
  text#title "Welcome"
  button#submit "Submit"
  input#name placeholder="Enter name"
```

**Privacy:** Password inputs (`format="password"`) are automatically masked as `value="****"` and not sent to the AI.

### Focused Element
Currently focused element ID and type.

### Available Actions
Keyboard shortcuts and navigation hints.

## Caching

Responses are cached for exact query + context matches:
- Cache key: `query|contextHash`
- TTL: 5 minutes
- Same question with same UI state = instant response

## Dialog Features

### Draggable
Click and drag the title bar to reposition. Uses `draggable` prop on dialog component.

### Auto-scroll
Response area scrolls to bottom as content streams in.

### Debounced Rendering
Token updates batched every 50ms to reduce rendering overhead.

### Text Selection
Text in the response can be selected and copied (Ctrl+C).

### Conversation History
Multi-turn conversations supported. History compacted after 10 messages using summarization.

## Message Handling

### Streaming
Tokens stream in via Server-Sent Events (SSE):
```
data: {"choices":[{"delta":{"content":"Hello"}}]}
data: {"choices":[{"delta":{"content":" world"}}]}
data: [DONE]
```

### Role Alternation
API requires alternating user/assistant roles. Tool results use the `tool` role, followed by assistant continuation.

### Error Recovery
- JSON parsing errors in tool args: fallback to empty object
- API errors: displayed in dialog, logged
- Tool execution errors: returned to model for graceful handling

## System Prompt

```
You are an accessibility assistant for a terminal user interface (TUI) application.
The user may be visually impaired or need help understanding the current screen.

Current screen content:
{screenContent}

Currently focused: {focusedElement}

UI structure:
{elementTree}

Available keyboard actions:
{availableActions}

IMPORTANT: When the user asks you to summarize, translate, explain, or work with
text content from an element, you MUST first use the read_element tool to get the
full text content. The screen content above may be truncated.

Answer the user's question about the UI concisely and helpfully.
Focus on what they can do and how to navigate.
Keep responses brief - typically 1-3 sentences.
```

## Example Interactions

**User:** "What's on this screen?"
**AI:** "You're viewing a settings panel with three tabs: General, Advanced, and About. The General tab is active, showing options for theme and language. There's a Save button at the bottom."

**User:** "Summarize the markdown"
**AI:** [Uses read_element tool first]
"The document explains how to configure the application, covering three main topics: installation, configuration files, and environment variables."

**User:** "Click the save button"
**AI:** [Uses send_event tool]
"Done! I clicked the Save button. The settings have been saved."

## Integration with Engine

The accessibility dialog is managed by `AccessibilityDialogManager` in the engine:

```typescript
// In MelkerEngine
this._accessibilityDialog = new AccessibilityDialogManager({
  document: this._document,
  focusManager: this._focusManager,
  registerElementTree: (el) => this._document.registerElementTree(el),
  render: () => this.render(),
  forceRender: () => this.forceRender(),
  autoRender: this._options.autoRender ?? true,
  exitProgram: () => this.stop(),
  scrollToBottom: (id) => this._scrollHandler.scrollToBottom(id),
});

// Triggered by Alt+H
if (key === 'h' && event.altKey) {
  this._accessibilityDialog.toggle(this._rootElement);
}
```

## Excluding Dialog from Context

The dialog excludes itself from UI context to avoid the AI describing its own interface:

```typescript
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

// In context.ts
function buildContext(document: Document, excludeIds?: string[]): UIContext
```
