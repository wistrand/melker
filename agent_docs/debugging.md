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

### 3. Use Debug Server for Interaction
```bash
# In another terminal
MELKER_DEBUG_PORT=8080 MELKER_LOG_FILE=/tmp/app.log \
  deno run --allow-all melker.ts app.melker
```

### 4. Disable Alternate Screen (See Raw Output)
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

## Key Files

| File | Purpose |
|------|---------|
| `src/logging.ts` | Logger class, getLogger(), log levels |
| `src/headless.ts` | HeadlessTerminal, HeadlessManager |
| `src/debug-server.ts` | MelkerDebugServer, WebSocket API |
