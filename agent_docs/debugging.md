# Debugging Melker Applications

## Critical Rule: No console.log()

**NEVER use `console.log()` in Melker applications.** It interferes with terminal UI rendering.

Use the file-based logging system instead.

## Logging System (`src/logging.ts`)

### Basic Usage

```typescript
import { getLogger } from './logging.ts';

const logger = getLogger('MyComponent');

logger.debug('Debug message', { data: 'value' });
logger.info('Info message');
logger.warn('Warning message');
logger.error('Error message');
```

### Log Levels

| Level | Use For |
|-------|---------|
| `DEBUG` | Detailed debugging info, variable dumps |
| `INFO` | General operational messages |
| `WARN` | Potential issues, recoverable errors |
| `ERROR` | Errors that need attention |
| `FATAL` | Critical errors, application termination |

### Configuration via Environment Variables

```bash
# Set log file path
MELKER_LOG_FILE=/tmp/debug.log

# Set minimum log level
MELKER_LOG_LEVEL=DEBUG

# Example: Run with full debug logging
MELKER_LOG_FILE=/tmp/debug.log MELKER_LOG_LEVEL=DEBUG \
  deno run --allow-all melker.ts app.melker
```

### Log Output Format

Logs are written in structured format:
```
2024-01-15T10:30:45.123Z [DEBUG] MyComponent: Message here | key="value", count=42
```

### Default Log Location

If not configured: `./logs/melker.log`

## Headless Mode (`src/headless.ts`)

Run Melker apps without a real terminal - useful for testing and CI.

### Enable Headless Mode

```bash
MELKER_HEADLESS=true deno run --allow-all melker.ts app.melker
```

### Features

- **Virtual terminal** - Default 80x24, configurable
- **Output capture** - All terminal output stored for inspection
- **Event injection** - Simulate keyboard/mouse via debug server
- **Resizable** - Change virtual terminal size at runtime

### Headless + Debug Server

Combine for remote testing:
```bash
MELKER_HEADLESS=true MELKER_DEBUG_PORT=8080 \
  deno run --allow-all melker.ts app.melker
```

## Debug Server (`src/debug-server.ts`)

WebSocket server for remote debugging and automation.

### Enable Debug Server

```bash
MELKER_DEBUG_PORT=8080 deno run --allow-all melker.ts app.melker
```

Access at: `http://localhost:8080` (web UI) or `ws://localhost:8080` (WebSocket)

### Available Commands

Send JSON messages via WebSocket:

| Command | Purpose |
|---------|---------|
| `get-engine-state` | Get engine status, element count, focus |
| `get-buffer` | Get current buffer snapshot |
| `get-document-tree` | Get element tree structure |
| `inject-event` | Inject keyboard/mouse events |
| `trigger-render` | Force a re-render |
| `get-headless-status` | Headless mode info |
| `get-terminal-output` | Get captured terminal output |

### Event Injection Examples

```json
// Inject keypress
{"type": "inject-event", "data": {"type": "keypress", "key": "Enter"}}

// Inject click at x=10, y=5
{"type": "inject-event", "data": {"type": "click", "x": 10, "y": 5}}
```

### Subscriptions

Subscribe to real-time updates:
- `buffer-updates` - Buffer changes
- `engine-state` - State changes
- `render-notifications` - Re-render events
- `event-stream` - Input events

## Debugging Workflow

### 1. Enable Logging
```bash
MELKER_LOG_FILE=/tmp/app.log MELKER_LOG_LEVEL=DEBUG \
  deno run --allow-all melker.ts app.melker
```

### 2. Watch Log File
```bash
tail -f /tmp/app.log
```

### 3. Watch Mode for Development
```bash
# Auto-reload on file changes (local files only)
MELKER_LOG_FILE=/tmp/app.log MELKER_LOG_LEVEL=DEBUG \
  deno run --allow-all melker.ts --watch app.melker
```

Watch mode monitors the source file and automatically reloads the application when changes are detected. File change events are logged to the log file.

### 4. Use Debug Server for Interaction
```bash
# In another terminal
MELKER_DEBUG_PORT=8080 MELKER_LOG_FILE=/tmp/app.log \
  deno run --allow-all melker.ts app.melker
```

### 5. Disable Alternate Screen (See Raw Output)
```bash
MELKER_NO_ALTERNATE_SCREEN=1 deno run --allow-all melker.ts app.melker
```

This keeps output in main buffer for scrollback review.

## Common Debug Scenarios

### Layout Issues
- Enable DEBUG logging to see layout calculations
- Check bounds in log: `Bounds calculated for button | bounds={"x":2,"y":7,"width":16,"height":1}`

### Event Issues
- Use debug server to inject events
- Check hit testing logs: `Hit test triggered | mouseX=10, mouseY=5`

### Focus Issues
- Look for focus registration: `Successfully registered focusable element: myButton`
- Check focus changes in logs

### Rendering Issues
- Use `MELKER_NO_ALTERNATE_SCREEN=1` to see raw ANSI output
- Use debug server's `get-buffer` to inspect buffer state

### Video Exit Issues (Garbage on Exit)
If video frame data (sextant characters) appears on the terminal after exit:
- This is a race condition: video frame renders after alternate screen exit
- The engine has render guards that check `_isInitialized` before `writeSync()`
- Guards are in `render()`, `forceRender()`, `_renderOptimized()`, `_renderFullScreen()`
- See `src/engine.ts` and `agent_docs/implementation-details.md` for details

## View Source (F12)

Press **F12** at runtime to view the source file in a modal dialog overlay.

### Features

- Shows the original `.melker` or `.md` source file
- **Markdown files show two tabs**: "Markdown" (original source) and "Melker" (converted output)
- Scrollable content area with keyboard navigation
- Tab buttons clickable with mouse or keyboard
- **AI Assistant button**: Opens the AI accessibility dialog (closes View Source first)
- Close with button click, Escape key, or F12 toggle

### Enabling View Source

The engine's `setSource()` method must be called with the source content:

```typescript
const engine = await createApp(root);
engine.setSource(sourceContent, '/path/to/file.melker', 'melker');
// or for markdown files (with converted content for Melker tab):
engine.setSource(mdContent, '/path/to/file.md', 'md', convertedMelkerContent);
```

The `melker-runner.ts` runner automatically enables this for `.melker` and `.md` files.

### Implementation

View Source is managed by `ViewSourceManager` (`src/view-source.ts`):
- Creates a dialog overlay with scrollable content
- For `.md` files: shows tabbed interface with original markdown and converted melker
- Uses the `melker` template literal for clean element creation
- Properly registers/unregisters elements from the document on open/close

## Key Files

| File | Purpose |
|------|---------|
| `src/logging.ts` | Logger class, getLogger(), log levels |
| `src/headless.ts` | HeadlessTerminal, HeadlessManager |
| `src/debug-server.ts` | MelkerDebugServer, WebSocket API |
| `src/view-source.ts` | ViewSourceManager, F12 overlay |
